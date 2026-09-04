"""OpenAI 말투를 쓰는 곳에 물어보는 자리 — 본사도, 내 컴퓨터에서 띄운 것도 같은 계약이다.

어느 문으로 갈지는 모델 정의의 `base_url`이 정한다: 주소가 없으면 그 회사의 제자리, 있으면
거기서 띄운 서빙(Ollama 등)이다. 로컬 서빙은 열쇠를 검사하지 않으므로 관례값 하나면 되고,
회사 제자리에는 진짜 열쇠가 있어야 한다 — 없으면 그물에 나가기 전에 그 까닭을 답한다.

무엇을 묻고 무엇을 답으로 치는지는 model_talk이 정한다. 다시 걸어 보는 일은 클라이언트가
알아서 한다 — 여기에 우리만의 재시도 고리를 얹지 않는다.
"""

from __future__ import annotations

import json
import logging
from collections.abc import Callable, Mapping, Sequence
from dataclasses import replace
from time import perf_counter
from typing import Any
from uuid import uuid4

import openai
from agentcanvas_contracts.model_catalog import DEFAULT_MODEL_CATALOG, ModelDef
from agentcanvas_engine.model_call import (
    ModelAsk,
    ModelBalked,
    ModelCall,
    ModelEvidence,
    ModelSaid,
    ModelTurn,
    ToolBrief,
    ToolCall,
    ToolReply,
    TranscriptItem,
)

from .model_talk import (
    CUT_SHORT,
    DECLINED,
    NO_ANSWER,
    NOTHING_SAID,
    cannot_take_tools,
    heard,
    instruction,
    missing_key,
    no_such_model,
    one_way_only,
    prompt_of,
    system_for,
    trouble,
)
from .secrets import SecretResolver

_logger = logging.getLogger(__name__)

#: 이 provider의 열쇠가 금고에서 갖는 이름.
OPENAI_API_KEY_REF = "secret://openai-api-key"

#: 내 컴퓨터에서 띄운 서빙에 대는 관례값 — 그쪽은 열쇠를 보지 않지만 자리는 비울 수 없다.
LOCAL_KEY = "ollama"

#: 답 하나에 내주는 크기 — 생각하는 데 먼저 쓰이는 판이 있어 인색하게 잡으면 답할 몫이 남지 않는다.
MAX_TOKENS = 4096

#: 그 크기를 문마다 어떤 말로 부르는가 — 본사의 생각하는 모델은 옛 이름을 아예 받지 않고,
#: 어딘가에서 띄운 서빙(Ollama 등)은 옛 이름으로 받는다(실측으로 확인한 자리).
ROOM_AT_THE_COMPANY = "max_completion_tokens"
ROOM_AT_A_SERVING = "max_tokens"

#: 그런 문에 도구를 실을 때 함께 보내는 생각의 몫 — 어느 문이 이것을 필요로 하는지는 모델
#: 정의(tools_need_thinking_off)가 말한다. 아무 문에나 얹으면 그 말 자체를 거절하는 문이 있다.
THINKING_OFF = "none"

#: 조인 모양에 이 provider가 요구하는 이름표.
WAY_SHAPE_NAME = "the_way_to_take"

#: 물린 청에서 도구를 가리키는 자리들 — 이 자리가 물려야 도구 이야기로 읽는다.
TOOL_PARAMS = ("tools", "tool_choice", "reasoning_effort")

#: 그 자리를 "받지 못한다"고 말하는 까닭들 (문장으로 오는 경우와 갈래 이름으로 오는 경우).
UNSUPPORTED_WORDS = (
    "not supported",
    "unsupported",
    "unrecognized",
    "unknown parameter",
)
UNSUPPORTED_CODES = frozenset({"unsupported_parameter", "unknown_parameter"})

#: 자리를 말해 주지 않고 문장으로만 "도구를 못 쓴다"고 답하는 서빙들의 말.
NO_TOOLS_AT_ALL = (
    "function calling is not supported",
    "function calling not supported",
    "does not support tools",
    "tools are not supported",
)

#: 답이 끝까지 오지 못한 까닭 → 사람에게 할 말. 표에 없는 까닭은 답이 온 것으로 본다.
TROUBLE_BY_FINISH_REASON = {
    "length": CUT_SHORT,
    "content_filter": DECLINED,
}


def _at_the_company(model: ModelDef) -> bool:
    """이 모델이 그 회사의 제자리에 있는가 — 주소가 적혀 있으면 거기서 띄운 서빙이다."""
    return model.base_url is None


def _room_for_an_answer(model: ModelDef) -> dict[str, Any]:
    """이 문이 답의 크기를 듣는 말 — 본사는 새 이름만 받고, 서빙은 옛 이름으로 받는다."""
    heard_as = ROOM_AT_THE_COMPANY if _at_the_company(model) else ROOM_AT_A_SERVING
    return {heard_as: MAX_TOKENS}


def _way_shape(ways: tuple[str, ...], model: ModelDef) -> dict[str, Any]:
    """답의 모양을 청하는 말 — 본사에는 엄격하게 청해 고른 길이 정말 그 목록 안에서 오게 한다.

    어딘가에서 띄운 서빙에는 예나 지금이나 같은 모양으로 청한다: 실측으로 확인한 자리에
    확인하지 못한 말을 얹지 않는다.
    """
    shape: dict[str, Any] = {"name": WAY_SHAPE_NAME}
    if _at_the_company(model):
        shape["strict"] = True
    return {**shape, "schema": one_way_only(ways)}


def _response_shape(ask: ModelAsk) -> dict[str, Any]:
    """임의 응답이 아니라 ask가 정한 JSON Schema를 provider 말투로 옮긴다.

    갈림길과 달리 여기서는 어느 문에도 엄격을 얹지 않는다. 엄격은 모든 열쇠가 required이고
    여분을 막을 것을 요구하는데, ask가 들고 오는 모양에는 선택 열쇠도 자유로운 판(config 같은
    임의 객체)도 있다 — 얹으면 저쪽이 청을 통째로 물린다(실측으로 확인한 자리). 온 답이 정말
    그 모양인지는 받는 쪽이 계약으로 다시 본다.
    """
    return {
        "name": ask.response_name or "structured_response",
        "schema": dict(ask.response_schema or {}),
    }


def _tool_shape(brief: ToolBrief) -> dict[str, Any]:
    """도구 한 벌을 이 문의 말로 — 이름과 쉬운 설명과 넣을 것의 모양."""
    return {
        "type": "function",
        "function": {
            "name": brief.name,
            "description": brief.description,
            "parameters": dict(brief.input_schema),
        },
    }


def _the_turn_it_took(turn: ModelTurn) -> dict[str, Any]:
    """모델이 지난 턴에 한 것 — 말은 그대로, 시킨 도구는 이 문의 말로 옮긴다."""
    message: dict[str, Any] = {"role": "assistant", "content": turn.text}
    if turn.tool_calls:
        message["tool_calls"] = [
            {
                "id": call.call_id,
                "type": "function",
                "function": {
                    "name": call.name,
                    "arguments": json.dumps(dict(call.arguments)),
                },
            }
            for call in turn.tool_calls
        ]
    return message


def _what_the_tool_answered(reply: ToolReply) -> dict[str, Any]:
    """도구가 돌려준 것 — 어느 호출의 답인지는 저쪽이 매긴 표로 말한다."""
    return {"role": "tool", "tool_call_id": reply.call_id, "content": reply.content}


def _turns_so_far(transcript: Sequence[TranscriptItem]) -> list[dict[str, Any]]:
    """이전 턴들을 이 문이 읽는 메시지 줄로 편다 — 일어난 차례 그대로."""
    return [
        _the_turn_it_took(item)
        if isinstance(item, ModelTurn)
        else _what_the_tool_answered(item)
        for item in transcript
    ]


def _request(ask: ModelAsk, model: ModelDef) -> dict[str, Any]:
    """저쪽에 보낼 청 한 벌 — 갈림길이면 답의 모양까지, 도구가 있으면 도구까지 함께 조인다."""
    request: dict[str, Any] = {
        "model": model.model_id,
        **_room_for_an_answer(model),
        "messages": [
            {"role": "system", "content": system_for(ask)},
            {"role": "user", "content": instruction(ask)},
            *_turns_so_far(ask.transcript),
        ],
    }
    if ask.tools:
        request["tools"] = [_tool_shape(brief) for brief in ask.tools]
        # 부를지 말지는 모델이 정한다 — 우리가 도구를 강요하면 답할 자리가 사라진다.
        request["tool_choice"] = "auto"
        if model.tools_need_thinking_off:
            request["reasoning_effort"] = THINKING_OFF
    if ask.response_schema is not None:
        request["response_format"] = {
            "type": "json_schema",
            "json_schema": _response_shape(ask),
        }
    elif ask.ways:
        request["response_format"] = {
            "type": "json_schema",
            "json_schema": _way_shape(ask.ways, model),
        }
    if _at_the_company(model):
        # ARCH-4 preview는 저장하지 않는 요청임을 provider에도 명시한다.
        request["store"] = False
    return request


def _prompt_sent(request: Mapping[str, Any]) -> str:
    system, said = request["messages"][0], request["messages"][1]
    return prompt_of(system["content"], said["content"])


def _arguments_of(call: Any) -> Mapping[str, object] | None:
    """저쪽이 실어 온 인자를 읽는다 — 읽을 수 없으면 지어내지 않고 없다고 답한다.

    대개는 JSON 글로 오지만, OpenAI 말투를 쓰는 서빙 중에는 이미 풀린 판으로 실어 오는 곳이
    있다. 그 판을 글로 알고 읽으려 들면 TypeError가 ModelCall 밖으로 새어 실행이 통째로
    무너진다 — 이 층의 약속은 "실패는 예외가 아니라 값"이다.
    """
    written = call.function.arguments
    if isinstance(written, Mapping):
        return written
    try:
        read = json.loads(written or "{}")
    except (json.JSONDecodeError, TypeError):
        return None
    return read if isinstance(read, dict) else None


def _calls_it_asked_for(message: Any) -> tuple[ToolCall, ...]:
    """모델이 시킨 도구 호출들 — 인자를 읽을 수 없는 호출은 버리고 그 사실을 로그에 남긴다.

    버리는 까닭: 무엇을 넣으라는지 모르는 채로 도구를 부르는 것은 사람이 시키지 않은 일을
    하는 것이다. 예외로 실행을 세우지도 않는다 — 남은 호출과 말은 그대로 답이 된다.
    """
    asked_for = getattr(message, "tool_calls", None) or ()
    read = []
    for call in asked_for:
        arguments = _arguments_of(call)
        if arguments is None:
            _logger.warning(
                "dropped a tool call whose arguments could not be read: %s",
                call.function.name,
            )
            continue
        read.append(
            ToolCall(call_id=call.id, name=call.function.name, arguments=arguments)
        )
    return tuple(read)


def _read(
    ask: ModelAsk, request: Mapping[str, Any], answer: Any
) -> ModelSaid | ModelBalked:
    """온 답을 계약의 말로 옮긴다 — 끝까지 오지 못한 답은 반쪽이라도 답으로 치지 않는다."""
    if not answer.choices:
        return trouble(NOTHING_SAID)
    chose = answer.choices[0]
    cut = TROUBLE_BY_FINISH_REASON.get(chose.finish_reason)
    if cut is not None:
        return trouble(cut)
    return heard(
        ask,
        chose.message.content,
        _prompt_sent(request),
        answer.usage.prompt_tokens,
        answer.usage.completion_tokens,
        _calls_it_asked_for(chose.message),
    )


def _request_id(answer: Any, client_request_id: str) -> str:
    """provider가 준 id를 우선하고, 없으면 우리가 보낸 안전한 id를 쓴다."""
    supplied = getattr(answer, "_request_id", None)
    return supplied if isinstance(supplied, str) and supplied else client_request_id


def _processing_ms(answer: Any) -> int | None:
    """SDK가 노출한 processing header만 읽고, 없으면 지어내지 않는다."""
    headers = getattr(answer, "headers", None)
    if headers is None or not hasattr(headers, "get"):
        return None
    raw = headers.get("openai-processing-ms")
    try:
        value = int(raw)
    except (TypeError, ValueError):
        return None
    return value if value >= 0 else None


def _what_was_refused(refused: openai.APIStatusError) -> tuple[str, str, str]:
    """물린 청에서 어느 자리가·어떤 갈래로·무슨 말로 물렸는지.

    SDK의 `.param`·`.code`는 몸통의 맨 위만 본다 — OpenAI는 그 사정을 `error` 아래에 담으므로
    그 자리는 언제나 비어 있다(실측). 그래서 몸통을 우리가 직접 읽고, 읽을 수 없는 몸통
    (JSON이 아니거나 모양이 다른 서빙)은 빈 말로 답해 판정이 지어내지 않게 한다.
    """
    body = refused.body
    told = body.get("error", body) if isinstance(body, dict) else None
    if not isinstance(told, dict):
        told = {}
    return (
        str(told.get("param") or ""),
        str(told.get("code") or ""),
        str(told.get("message") or refused.message or ""),
    )


def _turned_the_tools_away(refused: openai.OpenAIError) -> bool:
    """저쪽이 물린 까닭이 "이 문은 도구를 못 받는다"인가.

    이름만 보고 넓게 읽으면 사람에게 틀린 안내를 한다: 이전 턴을 잘못 편 것(messages 자리)도,
    도구 모양이 틀린 것(tools 자리 + 모양 까닭)도 "다른 모델을 고르세요"가 답이 아니다.
    그래서 **물린 자리**가 도구 쪽이고 **까닭**이 "그 말을 못 받는다"일 때만 그렇게 읽고,
    자리 없이 문장으로만 말하는 서빙을 위해 도구 자체를 못 쓴다는 말 몇 개를 따로 둔다.
    """
    if not isinstance(refused, openai.APIStatusError):
        return False
    if not 400 <= refused.status_code < 500:
        return False
    param, code, message = _what_was_refused(refused)
    said = message.lower()
    if any(phrase in said for phrase in NO_TOOLS_AT_ALL):
        return True
    if not param.startswith(TOOL_PARAMS):
        return False
    return code in UNSUPPORTED_CODES or any(word in said for word in UNSUPPORTED_WORDS)


def opens_openai(base_url: str | None, key: str) -> openai.OpenAI:
    """열쇠 하나로 그 주소의 문을 연다 — 주소가 없으면 그 회사의 제자리다."""
    return openai.OpenAI(api_key=key, base_url=base_url)


def openai_from(
    vault: SecretResolver,
    catalog: Mapping[str, ModelDef] | None = None,
    client_from: Callable[[str | None, str], Any] = opens_openai,
) -> ModelCall:
    """금고의 열쇠로 OpenAI 말투를 쓰는 곳에 물어볼 자리를 연다.

    열쇠는 문을 만들 때 한 번만 꺼내고, 문 하나는 주소마다 한 번만 연다 (물을 때마다 열지 않는다).
    """
    known = DEFAULT_MODEL_CATALOG if catalog is None else catalog
    key = vault(OPENAI_API_KEY_REF)
    opened: dict[str | None, Any] = {}

    def door_to(model: ModelDef, with_key: str) -> Any:
        if model.base_url not in opened:
            opened[model.base_url] = client_from(model.base_url, with_key)
        return opened[model.base_url]

    def asks(ask: ModelAsk) -> ModelSaid | ModelBalked:
        model = known.get(ask.model_ref)
        if model is None:
            return no_such_model(ask.model_ref)
        if ask.tools and not model.tool_calling:
            return cannot_take_tools(ask.model_ref)
        if model.base_url is None and key is None:
            # 회사 제자리에는 진짜 열쇠가 있어야 한다 — 관례값으로 문을 두드리지 않는다.
            return missing_key(OPENAI_API_KEY_REF)
        # 로컬 서빙은 열쇠를 보지 않는다 — 자리만 채워 준다.
        client = door_to(model, key if key is not None else LOCAL_KEY)
        client_request_id = f"agentcanvas-{uuid4().hex}"
        request = {
            **_request(ask, model),
            "extra_headers": {"X-Client-Request-Id": client_request_id},
        }
        started = perf_counter()
        try:
            answer = client.chat.completions.create(**request)
        except openai.OpenAIError as refused:
            if ask.tools and _turned_the_tools_away(refused):
                return cannot_take_tools(ask.model_ref)
            # 저쪽 사정은 여기서 끝난다 — 무엇이 어긋났는지는 우리 화면의 말이 아니다.
            return trouble(NO_ANSWER)
        said = _read(ask, request, answer)
        if not isinstance(said, ModelSaid):
            return said
        return replace(
            said,
            evidence=ModelEvidence(
                provider=model.provider,
                model_id=model.model_id,
                request_id=_request_id(answer, client_request_id),
                latency_ms=max(0, round((perf_counter() - started) * 1000)),
                provider_processing_ms=_processing_ms(answer),
            ),
        )

    return asks


__all__ = [
    "LOCAL_KEY",
    "MAX_TOKENS",
    "NO_TOOLS_AT_ALL",
    "OPENAI_API_KEY_REF",
    "ROOM_AT_A_SERVING",
    "ROOM_AT_THE_COMPANY",
    "THINKING_OFF",
    "TOOL_PARAMS",
    "TROUBLE_BY_FINISH_REASON",
    "UNSUPPORTED_CODES",
    "UNSUPPORTED_WORDS",
    "WAY_SHAPE_NAME",
    "openai_from",
    "opens_openai",
]
