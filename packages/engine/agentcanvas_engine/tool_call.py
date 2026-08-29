"""도구를 부르는 일의 계약 — 무엇을 부르고, 무엇을 받았고, 못 받았으면 왜인가.

이 층에는 HTTP도 MCP도 없다. 진짜로 바깥을 부르는 일은 adapters의 몫이고, 여기 있는 것은
그 자리에 무엇이 오갈 수 있는지에 대한 약속뿐이다: 실패는 예외가 아니라 값으로 돌아온다
(`model_call.py`와 같은 문법 — 실행은 남의 사정으로 터지지 않는다).
"""

from __future__ import annotations

import json
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from typing import Literal

from agentcanvas_contracts.agent_spec import Node, ResourceBinding
from agentcanvas_contracts.tool_def import ToolDef


@dataclass(frozen=True)
class ToolAsk:
    """노드 하나가 도구에게 부탁하는 것 — 어느 연결의 어느 도구에게, 무엇을 건네는가.

    부르는 방법(주소·전송·열쇠 이름)은 도구 정의가 들고 있다: 그것을 진짜 요청으로 푸는
    일은 부르는 쪽(adapter)의 몫이다.
    """

    node: Node
    binding: ResourceBinding
    tool: ToolDef
    input: Mapping[str, object]


@dataclass(frozen=True)
class ToolReturned:
    """도구가 돌려준 것 — 그리고 그것이 원래 얼마였고 얼마나 실렸는가.

    크기를 두 값으로 적는 것은 정직 때문이다: 나중에 줄여 싣는 전략이 생겨도 화면과 계약이
    바뀌지 않고, 지금(통째로 싣는 전략)은 두 값이 같다.
    """

    result: object
    original_chars: int
    loaded_chars: int
    #: 후처리가 남긴 것(고른 섹션 목록·원문 ref 등) — tool.completed payload에 그대로 실린다.
    #: 원문 자체는 여기 싣지 않는다: 정직 보고의 의미(무엇을 얼마나 잘랐나)가 살아 있게.
    handling: Mapping[str, object] | None = None


#: 도구를 부르지 못했거나 답을 받지 못한 까닭.
#: 앞의 여섯과 unsupported_strategy·digest_failed는 문서·정책·우리 쪽 처리 실패(사람/우리가 고칠 일)이고,
#: timeout/http_error/bad_output 셋만 이번 호출이 어그러진 것이라 error 포트로 흐른다.
ToolTrouble = Literal[
    "unknown_binding",
    "unknown_tool",
    "no_adapter",
    "not_allowed",
    "missing_secret",
    "missing_input",
    "timeout",
    "http_error",
    "bad_output",
    "unsupported_strategy",
    "digest_failed",
]

#: 그래프가 스스로 다룰 수 있는 어그러짐 — error 포트로 흘러 다음 노드가 받는다.
#: 나머지는 문서·정책의 문제라 실행을 끝맺는다 (사람이 고칠 일을 그래프에 떠넘기지 않는다).
FLOWS_OUT_OF_THE_ERROR_PORT: frozenset[str] = frozenset(
    {"timeout", "http_error", "bad_output"}
)


@dataclass(frozen=True)
class ToolBalked:
    """부르지 못했다는 답 — 예외가 아니라 값이라, 실행은 까닭을 사건으로 남기고 이어 간다."""

    reason: ToolTrouble
    message: str


#: 부탁 하나에 답하는 것 — 진짜 도구 어댑터가 꽂히는 자리다.
#: 계약의 `ToolCall`(도구를 어떤 길로 부르는가 — http/mcp)과 다른 것이라 이름도 다르다.
CallsATool = Callable[[ToolAsk], ToolReturned | ToolBalked]


def _as_written(result: object) -> str:
    """돌려받은 것을 글자 수로 재기 위한 한 모양 — 기계가 주고받는 자리라 언어를 타지 않는다."""
    return json.dumps(result, ensure_ascii=False, sort_keys=True)


def measured(
    result: object,
    original_chars: int | None = None,
    handling: Mapping[str, object] | None = None,
) -> ToolReturned:
    """돌려받은 것에 크기를 적어 돌려준다 — 통째로 실었으면 두 값이 같다.

    `original_chars`를 건네면(줄여 실은 전략) 두 수가 갈린다. `handling`은 무엇을 근거로
    줄였는지(고른 섹션·원문 ref)를 함께 남긴다 — 원문 자체는 담지 않는다.
    """
    loaded = len(_as_written(result))
    return ToolReturned(
        result=result,
        original_chars=loaded if original_chars is None else original_chars,
        loaded_chars=loaded,
        handling=handling,
    )


def echoes_the_input(ask: ToolAsk) -> ToolReturned:
    """건넨 것을 그대로 되읊는 결정론 대역 — 진짜 도구가 없을 때 부르는 곳.

    지어낸 답을 진짜처럼 꾸미지 않는다: 무엇을 어느 도구에게 건넸는지만 그대로 적어 돌려준다.
    """
    return measured({"tool": ask.tool.name, "input": dict(ask.input)})


#: 아무도 진짜 도구를 주입하지 않았을 때 부르는 곳 — 언제나 같은 답을 하는 결정론 대역.
just_echoes: CallsATool = echoes_the_input


__all__ = [
    "FLOWS_OUT_OF_THE_ERROR_PORT",
    "CallsATool",
    "ToolAsk",
    "ToolBalked",
    "ToolReturned",
    "ToolTrouble",
    "echoes_the_input",
    "just_echoes",
    "measured",
]
