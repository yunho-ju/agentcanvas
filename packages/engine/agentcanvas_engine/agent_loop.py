"""한 실행이 에이전트의 반복에 대해 기억하는 것 — 예산, 사람이 답한 호출, 그리고 그 끝.

이 파일은 **루프의 살림**이 바뀔 때만 바뀐다: 도구를 몇 번 불렀는가, 사람의 답이 어느 호출의
것인가, 어느 노드가 어떻게 그쳤는가. 실행 조율(`routed_runtime._Flow`)은 이 살림을 들고만
다닌다 — 루프의 규칙이 실행기의 필드로 흩어지지 않는 자리다.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass

from agentcanvas_contracts.run import ApprovalAnswer

from .run_log import _PickedUp


@dataclass(frozen=True)
class _Ended:
    """루프가 답을 내고 그친 모양 — 몇 번 만에, 무엇으로 그쳤는가."""

    turns: int
    closed_by: str


@dataclass(frozen=True)
class _FoundNoAnswer:
    """물을 만큼 물었는데 답할 말이 없었다 — 없는 답을 지어내지 않는다."""

    turns: int


@dataclass(frozen=True)
class _WaitsForAPerson:
    """부르기 전에 사람에게 물어보는 호출 앞에서 멎었다 — 그 호출의 표를 들고 기다린다."""

    call_id: str


#: 루프가 이번 걸음을 마친 세 가지 모양 — 답을 냈거나, 답이 없었거나, 사람을 기다린다.
LoopEnding = _Ended | _FoundNoAnswer | _WaitsForAPerson


class _Loop:
    """에이전트들이 도구를 부르며 답을 다듬는 동안 한 실행이 기억하는 것.

    도구 예산은 실행 전체가 하나를 나눠 쓴다(도구 노드의 호출도 같은 예산이다). 사람의 답은
    **멈춰 세웠던 그 호출 하나**에 묶인다: 같은 턴의 다른 호출이 그 동의를 물려받지 않는다.
    """

    def __init__(
        self,
        budget: int,
        picked_up: Mapping[str, _PickedUp] | None = None,
        calls_made: int = 0,
    ) -> None:
        self._budget = budget
        self._picked_up = dict(picked_up or {})
        self._calls_made = calls_made
        self._answers: dict[str, ApprovalAnswer] = {}
        self._endings: dict[str, LoopEnding] = {}

    def picks_up(self, node_id: str) -> _PickedUp:
        """이 노드가 멈춰 섰던 자리 — 처음 도는 실행에서는 아무것도 없다."""
        return self._picked_up.get(node_id, _PickedUp())

    def has_budget(self) -> bool:
        """도구를 한 번 더 부를 수 있는가."""
        return self._calls_made < self._budget

    def counts_a_call(self) -> None:
        """도구를 한 번 불렀다 — 부른 것만 센다(부르지 못한 것은 예산을 쓰지 않는다)."""
        self._calls_made += 1

    def hears(self, node_id: str, answer: ApprovalAnswer) -> None:
        """사람이 답했다 — 이 답은 그 노드가 멈춰 세운 호출의 것이다."""
        self._answers[node_id] = answer

    def answer_for(self, node_id: str, call_id: str) -> ApprovalAnswer | None:
        """이 호출에 묶인 사람의 답 — 없으면 이 호출은 사람을 기다려야 한다.

        멈춰 설 때 물어본 그 호출(`waiting_on`)만 답을 쓴다: 같은 턴의 다른 호출이 동의를
        물려받으면 사람이 허락한 적 없는 도구가 부작용을 낸다. 답은 한 번 쓰이면 사라진다.
        """
        if self.picks_up(node_id).waiting_on != call_id:
            return None
        return self._answers.pop(node_id, None)

    def ends(self, node_id: str, ending: LoopEnding) -> None:
        """이 노드의 루프가 이렇게 끝났다 — 마침 사건은 이 값이 정한다."""
        self._endings[node_id] = ending

    def ending_of(self, node_id: str) -> LoopEnding | None:
        """이 노드의 루프가 어떻게 끝났는가 — 루프를 돌지 않은 노드에는 없다."""
        return self._endings.get(node_id)

    def holds_at(self, node_id: str) -> bool:
        """이 노드가 사람을 기다리며 멎었는가 — 멎은 노드는 마쳤다고 말하지 않는다."""
        return isinstance(self.ending_of(node_id), _WaitsForAPerson)


__all__ = [
    "LoopEnding",
    "_Ended",
    "_FoundNoAnswer",
    "_Loop",
    "_WaitsForAPerson",
]
