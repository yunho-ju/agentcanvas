"""우리가 감싼 HTTP API를 진짜로 부르는 자리 — 주소를 짓고, 열쇠를 헤더에만 싣고, 답을 읽는다.

실패는 예외가 아니라 값이다(engine의 `ToolBalked`): 실행은 남의 사정으로 터지지 않는다.
실제로 그물을 타는 일은 주입한 전송 함수의 몫이다 — 그래서 이 파일은 결정론으로 시험된다.
"""

from __future__ import annotations

import json
import re
from collections.abc import Callable, Mapping
from dataclasses import dataclass, field
from typing import Literal
from urllib.parse import quote

from agentcanvas_contracts.tool_def import (
    DigestResult,
    HttpCall,
    RetrieveResult,
    SectionsResult,
    ToolDef,
)
from agentcanvas_engine.model_call import ModelAsk, ModelBalked, ModelCall
from agentcanvas_engine.tool_call import (
    CallsATool,
    ToolAsk,
    ToolBalked,
    ToolReturned,
    measured,
)

from .retrieval import bm25_ranked
from .secrets import SecretResolver

#: 저쪽이 답한 본문을 까닭에 실을 때의 상한 — 사람이 읽을 만큼만, 로그를 덮지 않을 만큼만.
MAX_BODY_CHARS = 500

#: 주소가 값을 달라고 적어 둔 자리 — `{이름}` 하나가 값 하나다.
_PLACEHOLDER = re.compile(r"\{([A-Za-z0-9_]+)\}")

#: 값을 물음표 뒤에 싣는 부름 — 나머지는 본문에 싣는다.
_IN_THE_QUERY = frozenset({"GET", "DELETE", "HEAD"})


@dataclass(frozen=True)
class ToolRequest:
    """바깥으로 나가는 부탁 하나 — 전송이 그대로 실어 보낼 수 있는 모양."""

    method: str
    url: str
    timeout_s: float
    headers: Mapping[str, str] = field(default_factory=dict)
    params: Mapping[str, object] = field(default_factory=dict)
    body: Mapping[str, object] | None = None


@dataclass(frozen=True)
class ToolResponse:
    """저쪽이 답한 것 — 무슨 뜻의 답이고 무엇이라 적혔는가."""

    status_code: int
    text: str


@dataclass(frozen=True)
class SendFailed:
    """부탁이 저쪽에 닿지 못했다는 답 — 기다리다 지쳤거나, 길이 없었거나."""

    reason: Literal["timeout", "unreachable"]
    message: str


#: 부탁 하나를 실제로 실어 보내는 것 — 진짜 그물이 꽂히는 자리다.
Send = Callable[[ToolRequest], ToolResponse | SendFailed]

#: 닿지 못한 까닭 → 실행이 듣는 까닭 (분기 대신 표).
_TROUBLE_BY_SEND_FAILURE: dict[str, str] = {
    "timeout": "timeout",
    "unreachable": "http_error",
}


#: 열쇠가 글에 섞여 나왔을 때 그 자리에 대신 적는 말 — 실값은 어디에도 남지 않는다.
HIDDEN_KEY = "(the key)"


def _shortened(text: str, key: str | None = None) -> str:
    """저쪽이 말한 것을 사람이 읽을 만큼만 — 길면 잘렸다고 말하고, 열쇠는 지운다.

    저쪽이 우리 열쇠를 그대로 되돌려 적어 보내는 일이 있다(잘못된 요청을 그대로 되읊는 서버).
    까닭은 이벤트와 로그에 남으므로, 그 자리에 실값이 실릴 길을 여기서 끊는다.
    """
    said = text if key is None else text.replace(key, HIDDEN_KEY)
    if len(said) <= MAX_BODY_CHARS:
        return said
    return said[:MAX_BODY_CHARS] + "…"


def _addressed(
    call: HttpCall, given: Mapping[str, object]
) -> tuple[str, set[str]] | ToolBalked:
    """주소가 달라는 값을 채워 넣는다 — 없는 값이 있으면 부르지 않고 그 까닭을 답한다."""
    wanted = _PLACEHOLDER.findall(call.url_template)
    missing = [name for name in wanted if name not in given]
    if missing:
        # 무엇이 없는지는 값의 이름으로 말한다. 주소 원문을 까닭에 싣지 않는다 —
        # 까닭은 이벤트에 그대로 남고, 주소에는 사람이 무엇을 적어 두었을지 알 수 없다.
        return ToolBalked(
            reason="missing_input",
            message=(
                f"this tool needs {', '.join(sorted(missing))} "
                "before it can be called, but nothing handed it over"
            ),
        )
    # 값은 주소의 그 칸에만 머문다: 슬래시도 물음표도 글자로 실어 보낸다(safe=""),
    # 그러지 않으면 실행 입력이 문서에 적히지 않은 곳을 우리 열쇠를 지고 부르게 한다.
    url = _PLACEHOLDER.sub(
        lambda found: quote(str(given[found.group(1)]), safe=""), call.url_template
    )
    return url, set(wanted)


def _carrying(
    key: str | None,
) -> dict[str, str]:
    """부탁이 지고 가는 것 — 열쇠는 이 자리에만 실린다(주소에도, 값에도 싣지 않는다)."""
    headers = {"Accept": "application/json"}
    if key is not None:
        headers["Authorization"] = f"Bearer {key}"
    return headers


def _read(answer: ToolResponse, tool: ToolDef, key: str | None) -> object | ToolBalked:
    """저쪽의 답을 읽는다 — 좋다는 답이 아니거나 읽을 수 없으면 그 까닭을 값으로 답한다."""
    if not 200 <= answer.status_code < 300:
        return ToolBalked(
            reason="http_error",
            message=(
                f"{tool.name!r} answered {answer.status_code}: "
                f"{_shortened(answer.text, key)}"
            ),
        )
    try:
        return json.loads(answer.text)
    except (json.JSONDecodeError, TypeError):
        return ToolBalked(
            reason="bad_output",
            message=(
                f"{tool.name!r} answered something this runtime cannot read as JSON"
            ),
        )


#: 고른 섹션이 응답에 없을 때 그 자리에 남기는 표시 — 빈 값이 아니라 "없다는 사실"이다.
#: 조용히 빠뜨리지 않는다(정직): 무엇을 골랐는데 없었는지가 result에 그대로 남는다.
SECTION_NOT_IN_ANSWER = {"present_in_answer": False}


def _original_ref(ask: ToolAsk) -> dict[str, str]:
    """무엇을 잘랐든 이 run의 이 도구 호출을 가리키는 안정 식별자 (외부 재조회는 이 브리프 밖).

    한 run에서 노드는 한 번 일하므로(멱등) node_id가 이 호출을 안정적으로 가리킨다. 순번(seq)은
    이 payload를 실어 나르는 tool.completed 사건 자신에 붙는다 — 여기에 겹쳐 적지 않는다.
    """
    return {
        "node_id": ask.node.id,
        "resource_ref": ask.binding.id,
        "tool_name": ask.tool.name,
    }


def _full(ask: ToolAsk, parsed: object) -> ToolReturned | ToolBalked:
    """받은 것을 그대로 싣는다 — 원문과 실은 것이 같으니 두 수가 같다 (P3a 그대로)."""
    return measured(parsed)


def _sections(ask: ToolAsk, parsed: object) -> ToolReturned | ToolBalked:
    """부르는 쪽이 고른 섹션만 싣는다 — 최상위 키 기준, 결정론적(모델·검색 없음).

    고른 섹션이 응답에 없으면 조용히 빠뜨리지 않고 "없음"으로 남긴다. 무엇을 실을지가
    안 정해졌으면(목록이 빔) 부르지 않은 것과 같은 갈래로 balk한다(missing_input).
    """
    handling = ask.tool.result_handling
    assert isinstance(handling, SectionsResult)
    asked_for = ask.input.get(handling.section_param)
    wanted = (
        [name for name in asked_for if isinstance(name, str) and name.strip()]
        if isinstance(asked_for, list)
        else []
    )
    if not wanted:
        return ToolBalked(
            reason="missing_input",
            message=(
                "this tool loads only the sections it is asked for, but no section "
                f"names came in on {handling.section_param!r}"
            ),
        )
    at_top = parsed if isinstance(parsed, dict) else {}
    picked = {name: at_top.get(name, SECTION_NOT_IN_ANSWER) for name in wanted}
    return measured(
        picked,
        original_chars=measured(parsed).loaded_chars,
        handling={"sections": wanted, "original_ref": _original_ref(ask)},
    )


def _canonical(value: object) -> str:
    """조각내고 크기를 잴 때 쓰는 한 모양 — 기계가 주고받는 자리라 언어를 타지 않는다.

    engine의 크기 측정(measured)과 같은 규칙이라 두 수(original/loaded)가 같은 자로 잰다.
    """
    return json.dumps(value, ensure_ascii=False, sort_keys=True)


@dataclass(frozen=True)
class _Chunk:
    """응답을 나눈 조각 하나 — 무엇으로 부를지(id), 점수 매길 글(text), 실을 값(value)."""

    id: str
    text: str
    value: object


def _chunk_by_section(parsed: object, size: int) -> list[_Chunk]:
    """최상위 키마다 한 조각 — Sections의 조각 나누기를 그대로 쓴다(size는 보지 않는다)."""
    if not isinstance(parsed, dict):
        return [_Chunk(id="0", text=_canonical(parsed), value=parsed)]
    return [
        _Chunk(id=str(name), text=f"{name} {_canonical(value)}", value=value)
        for name, value in parsed.items()
    ]


def _chunk_by_chars(parsed: object, size: int) -> list[_Chunk]:
    """응답을 글자열로 보고 size자마다 자른다 — 경계는 문자 단위, 결정론적."""
    whole = _canonical(parsed)
    return [
        _Chunk(id=str(at), text=whole[at : at + size], value=whole[at : at + size])
        for at in range(0, len(whole), size)
    ]


def _combine_sections(chosen: list[_Chunk]) -> tuple[object, int]:
    """고른 섹션들을 다시 구조로 싣는다 — 부분집합이라 canonical 길이가 원본을 넘지 않는다."""
    result = {chunk.id: chunk.value for chunk in chosen}
    return result, len(_canonical(result))


def _combine_chars(chosen: list[_Chunk]) -> tuple[object, int]:
    """고른 글자 조각을 **그대로** 이어 싣는다 — 재인코딩하지 않는다.

    조각은 원본 canonical 문자열의 겹치지 않는 슬라이스라, 이어 붙여도 합이 원본을 넘지
    않는다(정직성 불변식). 다시 JSON으로 감싸면 이스케이프가 붙어 원본보다 커지므로 하지 않는다.
    """
    joined = "".join(str(chunk.value) for chunk in chosen)
    return joined, len(joined)


@dataclass(frozen=True)
class _Chunker:
    """응답을 조각내고(split), 고른 조각을 다시 싣는(combine) 한 쌍 — by가 고른다."""

    split: Callable[[object, int], list[_Chunk]]
    combine: Callable[[list[_Chunk]], tuple[object, int]]


#: 조각내고 다시 싣는 규칙은 by가 정한다 — 새 갈래는 표에 한 줄이지 분기가 아니다.
CHUNK_BY: dict[str, _Chunker] = {
    "section": _Chunker(split=_chunk_by_section, combine=_combine_sections),
    "chars": _Chunker(split=_chunk_by_chars, combine=_combine_chars),
}


def _retrieve(ask: ToolAsk, parsed: object) -> ToolReturned | ToolBalked:
    """질의로 관련 조각만 골라 싣는다 — 조각내고, BM25로 점수 매겨, 상위 top_k만.

    같은 응답·같은 질의면 언제나 같은 top_k다(BM25 순수·동점 안정 정렬). 무엇을 근거로
    골랐는지(질의·고른 조각·점수)를 payload에 남겨 리플레이가 성립한다. 원 응답은 통째로
    싣지 않는다 — 고른 조각만(정직 보고 P3c 상속).
    """
    handling = ask.tool.result_handling
    assert isinstance(handling, RetrieveResult)
    asked = ask.input.get(handling.query_param)
    query = asked if isinstance(asked, str) and asked.strip() else ""
    if not query:
        return ToolBalked(
            reason="missing_input",
            message=(
                "this tool retrieves the pieces that match a query, but no query came "
                f"in on {handling.query_param!r}"
            ),
        )
    chunker = CHUNK_BY[handling.chunk.by]
    chunks = chunker.split(parsed, handling.chunk.size)
    ranked = bm25_ranked([chunk.text for chunk in chunks], query)
    chosen = ranked[: handling.top_k]
    chosen_chunks = [chunks[index] for index, _score in chosen]
    result, loaded_chars = chunker.combine(chosen_chunks)
    retrieved = [{"chunk": chunks[index].id, "score": score} for index, score in chosen]
    return ToolReturned(
        result=result,
        original_chars=len(_canonical(parsed)),
        loaded_chars=loaded_chars,
        handling={
            "query": query,
            "retrieved": retrieved,
            "original_ref": _original_ref(ask),
        },
    )


#: 요약 프롬프트가 사는 이름 — 이 도구 호출 안의 별도 모델 호출이라 본 실행 프롬프트와 다르다.
DIGEST_PROMPT_REF = "prompt://tool-digest@1"


def _digest_prompt(max_chars: int, answer: str) -> str:
    """요약 모델에게 보내는 지시 — 원 응답을 max_chars 안으로 줄이라고 말한다."""
    return (
        "Summarize the following tool response so a downstream agent can use it. "
        f"Keep it under {max_chars} characters. Preserve the key facts; do not add "
        "anything that is not in the response.\n\n"
        f"{answer}"
    )


def _digest(
    ask: ToolAsk, parsed: object, summarize: ModelCall
) -> ToolReturned | ToolBalked:
    """받은 전체를 요약 모델로 줄여 싣는다 — 이 요약 호출은 본 실행 llm 노드와 분리된다.

    요약은 결정론이 아니고 정보 손실·환각 리스크가 있어(vision) 원문 ref 보존이 조건이다:
    payload에 크기 두 수와 original_ref를 남기고, 원 응답 자체는 싣지 않는다(요약 텍스트만).
    요약이 max_chars를 넘치면 잘라 싣되 loaded_chars가 그 사실을 말한다. 요약이 실패하면
    조용히 Full로 떨어지지 않고 도구가 balk한다.
    """
    handling = ask.tool.result_handling
    assert isinstance(handling, DigestResult)
    original = _canonical(parsed)
    said = summarize(
        ModelAsk(
            node=ask.node,
            state={},
            ways=(),
            model_ref=handling.model_ref,
            prompt_ref=DIGEST_PROMPT_REF,
            instruction=_digest_prompt(handling.max_chars, original),
        )
    )
    if isinstance(said, ModelBalked) or not said.text:
        return ToolBalked(
            reason="digest_failed",
            message=(f"the summary model could not shorten {ask.tool.name!r}'s answer"),
        )
    summary = said.text[: handling.max_chars]
    return ToolReturned(
        result=summary,
        original_chars=len(original),
        loaded_chars=len(summary),
        handling={
            "digest": {
                "model_ref": handling.model_ref,
                "max_chars": handling.max_chars,
            },
            "original_ref": _original_ref(ask),
        },
    )


def _unsupported(ask: ToolAsk, parsed: object) -> ToolReturned | ToolBalked:
    """아직 못 만든 전략 — 조용히 Full로 떨어지지 않고 그 사실만 정직하게 말한다.

    문서의 문제가 아니라 "아직 준비 중"이라 no_adapter와 같은 결의 balk다 (error 포트가 아니다).
    지금 이 자리 표시로 남은 것은 digest뿐이다 — P3e가 요약 모델 주입과 함께 진짜 handler를 얹는다.
    """
    return ToolBalked(
        reason="unsupported_strategy",
        message=(
            f"the {ask.tool.result_handling.mode!r} way of loading a tool's answer "
            "is not built yet"
        ),
    )


#: 한 응답을 실을 handler 하나 — (ask, parsed) → 처리된 것 또는 balk.
Handle = Callable[[ToolAsk, object], ToolReturned | ToolBalked]

#: 그 자리에 무엇을 넣을지 정하는 조립기 — 요약 모델(있으면)을 받아 handler를 만든다.
#: full/sections/retrieve는 아무것도 필요 없고, digest만 요약 모델을 받는다(주입, 분기 아님).
HandlerFor = Callable[[ModelCall | None], Handle]


def _needs_nothing(handle: Handle) -> HandlerFor:
    """의존 없이 서는 handler를 조립기 자리에 그대로 놓는다."""
    return lambda _summarize: handle


def _digest_slot(summarize: ModelCall | None) -> Handle:
    """digest 자리 — 요약 모델이 주입됐을 때만 진짜 handler, 없으면 정직한 미지원.

    live provider가 아닌 서버(summarize=None)에서는 조용히 Full로 떨어지지 않고 balk한다.
    """
    if summarize is None:
        return _unsupported
    return lambda ask, parsed: _digest(ask, parsed, summarize)


#: 응답을 어떻게 실을지 mode가 정한다 — 새 전략은 표에 조립기 한 줄이지 분기가 아니다.
HANDLE_BY_MODE: dict[str, HandlerFor] = {
    "full": _needs_nothing(_full),
    "sections": _needs_nothing(_sections),
    "retrieve": _needs_nothing(_retrieve),
    "digest": _digest_slot,
}


def handler_for(mode: str, summarize: ModelCall | None) -> Handle:
    """그 mode를 실을 handler — 요약 모델을 조립해 넣는다. 표에 없는 mode는 정직한 미지원."""
    return HANDLE_BY_MODE.get(mode, _needs_nothing(_unsupported))(summarize)


def calls_http(
    send: Send, vault: SecretResolver, summarize: ModelCall | None = None
) -> CallsATool:
    """HTTP로 감싼 도구를 부르는 자리 — 전송과 금고를 받아 하나의 부르는 자리가 된다.

    되묻지 않는다(재시도 없음): 바깥을 바꾸는 도구를 우리 마음대로 두 번 부르지 않는다.
    옮겨 간 자리도 따라가지 않는다 — 어디로 부를지는 문서에 적힌 그 주소뿐이다.
    """

    def asks(ask: ToolAsk) -> ToolReturned | ToolBalked:
        call = ask.tool.call
        if not isinstance(call, HttpCall):
            return ToolBalked(
                reason="no_adapter",
                message=(
                    f"tool {ask.tool.name!r} is called over "
                    f"{call.transport!r}, which this adapter does not speak"
                ),
            )
        key: str | None = None
        if call.auth is not None:
            key = vault(call.auth)
            if key is None:
                return ToolBalked(
                    reason="missing_secret",
                    message=(
                        f"the key named {call.auth!r} is not on this server; "
                        "put it in the server's environment and run again"
                    ),
                )
        addressed = _addressed(call, ask.input)
        if isinstance(addressed, ToolBalked):
            return addressed
        url, in_the_address = addressed
        left = {
            name: value
            for name, value in ask.input.items()
            if name not in in_the_address
        }
        method = call.method.value
        answered = send(
            ToolRequest(
                method=method,
                url=url,
                timeout_s=ask.tool.timeout_ms / 1000,
                headers=_carrying(key),
                params=left if method in _IN_THE_QUERY else {},
                body=None if method in _IN_THE_QUERY else left,
            )
        )
        if isinstance(answered, SendFailed):
            return ToolBalked(
                reason=_TROUBLE_BY_SEND_FAILURE[answered.reason],
                message=(
                    f"{ask.tool.name!r} could not be reached: "
                    f"{_shortened(answered.message, key)}"
                ),
            )
        read = _read(answered, ask.tool, key)
        if isinstance(read, ToolBalked):
            return read
        # 원 응답을 받은 직후, 어댑터 안에서 후처리한다 — result 포트엔 처리된 것만 실린다.
        return handler_for(ask.tool.result_handling.mode, summarize)(ask, read)

    return asks


def sends_with_httpx(request: ToolRequest) -> ToolResponse | SendFailed:
    """진짜 그물을 타는 전송 — 도구가 적어 둔 시간만 기다리고, 옮겨 간 자리는 따라가지 않는다.

    저쪽 사정은 예외가 아니라 값으로 돌려준다: 부르는 자리가 그것을 실행의 까닭으로 옮긴다.
    """
    import httpx

    try:
        answered = httpx.request(
            request.method,
            request.url,
            headers=dict(request.headers),
            params=dict(request.params) or None,
            json=dict(request.body) if request.body is not None else None,
            timeout=request.timeout_s,
            # 옮겨 간 자리를 따라가지 않는다: 문서에 적힌 그 주소만 부른다(SSRF 표면을 좁힌다).
            follow_redirects=False,
        )
    except httpx.TimeoutException as waited:
        return SendFailed(reason="timeout", message=str(waited) or "the call timed out")
    # `InvalidURL`은 HTTPError 갈래가 아니다 — 그물의 사정이 아니라 주소가 주소가 아닌
    # 경우다. 그래도 실행은 터지지 않는다: 우리 손의 문제도 값으로 답한다.
    except (httpx.HTTPError, httpx.InvalidURL) as trouble:
        return SendFailed(reason="unreachable", message=str(trouble))
    return ToolResponse(status_code=answered.status_code, text=answered.text)


__all__ = [
    "CHUNK_BY",
    "DIGEST_PROMPT_REF",
    "HANDLE_BY_MODE",
    "HIDDEN_KEY",
    "MAX_BODY_CHARS",
    "SECTION_NOT_IN_ANSWER",
    "Send",
    "SendFailed",
    "ToolRequest",
    "ToolResponse",
    "calls_http",
    "handler_for",
    "sends_with_httpx",
]
