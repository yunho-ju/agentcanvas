"""노드 타입마다 무엇을 하는 것인가 — 그 성격을 적어 둔 표와, 표가 가리키는 일들.

이 파일은 **새 노드 타입이 생길 때**만 바뀐다: 어떻게 도는지도, 어떻게 조율되는지도 여기서는
모른다. 일하는 함수가 실행 흐름에게 부탁하는 것은 아래 Protocol이 말하는 것뿐이다 —
그래서 이 파일은 실행기를 import하지 않는다 (의존이 한쪽으로만 흐른다).
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from typing import Protocol

from agentcanvas_contracts.agent_spec import AgentSpec, Node
from agentcanvas_contracts.run import ApprovalAnswer
from agentcanvas_contracts.run_events import EventType

from .graph_walk import _ways_from
from .model_call import ModelAsk, ModelBalked, ModelSaid
from .run_log import _answer_payload, _Emission

#: 갈림길 판단을 맡는 노드의 타입.
ROUTER = "llm.router"

#: 사람의 확인을 기다리는 노드의 타입.
GATE = "control.human_gate"


class _Flowing(Protocol):
    """일하는 노드가 실행 흐름에게 부탁할 수 있는 것 — 딱 이만큼만 안다.

    실행기를 그대로 받지 않고 이 약속만 받는다: 노드가 하는 일이 실행 조율을 모르게 하는 자리다.
    """

    def ways_from(self, node: Node) -> tuple[str, ...]:
        """이 노드가 고를 수 있는 길 이름들."""
        ...

    def asks_a_model(
        self, node: Node, ways: tuple[str, ...] = ()
    ) -> tuple[list[_Emission], ModelSaid | None]:
        """모델에게 물어본다 — 못 들었으면 들은 것이 없음으로 온다."""
        ...

    def picks_a_way(
        self, node: Node, ways: tuple[str, ...], heard: ModelSaid
    ) -> list[_Emission]:
        """들은 말로 길을 고른다."""
        ...


def _ref_of(node: Node, key: str, fallback: str) -> str:
    value = node.config.get(key)
    return value if isinstance(value, str) else fallback


def _heard(ask: ModelAsk, said: ModelSaid) -> list[_Emission]:
    """모델에게 물어보고 들은 일이 사건으로 남는 모습 — 들은 그대로만 적는다.

    보낸 프롬프트와 받은 말은 진짜로 물어봤을 때만 있다 (설계 §8 — 모델이 본 것은 기록된다).
    지어낼 말이 없는 대역 뒤에서는 그 자리가 아예 없어, 예나 지금이나 같은 기록이 남는다.
    """
    compiled: dict[str, object] = {
        "prompt_ref": ask.prompt_ref,
        "blocks": [
            {
                "id": "system-role",
                "included": True,
                "token_count": said.input_tokens,
            }
        ],
        "total_tokens": said.input_tokens,
    }
    if said.prompt is not None:
        compiled["prompt"] = said.prompt
    completed: dict[str, object] = {
        "model_ref": ask.model_ref,
        "output_tokens": said.output_tokens,
    }
    if said.text is not None:
        completed["text"] = said.text
    return [
        _Emission(EventType.PROMPT_COMPILED, compiled),
        _Emission(EventType.LLM_REQUESTED, {"model_ref": ask.model_ref}),
        _Emission(EventType.LLM_COMPLETED, completed),
    ]


def _asks_a_model(flow: _Flowing, node: Node) -> list[_Emission]:
    """모델에게 물어보는 노드: 프롬프트를 만들고, 물어보고, 답을 받는다.

    말하는 노드는 고를 길을 받지 않는다 — 뒤에 길 이름을 보는 조건이 달려 있어도 그렇다.
    누가 판단하는 노드인가는 노드 타입의 표(KIND_BY_NODE_TYPE)가 정한다.
    """
    said, _ = flow.asks_a_model(node, ways=())
    return said


def _asks_a_model_and_picks_a_way(flow: _Flowing, node: Node) -> list[_Emission]:
    """갈림길 노드: 모델에게 물어본 뒤, 그 답으로 어느 길로 갈지 고른다."""
    ways = flow.ways_from(node)
    said, heard = flow.asks_a_model(node, ways)
    if heard is None:
        return said
    return [*said, *flow.picks_a_way(node, ways, heard)]


#: 노드가 일하는 동안 무슨 일이 일어나는가 — 실행 중인 흐름과 그 노드를 받는다.
_Work = Callable[[_Flowing, Node], list[_Emission]]


def _does_nothing_worth_saying(flow: _Flowing, node: Node) -> list[_Emission]:
    """일은 하지만 따로 남길 사건이 없는 노드 — 표에 없는 타입은 모두 이쪽이다."""
    return []


@dataclass(frozen=True)
class _NodeKind:
    """어떤 성격의 노드인가 — 일하는 동안 무슨 일이 일어나고, 길을 고르고, 사람을 기다리는가.

    실행기는 타입 이름을 알아보지 않고 이 성격만 읽는다: 새 타입은 표에 한 줄을 더하면 된다.
    """

    work: _Work = _does_nothing_worth_saying
    picks_a_way: bool = False
    waits_for_person: bool = False


#: 표에 없는 타입의 성격 — 남길 말도, 고를 길도, 기다릴 사람도 없다.
JUST_WORKS = _NodeKind()

#: 노드 타입마다의 성격 — 새 타입은 여기 한 줄을 더한다 (분기 대신 표).
KIND_BY_NODE_TYPE: dict[str, _NodeKind] = {
    ROUTER: _NodeKind(work=_asks_a_model_and_picks_a_way, picks_a_way=True),
    "llm.agent": _NodeKind(work=_asks_a_model),
    GATE: _NodeKind(waits_for_person=True),
}


def kind_of(node: Node) -> _NodeKind:
    """이 노드의 성격 — 표가 모르는 타입은 그저 일할 뿐이다."""
    return KIND_BY_NODE_TYPE.get(node.type, JUST_WORKS)


def _ways_offered(spec: AgentSpec, node: Node) -> tuple[str, ...]:
    """이 노드가 고를 수 있는 길들 — 길을 고르는 성격의 노드만 길을 받는다.

    말하는 노드는 뒤에 길 이름을 보는 조건이 달려 있어도 길을 고르지 않는다(P3-1). 그래서 그
    노드가 낸 것은 언제나 말이다 — 시작한 실행과 이어 달리는 실행이 이 한 자리를 함께 본다.
    """
    return _ways_from(spec, node.id) if kind_of(node).picks_a_way else ()


def _holds(node: Node) -> list[_Emission]:
    """사람에게 물어보는 노드: 확인을 청하고 흐름을 멈춘다 — 답이 오기 전에는 어느 갈래도 흐르지 않는다."""
    ref = node.config.get("approval_schema_ref")
    return [
        _Emission(EventType.NODE_QUEUED, {"node_type": node.type}, node.id),
        _Emission(EventType.NODE_STARTED, {"node_type": node.type}, node.id),
        _Emission(
            EventType.HUMAN_APPROVAL_REQUESTED,
            {
                "approval_schema_ref": ref
                if isinstance(ref, str)
                else f"schema://{node.id}@1"
            },
            node.id,
        ),
        _Emission(EventType.RUN_PAUSED, {"waiting_for": node.id}, node.id),
    ]


def _resumes(node: Node, approval: ApprovalAnswer) -> list[_Emission]:
    """사람의 답이 도착해 멈춰 있던 노드가 일을 마치는 일 — 무엇을 답했는지 함께 적힌다."""
    answer = _answer_payload(approval)
    return [
        _Emission(EventType.RUN_RESUMED, {"waiting_for": node.id, **answer}),
        _Emission(EventType.NODE_COMPLETED, {"node_type": node.type, **answer}),
    ]


def _could_not_ask(node: Node, balked: ModelBalked) -> _Emission:
    """모델에게 물어보지 못한 채로는 더 갈 수 없다 — 무슨 종류의 일이었는지와 함께 끝맺는다."""
    return _Emission(
        EventType.RUN_FAILED,
        {"reason": balked.reason, "message": balked.message},
        node.id,
    )
