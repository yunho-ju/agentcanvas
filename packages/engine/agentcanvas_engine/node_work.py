"""노드 타입마다 무엇을 하는 것인가 — 그 성격을 적어 둔 표와, 표가 가리키는 일들.

이 파일은 **새 노드 타입이 생길 때**만 바뀐다: 어떻게 도는지도, 어떻게 조율되는지도 여기서는
모른다. 일하는 함수가 실행 흐름에게 부탁하는 것은 아래 Protocol이 말하는 것뿐이다 —
그래서 이 파일은 실행기를 import하지 않는다 (의존이 한쪽으로만 흐른다).
"""

from __future__ import annotations

from collections.abc import Callable, Sequence
from dataclasses import dataclass
from typing import Protocol

from agentcanvas_contracts.agent_spec import AgentSpec, Node
from agentcanvas_contracts.run import ApprovalAnswer
from agentcanvas_contracts.run_events import EventType

from .graph_walk import _ways_from
from .model_call import (
    ModelAsk,
    ModelBalked,
    ModelSaid,
    ModelTurn,
    ToolBrief,
    ToolCall,
    ToolReply,
    TranscriptItem,
)
from .run_log import _answer_payload, _Emission, _in_turn, _PickedUp
from .skill_wear import followed_skills
from .tool_call import ToolBalked

#: 갈림길 판단을 맡는 노드의 타입.
ROUTER = "llm.router"

#: 사람의 확인을 기다리는 노드의 타입.
GATE = "control.human_gate"

#: 바깥 도구를 한 번 부르는 노드의 타입.
TOOL = "tool.mcp"


#: 에이전트가 답을 낸 까닭 — 스스로 그쳤는가, 턴을 다 썼는가, 도구 예산이 다했는가.
BY_ANSWER = "answer"
BY_TURN_LIMIT = "turn_limit"
BY_TOOL_BUDGET = "tool_budget"

#: 마무리 호출에서도 답할 말이 없었다 — 실패의 까닭이지 결말이 아니다.
NO_FINAL_ANSWER = "no_final_answer"

#: 아무도 적지 않았을 때 에이전트가 모델에게 묻는 횟수 (registry의 default와 같은 값).
DEFAULT_MAX_TURNS = 1


class _Flowing(Protocol):
    """일하는 노드가 실행 흐름에게 부탁할 수 있는 것 — 딱 이만큼만 안다.

    실행기를 그대로 받지 않고 이 약속만 받는다: 노드가 하는 일이 실행 조율을 모르게 하는 자리다.
    """

    def ways_from(self, node: Node) -> tuple[str, ...]:
        """이 노드가 고를 수 있는 길 이름들."""
        ...

    def asks_a_model(
        self,
        node: Node,
        ways: tuple[str, ...] = (),
        *,
        tools: tuple[ToolBrief, ...] = (),
        transcript: tuple[TranscriptItem, ...] = (),
        closing: bool | None = None,
    ) -> tuple[list[_Emission], ModelSaid | None]:
        """모델에게 물어본다 — 못 들었으면 들은 것이 없음으로 온다.

        `closing`이 있으면 루프 안의 물음이다: 마무리 호출인지가 기록에 함께 남는다.
        """
        ...

    def picks_a_way(
        self, node: Node, ways: tuple[str, ...], heard: ModelSaid
    ) -> list[_Emission]:
        """들은 말로 길을 고른다."""
        ...

    def calls_a_tool(self, node: Node) -> list[_Emission]:
        """바깥 도구를 한 번 부른다 — 못 불렀으면 그 까닭이 흐름에 남는다."""
        ...

    def tool_briefs(self, node: Node) -> tuple[ToolBrief, ...] | None:
        """이 노드가 모델에게 내놓을 도구들 — 내놓을 수 없으면 없음(까닭은 흐름이 안다)."""
        ...

    def picks_up(self, node: Node) -> _PickedUp:
        """이 노드가 멈춰 섰던 자리 — 처음 도는 실행에서는 아무것도 없다."""
        ...

    def has_tool_budget(self) -> bool:
        """이 실행이 도구를 더 부를 수 있는가 — 예산은 실행 전체가 함께 쓴다."""
        ...

    def calls_a_named_tool(
        self, node: Node, call: ToolCall
    ) -> tuple[list[_Emission], ToolReply | None]:
        """모델이 시킨 도구 하나를 부른다 — 회신이 없으면 루프는 거기서 멎는다.

        멎는 까닭은 둘이다: 사람을 기다리거나(승인), 문서·정책의 문제로 실행이 끝나거나.
        어느 쪽인지는 흐름이 안다.
        """
        ...

    def answers(
        self, node: Node, answer: str | None, *, turns: int, closed_by: str
    ) -> None:
        """이 노드의 답이 정해졌다 — 몇 번 만에, 무엇으로 그쳤는지 함께 적는다."""
        ...

    def found_no_answer(self, node: Node, *, turns: int) -> None:
        """물을 만큼 물었는데 답할 말이 없었다 — 이 노드는 마쳤다고 말하지 않는다."""
        ...


def _ref_of(node: Node, key: str, fallback: str) -> str:
    value = node.config.get(key)
    return value if isinstance(value, str) else fallback


def _asked_for(calls: tuple[ToolCall, ...]) -> list[dict[str, object]]:
    """모델이 시킨 도구 호출들이 사건에 적히는 모습 — 표와 이름과 건넨 값 그대로."""
    return [
        {"call_id": call.call_id, "name": call.name, "arguments": dict(call.arguments)}
        for call in calls
    ]


def _heard(
    ask: ModelAsk, said: ModelSaid, closing: bool | None = None
) -> list[_Emission]:
    """모델에게 물어보고 들은 일이 사건으로 남는 모습 — 들은 그대로만 적는다.

    보낸 프롬프트와 받은 말은 진짜로 물어봤을 때만 있다 (설계 §8 — 모델이 본 것은 기록된다).
    지어낼 말이 없는 대역 뒤에서는 그 자리가 아예 없어, 예나 지금이나 같은 기록이 남는다.
    루프 안의 물음만 마무리 호출인지(closing)와 시킨 도구들(tool_calls)을 함께 적는다:
    한 번에 끝나는 노드의 기록은 도구가 생기기 전과 글자 하나까지 같다.
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
    requested: dict[str, object] = {
        "model_ref": ask.model_ref,
        **followed_skills([brief.ref for brief in ask.skills]),
    }
    if closing is not None:
        requested["closing"] = closing
        completed["tool_calls"] = _asked_for(said.tool_calls)
    return [
        _Emission(EventType.PROMPT_COMPILED, compiled),
        _Emission(EventType.LLM_REQUESTED, requested),
        _Emission(EventType.LLM_COMPLETED, completed),
    ]


def _asks_a_model(flow: _Flowing, node: Node) -> list[_Emission]:
    """모델에게 물어보는 노드: 프롬프트를 만들고, 물어보고, 답을 받는다.

    말하는 노드는 고를 길을 받지 않는다 — 뒤에 길 이름을 보는 조건이 달려 있어도 그렇다.
    누가 판단하는 노드인가는 노드 타입의 표(KIND_BY_NODE_TYPE)가 정한다.
    """
    said, _ = flow.asks_a_model(node, ways=())
    return said


def _max_turns(node: Node) -> int:
    """이 노드가 모델에게 물을 수 있는 횟수 — 적지 않았으면 한 번(지금까지와 같다)."""
    told = node.config.get("max_turns")
    if isinstance(told, bool) or not isinstance(told, int) or told < 1:
        return DEFAULT_MAX_TURNS
    return told


def _runs_the_calls(
    flow: _Flowing, node: Node, calls: Sequence[ToolCall], turn: int
) -> tuple[list[_Emission], list[ToolReply] | None]:
    """한 턴이 시킨 도구들을 적힌 차례대로 부른다 — 도중에 멎으면 회신이 없음으로 온다.

    병렬로 부르지 않는다: 한 노드씩 순차라는 실행의 규칙이 노드 안에서도 같다.
    남은 예산은 부르는 자리가 호출마다 확인한다: 한 턴에 여럿을 시켜도 예산만큼만 불리고,
    나머지는 예산이 다 됐다는 회신으로 돌아온다 (한 턴이 문서의 한도를 넘어서지 못한다).
    """
    told: list[_Emission] = []
    replies: list[ToolReply] = []
    for call in calls:
        said, reply = flow.calls_a_named_tool(node, call)
        told.extend(_in_turn(said, turn))
        if reply is None:
            return told, None
        replies.append(reply)
    return told, replies


def _asks_a_model_with_tools(flow: _Flowing, node: Node) -> list[_Emission]:
    """도구를 부르며 답을 다듬는 노드 (설계 §4): 묻고, 시킨 것을 부르고, 다시 묻는다.

    두 겹의 한도가 있다 — 이 노드가 물을 수 있는 횟수(max_turns)와 실행 전체의 도구 예산.
    한도에 닿아도 빈손으로 끝내지 않는다: 도구 없이 한 번 더 물어(마무리 호출) 그 말을 답으로
    삼는다. 쓸 도구가 하나도 없는 노드는 루프가 아니라 한 번의 물음이다 — 예나 지금이나 같은
    기록이 남는다.
    """
    briefs = flow.tool_briefs(node)
    if briefs is None:
        return []
    if not briefs:
        return _asks_a_model(flow, node)
    picked = flow.picks_up(node)
    limit = _max_turns(node)
    transcript = list(picked.transcript)
    left: Sequence[ToolCall] = picked.calls_left
    turn = picked.turns
    told: list[_Emission] = []
    while True:
        if left:
            calls, replies = _runs_the_calls(flow, node, left, turn - 1)
            told.extend(calls)
            if replies is None:
                return told
            transcript.extend(replies)
            left = ()
        out_of_turns = turn >= limit
        closing = out_of_turns or not flow.has_tool_budget()
        said, heard = flow.asks_a_model(
            node,
            tools=() if closing else briefs,
            transcript=tuple(transcript),
            closing=closing,
        )
        told.extend(_in_turn(said, turn))
        if heard is None:
            return told
        turn += 1
        if closing or not heard.tool_calls:
            # 마무리 호출에서 시킨 도구는 부르지 않는다 — 그 말이 답이다.
            # 진짜 제공자는 말도 시킨 것도 없으면 여기 오기 전에 물러선다
            # (adapters `model_talk.heard` → NOTHING_SAID → run.failed). 여기 오는 말 없는 답은
            # 진짜 모델이 없는 실행(대역)의 것이고, 그 실행은 지어낸 말 없이 그래프를 끝까지 걷는다.
            if closing and not heard.text:
                flow.found_no_answer(node, turns=turn)
            else:
                flow.answers(
                    node,
                    heard.text,
                    turns=turn,
                    closed_by=_closed_by(closing, out_of_turns),
                )
            return told
        transcript.append(ModelTurn(text=heard.text, tool_calls=heard.tool_calls))
        left = heard.tool_calls


def _closed_by(closing: bool, out_of_turns: bool) -> str:
    if not closing:
        return BY_ANSWER
    return BY_TURN_LIMIT if out_of_turns else BY_TOOL_BUDGET


def _asks_a_model_and_picks_a_way(flow: _Flowing, node: Node) -> list[_Emission]:
    """갈림길 노드: 모델에게 물어본 뒤, 그 답으로 어느 길로 갈지 고른다."""
    ways = flow.ways_from(node)
    said, heard = flow.asks_a_model(node, ways)
    if heard is None:
        return said
    return [*said, *flow.picks_a_way(node, ways, heard)]


def _calls_a_tool(flow: _Flowing, node: Node) -> list[_Emission]:
    """도구 노드: 무엇을 부를지 확인하고, 부르고, 받은 것(또는 어그러진 까닭)을 적는다."""
    return flow.calls_a_tool(node)


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
    #: 바깥 도구를 부르는 노드인가 — 연결의 정책에 따라 부르기 전에 사람을 기다릴 수 있다.
    runs_a_tool: bool = False
    #: 답을 다듬는 동안 스스로 도구를 부르는 노드인가 — 그래서 한 노드 안에서 멈췄다 이어진다.
    calls_tools_while_it_answers: bool = False


#: 표에 없는 타입의 성격 — 남길 말도, 고를 길도, 기다릴 사람도 없다.
JUST_WORKS = _NodeKind()

#: 노드 타입마다의 성격 — 새 타입은 여기 한 줄을 더한다 (분기 대신 표).
KIND_BY_NODE_TYPE: dict[str, _NodeKind] = {
    ROUTER: _NodeKind(work=_asks_a_model_and_picks_a_way, picks_a_way=True),
    "llm.agent": _NodeKind(
        work=_asks_a_model_with_tools, calls_tools_while_it_answers=True
    ),
    GATE: _NodeKind(waits_for_person=True),
    TOOL: _NodeKind(work=_calls_a_tool, runs_a_tool=True),
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


def _found_no_answer(node: Node) -> _Emission:
    """답을 내지 못한 노드 뒤에 오는 실행의 끝 — 종결 사건 없이 멈추지 않는다.

    node.failed는 그 걸음의 일이고, 실행이 끝났다는 말은 따로 있어야 한다: 화면도 이어 달리는
    일꾼도 마지막 사건을 보고 실행의 지금을 읽는다 (`run_status`).
    """
    return _Emission(
        EventType.RUN_FAILED,
        {
            "reason": NO_FINAL_ANSWER,
            "message": f"the step {node.id!r} never reached an answer to give",
        },
        node.id,
    )


def _could_not_ask(node: Node, balked: ModelBalked | ToolBalked) -> _Emission:
    """물어보지도 부르지도 못한 채로는 더 갈 수 없다 — 무슨 종류의 일이었는지와 함께 끝맺는다.

    모델이든 도구든 물러선 답의 모양은 같다(까닭 + 사람이 읽을 한 줄): 끝맺는 자리도 하나다.
    """
    return _Emission(
        EventType.RUN_FAILED,
        {"reason": balked.reason, "message": balked.message},
        node.id,
    )
