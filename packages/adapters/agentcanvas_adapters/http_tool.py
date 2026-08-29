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

from agentcanvas_contracts.tool_def import HttpCall, ToolDef
from agentcanvas_engine.tool_call import (
    CallsATool,
    ToolAsk,
    ToolBalked,
    ToolReturned,
    measured,
)

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


def calls_http(send: Send, vault: SecretResolver) -> CallsATool:
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
        return measured(read)

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
    "HIDDEN_KEY",
    "MAX_BODY_CHARS",
    "Send",
    "SendFailed",
    "ToolRequest",
    "ToolResponse",
    "calls_http",
    "sends_with_httpx",
]
