"""연결의 종류마다 그 도구를 부르는 자리 — 새 종류는 표에 한 줄이다 (분기 대신 표).

`OPENS_BY_PROVIDER`(모델이 사는 곳 → 그 문)와 같은 문법이다: 표에 없는 종류는 아직
부를 수 없다고 정직하게 답한다 — 아무 일도 하지 않고 초록불을 켜지 않는다.
"""

from __future__ import annotations

from collections.abc import Callable

from agentcanvas_engine.model_call import ModelCall
from agentcanvas_engine.tool_call import CallsATool, ToolAsk, ToolBalked, ToolReturned

from .http_tool import Send, calls_http
from .secrets import SecretResolver

#: 금고·전송·요약 모델을 받아 그 종류의 도구를 부르는 자리를 여는 것.
#: 요약 모델은 digest 전략만 쓴다 — 다른 어댑터(예: mcp)는 받아 두고 무시하면 된다.
OpensATool = Callable[[Send, SecretResolver, ModelCall | None], CallsATool]

#: 연결의 종류 → 그 도구를 부르는 자리. 새 종류(예: mcp)는 여기 한 줄이다.
ADAPTER_BY_KIND: dict[str, OpensATool] = {
    "http.api": calls_http,
}


def tools_from(
    vault: SecretResolver, send: Send, summarize: ModelCall | None = None
) -> CallsATool:
    """문서가 가리킨 연결의 종류를 보고 알맞은 자리에 부탁을 넘긴다.

    표에 없는 종류는 아직 부를 수 없다 — 그 사실을 값으로 답한다(터지지 않고, 꾸미지 않는다).
    요약 모델은 조립 시 한 번 받아 각 어댑터에 건넨다(digest 전략만 쓴다).
    """
    opened = {
        kind: opens(send, vault, summarize) for kind, opens in ADAPTER_BY_KIND.items()
    }

    def asks(ask: ToolAsk) -> ToolReturned | ToolBalked:
        adapter = opened.get(ask.binding.kind)
        if adapter is None:
            return ToolBalked(
                reason="no_adapter",
                message=(f"connections of kind {ask.binding.kind!r} cannot be run yet"),
            )
        return adapter(ask)

    return asks


__all__ = ["ADAPTER_BY_KIND", "OpensATool", "tools_from"]
