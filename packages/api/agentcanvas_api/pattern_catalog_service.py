"""이 서버가 문서에 놓아 줄 수 있는 모양들 — 화면과 Architect가 읽는 목록 (설계 문서 D1).

카탈로그의 한 항목은 이 서버가 실제로 해낼 수 있을 때만 존재한다: 도구를 건넬 수 있는 모델이
하나도 없는 서버가 '찾아보게 하기'를 권하면, 화면이 이 서버가 못 하는 일을 말하게 된다.
능력을 판정하는 자리는 아래 표 하나뿐이라, 새 능력이 생기면 표에 한 줄을 더한다.
"""

from __future__ import annotations

from collections.abc import Callable, Mapping

from agentcanvas_contracts.model_catalog import ModelDef
from agentcanvas_contracts.patterns import DEFAULT_PATTERNS, Capability, PatternDef
from pydantic import BaseModel


class ServerPatterns(BaseModel):
    """이 서버가 화면에 말하는 모양들 — 여기 없는 모양은 화면도 Architect도 말하지 않는다."""

    patterns: list[PatternDef]


def _some_model_takes_tools(catalog: Mapping[str, ModelDef]) -> bool:
    return any(model.tool_calling for model in catalog.values())


def _the_engine_already_does_it(catalog: Mapping[str, ModelDef]) -> bool:
    """사람 확인과 갈림길은 엔진에 이미 있다 — 모델 사정이 이 둘을 막지 못한다."""
    return True


CAPABILITY_STANDING: dict[Capability, Callable[[Mapping[str, ModelDef]], bool]] = {
    "tool_calling": _some_model_takes_tools,
    "human_gate": _the_engine_already_does_it,
    "router": _the_engine_already_does_it,
}


def patterns_this_server_can_do(
    catalog: Mapping[str, ModelDef],
) -> list[PatternDef]:
    """카탈로그 차례 그대로, 이 서버가 `needs`를 모두 채울 수 있는 항목만 돌려준다."""
    return [
        pattern
        for pattern in DEFAULT_PATTERNS.values()
        if all(CAPABILITY_STANDING[needed](catalog) for needed in pattern.needs)
    ]


__all__ = ["CAPABILITY_STANDING", "ServerPatterns", "patterns_this_server_can_do"]
