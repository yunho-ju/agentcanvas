"""갈림길을 실제로 타는 실행 — 포트와 조건을 읽어, 선택된 연결이 닿는 노드만 일한다.

이 파일은 **실행을 어떻게 조율하는가**가 바뀔 때만 바뀐다: 차례(graph_walk)·노드가 하는
일(node_work)·기록의 모양(run_log)을 조립해 하나의 실행으로 만들고, 밖에는 그 실행을
시작하고 이어 달리게 하는 공개 API만 내놓는다.

판단(어느 길로 갈 것인가)은 밖에서 주입한다: 이 층에는 모델도 시계도 랜덤도 없다.
같은 그래프·같은 시작 시각·같은 판단이면 언제나 같은 이벤트가 나온다.
"""

from __future__ import annotations

import logging
from collections.abc import Callable, Iterable, Iterator, Mapping, Sequence
from dataclasses import dataclass, replace
from datetime import datetime, timedelta
from itertools import chain, count
from typing import Literal

from agentcanvas_contracts.agent_spec import AgentSpec, Edge, Node
from agentcanvas_contracts.run import ApprovalAnswer
from agentcanvas_contracts.run_events import EventType, RunEvent

from .edge_condition import Unsupported, evaluate
from .fake_runtime import EVENT_STEP_MS
from .graph_walk import _leaving_edges, _state_keys, _Walk
from .model_call import (
    Judge,
    ModelAsk,
    ModelBalked,
    ModelCall,
    ModelSaid,
    RouteAsk,
    first_way,
    judged_by,
    says_the_first_way,
)
from .node_work import (
    GATE,
    KIND_BY_NODE_TYPE,
    ROUTER,
    TOOL,
    _could_not_ask,
    _heard,
    _holds,
    _ref_of,
    _resumes,
    _ways_offered,
    kind_of,
)
from .run_log import (
    ROUTE,
    _answer_payload,
    _answers_from,
    _Emission,
    _nodes_that_worked,
    _state_from,
    _tells_of_another_graph,
)
from .skill_wear import WornSkills, skills_worn_by
from .tool_call import (
    FLOWS_OUT_OF_THE_ERROR_PORT,
    CallsATool,
    ToolAsk,
    ToolBalked,
    ToolReturned,
    just_echoes,
)
from .tool_work import (
    PORT_BY_OUTCOME,
    asks_the_person,
    checked,
    completed,
    input_for,
    is_allowed,
    points_at,
    requested,
    stopped,
    wants_approval,
)

#: 실행을 세우지는 않지만 사람이 알아야 하는 일을 적어 두는 곳 (사건으로 남길 자리가 없는 것들).
_LOG = logging.getLogger(__name__)


def _tells_of_skills_it_could_not_wear(node: Node, worn: WornSkills) -> None:
    """온전히 입지 못한 skill은 조용히 사라지지 않는다 — 실행은 계속하되 그 사실을 적어 둔다.

    두 가지 일이 같은 자리에서 말해진다: 문서에 없어 아예 못 입은 것과, 본문이 이번 물음의
    예산에 들어가지 못해 설명만 간 것. 사람이 고칠 자리는 둘 다 문서이고(validator가
    `skill.missing`으로 이미 말한다), 실행은 이 일을 사건으로 남길 자리가 없으므로 기록에만 적는다.
    """
    said = (
        (worn.missing, "which this agent does not have — skipping it"),
        (
            worn.over_budget,
            "whose body did not fit this question — sending its description alone",
        ),
    )
    for refs, why in said:
        for ref in refs:
            _LOG.warning("step %r wears the skill %r, %s", node.id, ref, why)


#: 사람의 답이 흘러나가는 두 포트 — 답에 따라 그중 한쪽의 연결만 흐른다.
PORT_BY_ANSWER = {True: "approved", False: "rejected"}


#: 지금이 언제인지 말해 주는 것 — 이 층에는 시계가 없으므로 사건마다 밖에 물어본다.
Clock = Callable[[], datetime]

#: 멈춰 선 실행을 이어 달릴 수 없는 까닭 — 남은 사건이 없거나, 멈춰 있지 않거나,
#: 어디서 멈췄는지 말하지 않거나, 다른 판의 이야기이거나.
CannotResume = Literal[
    "no_events",
    "not_paused",
    "nowhere_to_answer",
    "another_revision",
]


@dataclass(frozen=True)
class _CannotRead:
    """읽지 못한 조건 — 어느 연결의 어떤 말이었는지 값으로 들고 온다 (예외 대신 답)."""

    edge: Edge
    expression: str


class _Flow:
    """실행 한 번이 그래프를 걸어가는 동안의 일 — 어디까지 갔고, 상태에 무엇이 적혔는가."""

    def __init__(
        self,
        spec: AgentSpec,
        model: ModelCall,
        state: Mapping[str, object],
        already_worked: Sequence[str],
        answers: Mapping[str, ApprovalAnswer] | None = None,
        already_reached: Sequence[str] = (),
        already_said: Mapping[str, object] | None = None,
        tool: CallsATool = just_echoes,
        already_took: Mapping[str, str] | None = None,
    ) -> None:
        self._spec = spec
        self._model = model
        self._tool = tool
        self._state = dict(state)
        #: 물어보거나 부르지 못해 실행이 끝맺어야 하는 까닭 — 그 자리에서 값으로 받는다.
        self._balked: ModelBalked | ToolBalked | None = None
        #: 이미 이벤트로 남은 노드들 — 다시 걸어도 사건을 두 번 내지 않는다.
        self._already_worked = set(already_worked)
        self._already_reached = [*already_worked, *already_reached]
        self._worked = set(already_worked)
        self._answers = dict(answers or {})
        self._kept = _state_keys(spec)
        self._by_id = {node.id: node for node in spec.nodes}
        #: 노드마다 그 노드가 낸 것 — 다음 노드가 앞 노드의 답을 보는 자리다.
        #: 이어 달리는 실행은 이미 낸 말을 이벤트에서 받아 온다 (같은 자리에서 다시 흐른다).
        self._came_out_of: dict[str, object] = dict(already_said or {})
        #: 노드마다 그 결과가 나간 포트 — 사람의 답도, 도구의 성패도 여기로 갈래를 가른다.
        #: 이어 달리는 실행은 이미 난 갈래를 이벤트에서 받아 온다 (같은 갈래가 다시 흐른다).
        self._went_out_by: dict[str, str] = dict(already_took or {})

    def go(self) -> Iterator[list[_Emission]]:
        """그래프를 층위 순서로 걷는다 — 앞선 노드가 다 결판난 뒤에야 다음 노드가 일한다.

        걸으며 노드 하나가 낸 사건들을 그때그때 내놓는다: 듣는 쪽은 실행이 끝나기를 기다리지 않는다.
        조건이 거짓이라 흐르지 않은 연결도 '결판'이다: 오지 않을 값을 영영 기다리지 않는다.
        닿지 않은 노드는 일하지 않고, 그 뒤도 닿지 않은 것으로 결판난다.
        """
        walk = _Walk(self._spec, self._already_reached)
        while (node_id := walk.next_to_settle()) is not None:
            if not walk.was_reached(node_id):
                walk.settle(node_id, [])
                continue
            said, chosen = self._runs(self._by_id[node_id])
            if said:
                yield said
            if chosen is None:
                return
            walk.settle(node_id, chosen)
        yield [_Emission(EventType.RUN_COMPLETED, {"node_count": len(self._worked)})]

    def _runs(self, node: Node) -> tuple[list[_Emission], list[Edge] | None]:
        """노드 하나가 낸 사건들과, 그 결과가 어느 연결로 흘러가는가 — 멈추거나 실패하면 없음.

        이미 이벤트로 남은 노드는 조용히 다시 지난다: 사건은 두 번 나지 않고 상태만 이어진다.
        """
        again = node.id in self._already_worked
        answer = self._answers.get(node.id)
        # 사람의 답이 나가는 두 포트는 밸브의 것이다 — 도구는 result/error로 스스로 가른다.
        if answer is not None and kind_of(node).waits_for_person:
            self._went_out_by[node.id] = PORT_BY_ANSWER[answer.approved]
        if kind_of(node).waits_for_person and answer is None:
            # 답이 오기 전에는 어느 갈래도 흐르지 않는다 — 답이 적히지 않은 옛 기록도 다시 묻지 않는다.
            if again:
                return [], []
            return _holds(node), None
        if not again and answer is None:
            # 부를 때마다 물어보는 연결의 도구는 부르기 전에 멈춰 사람을 기다린다 (기존 hold 재사용).
            asking = self._asks_before_the_tool(node)
            if asking is not None:
                return asking, None
        said: list[_Emission] = []
        if not again:
            said.extend(self._works(node, answer))
            self._worked.add(node.id)
        if self._balked is not None:
            return [*said, _could_not_ask(node, self._balked)], None
        chosen = self._chosen(node, answer)
        if isinstance(chosen, _CannotRead):
            return [*said, _cannot_read(chosen)], None
        for edge in chosen:
            crossing = self._crossing(edge)
            if not again:
                said.extend(crossing)
        return said, chosen

    def _works(self, node: Node, answer: ApprovalAnswer | None) -> list[_Emission]:
        """노드 하나가 차례를 받아 일을 마치기까지 — 사람을 기다리던 노드는 답을 받고 마친다.

        모델에게 물어보지 못한 노드는 마쳤다고 말하지 않는다: 일어나지 않은 일을 적지 않는다.
        """
        if answer is None:
            own = self._starts_and_finishes(node)
        elif kind_of(node).runs_a_tool:
            own = self._resumes_a_tool(node, answer)
        else:
            own = _resumes(node, answer)
        return [replace(emission, node_id=node.id) for emission in own]

    def _starts_and_finishes(self, node: Node) -> list[_Emission]:
        """차례가 온 노드가 시작해 일하고 마치기까지 — 어그러지면 마침은 없다."""
        working = [
            _Emission(EventType.NODE_QUEUED, {"node_type": node.type}),
            _Emission(EventType.NODE_STARTED, {"node_type": node.type}),
            *kind_of(node).work(self, node),
        ]
        if self._balked is not None:
            return working
        return [*working, _Emission(EventType.NODE_COMPLETED, {"node_type": node.type})]

    def ways_from(self, node: Node) -> tuple[str, ...]:
        """이 갈림길이 고를 수 있는 길 이름들 — 나가는 조건들이 바라는 값에서 읽는다."""
        return _ways_offered(self._spec, node)

    def asks_a_model(
        self, node: Node, ways: tuple[str, ...] = ()
    ) -> tuple[list[_Emission], ModelSaid | None]:
        """노드 하나가 모델에게 물어보는 일 — 들은 것은 사건으로 남고, 못 들었으면 흐름이 끝난다.

        물어보지 못한 까닭은 예외가 아니라 값으로 온다: 실행은 터지지 않고 그 까닭을 기억해 둔다.
        """
        # 공백 한 칸은 적은 것이 아니다 — 지시가 없으면 이름표 폴백이 살아 있어야 한다.
        told = node.config.get("instruction")
        written = told if isinstance(told, str) and told.strip() else None
        worn = skills_worn_by(self._spec, node)
        _tells_of_skills_it_could_not_wear(node, worn)
        ask = ModelAsk(
            node=node,
            state=dict(self._state),
            ways=ways,
            model_ref=_ref_of(node, "model_ref", "model://default"),
            prompt_ref=_ref_of(node, "prompt_ref", f"prompt://{node.id}@1"),
            instruction=written if isinstance(written, str) else None,
            skills=worn.briefs,
        )
        heard = self._model(ask)
        if isinstance(heard, ModelBalked):
            self._balked = heard
            return [], None
        if not ways and heard.text is not None:
            # 말하기 노드가 들은 말이 그 노드가 낸 것이다 — 지어낼 말이 없는 대역 뒤에서는 낸 것도 없다.
            # 갈림길이 낸 것은 고른 길이고 그 자리는 route다: 길을 담아 온 봉투는 흘려보내지 않는다.
            self._came_out_of[node.id] = heard.text
        return _heard(ask, heard), heard

    def calls_a_tool(self, node: Node) -> list[_Emission]:
        """노드 하나가 바깥 도구를 한 번 부르는 일 — 확인하고, 부르고, 받은 것을 적는다.

        문서·정책의 문제(가리킨 연결·도구가 없다, 허락하지 않는다, 열쇠가 없다, 아직 부를
        수 없는 종류다)는 사람이 고칠 일이라 실행을 끝맺는다. 이번 호출이 어그러진 것
        (시간 초과·저쪽의 잘못·읽을 수 없는 답)은 그래프가 다룰 수 있으므로 error 포트로 흐른다.
        """
        found = points_at(self._spec, node)
        if isinstance(found, ToolBalked):
            self._balked = found
            return []
        binding, tool = found
        allowed = is_allowed(binding, tool)
        told = [checked(node, binding, tool, allowed)]
        if not allowed:
            self._balked = ToolBalked(
                reason="not_allowed",
                message=(
                    f"connection {binding.id!r} does not allow the tool {tool.name!r}"
                ),
            )
            return told
        return [*told, *self._makes_the_call(node, binding, tool)]

    def _makes_the_call(self, node: Node, binding, tool) -> list[_Emission]:
        """실제로 도구를 부르는 자리 — 부탁하고, 받은 것(또는 어그러진 까닭)을 적는다.

        정책 확인(allowed_tools)은 이미 앞에서 끝났다: 이 자리는 부르는 일만 한다.
        """
        given = input_for(tool, self._state)
        told = [requested(node, binding, tool, given)]
        answer = self._tool(ToolAsk(node=node, binding=binding, tool=tool, input=given))
        if (
            isinstance(answer, ToolBalked)
            and answer.reason not in FLOWS_OUT_OF_THE_ERROR_PORT
        ):
            # 부르지 못한 까닭이 문서에 있으면 도구가 끝났다고 적지 않는다.
            self._balked = answer
            return told
        self._took(node, answer)
        return [*told, completed(node, binding, tool, answer)]

    def _asks_before_the_tool(self, node: Node) -> list[_Emission] | None:
        """부를 때마다 물어보는 연결의 도구는 부르기 전에 멈춰 사람을 기다린다.

        gate와 같은 hold를 쓰되, 무엇을 승인하는지(어느 도구 호출)를 함께 적는다.
        읽지 못하는 문서·못 쓰는 도구는 여기서 멈추지 않고 평소의 balk 자리로 흘려보낸다:
        사람에게 승인하라고 청하기 전에 그 그림이 성립해야 한다.
        """
        if not kind_of(node).runs_a_tool:
            return None
        found = points_at(self._spec, node)
        if isinstance(found, ToolBalked):
            return None
        binding, tool = found
        if not is_allowed(binding, tool) or not wants_approval(binding):
            return None
        return [
            _Emission(EventType.NODE_QUEUED, {"node_type": node.type}, node.id),
            _Emission(EventType.NODE_STARTED, {"node_type": node.type}, node.id),
            replace(checked(node, binding, tool, True), node_id=node.id),
            asks_the_person(node, binding, tool),
            _Emission(EventType.RUN_PAUSED, {"waiting_for": node.id}, node.id),
        ]

    def _resumes_a_tool(self, node: Node, answer: ApprovalAnswer) -> list[_Emission]:
        """사람이 답한 뒤 도구 노드가 마치는 일 — 허락하면 부르고, 멈추면 부르지 않는다.

        정책 확인은 멈춰 설 때 이미 적혔다: 여기서 다시 적지 않는다.
        허락하면 그때 도구를 부르고(정확히 한 번), 멈추면 error 포트로 "사람이 멈췄어요"가
        흐른다 — 부르지 않은 것을 적지 않는다.
        """
        # 무엇을 답했는지 함께 적는다 — 사람이 멈춘 자리는 초록불이 아니라 '멈춤'으로 보인다
        # (control.human_gate 거절과 같은 세 번째 결말을 화면이 재사용한다).
        said = _answer_payload(answer)
        resumed = _Emission(EventType.RUN_RESUMED, {"waiting_for": node.id, **said})
        if not answer.approved:
            self._came_out_of[node.id] = stopped(node)
            self._went_out_by[node.id] = PORT_BY_OUTCOME[False]
            return [
                resumed,
                _Emission(EventType.NODE_COMPLETED, {"node_type": node.type, **said}),
            ]
        found = points_at(self._spec, node)
        # 멈춰 설 때 성립했던 그림이라 여기서는 언제나 연결·도구를 찾는다.
        assert not isinstance(found, ToolBalked)
        binding, tool = found
        calls = self._makes_the_call(node, binding, tool)
        if self._balked is not None:
            return [resumed, *calls]
        return [
            resumed,
            *calls,
            _Emission(EventType.NODE_COMPLETED, {"node_type": node.type}),
        ]

    def _took(self, node: Node, answer: ToolReturned | ToolBalked) -> None:
        """도구가 낸 것과 그것이 나가는 포트를 기억한다 — 다음 노드가 그 자리에서 받는다."""
        ok = isinstance(answer, ToolReturned)
        self._came_out_of[node.id] = (
            answer.result
            if isinstance(answer, ToolReturned)
            else {"reason": answer.reason, "message": answer.message}
        )
        self._went_out_by[node.id] = PORT_BY_OUTCOME[ok]

    def picks_a_way(
        self, node: Node, ways: tuple[str, ...], heard: ModelSaid
    ) -> list[_Emission]:
        """갈림길 노드가 길을 고르는 일 — 고른 길은 상태에 적히고 사건으로 남는다.

        모델이 고른 길이 없으면 아무 결정도 일어나지 않는다: 일어나지 않은 결정을 적지 않고,
        상태의 길 자리도 건드리지 않는다 (통로만 그대로 흐른다).
        """
        way = heard.way
        if not ways or way is None:
            return []
        self._state[ROUTE] = way
        return [
            _Emission(EventType.DECISION_RECORDED, {"route": way, "ways": list(ways)}),
            *self._remembers(node, way),
        ]

    def _remembers(self, node: Node, way: str) -> list[_Emission]:
        """고른 길이 상태에 적히는 일 — 그래프가 그 자리를 기억할 때만 남는다."""
        if ROUTE not in self._kept:
            return []
        return [
            _Emission(
                EventType.STATE_PATCH,
                {
                    "from": node.id,
                    "to": ROUTE,
                    "patch": [{"op": "replace", "path": f"/{ROUTE}", "value": way}],
                },
            )
        ]

    def _chosen(
        self, node: Node, answer: ApprovalAnswer | None
    ) -> list[Edge] | _CannotRead:
        """이 노드에서 나가는 연결 중 흐르는 것들 — 읽지 못한 조건은 값으로 돌려준다.

        결과가 어느 포트로 나갔는지 아는 노드에서는 그 포트의 연결만 흐른다: 승인과 거절이
        다른 갈래이듯, 도구가 낸 것과 어그러진 까닭도 다른 갈래다 (한 자리에서 갈린다).
        """
        chosen: list[Edge] = []
        took = self._went_out_by.get(node.id)
        for edge in _leaving_edges(self._spec, node.id):
            if took is not None and edge.source.port != took:
                continue
            if edge.condition is None:
                chosen.append(edge)
                continue
            flows = evaluate(edge.condition.expression, self._state)
            if isinstance(flows, Unsupported):
                return _CannotRead(edge, flows.expression)
            if flows:
                chosen.append(edge)
        return chosen

    def _remembers_crossing(self, edge: Edge) -> str | None:
        """연결을 건너간 값을 상태에 적는다 — 그래프가 기억하는 자리가 아니면 적지 않는다.

        건너가는 것은 그 노드가 낸 것이다. 아직 아무것도 내놓은 적 없는 노드에서는 그 자리에
        무엇이 오는지만 적어 둔다 — 지어낸 답이 아니라 아직 비어 있다는 표시다.
        """
        if edge.target.port not in self._kept:
            return None
        # payload는 기계가 주고받는 자리다 — 화면 문구가 아니므로 언어를 타지 않는다.
        said = self._came_out_of.get(edge.source.node)
        value = (
            said
            if said is not None
            else f"result of {edge.source.node}.{edge.source.port}"
        )
        self._state[edge.target.port] = value
        return value

    def _crossing(self, edge: Edge) -> list[_Emission]:
        """연결을 건너간 값이 상태에 적히는 일 — 그래프가 기억하는 자리일 때만 남는다."""
        value = self._remembers_crossing(edge)
        if value is None:
            return []
        return [
            _Emission(
                EventType.STATE_PATCH,
                {
                    "edge_id": edge.id,
                    "from": edge.source.node,
                    "to": edge.target.node,
                    "patch": [
                        {
                            "op": "replace",
                            "path": f"/{edge.target.port}",
                            "value": value,
                        }
                    ],
                },
            )
        ]


def _cannot_read(cannot: _CannotRead) -> _Emission:
    """읽지 못하는 조건 앞에서는 멈춘다 — 조용히 흘려보내지도, 조용히 막지도 않는다."""
    edge_id = cannot.edge.id
    return _Emission(
        EventType.RUN_FAILED,
        {
            "edge_id": edge_id,
            "expression": cannot.expression,
            "message": f"the condition on edge {edge_id!r} is not one this runtime reads",
        },
    )


def _stamped(
    spec: AgentSpec,
    run_id: str,
    clock: Clock,
    batches: Iterable[Sequence[_Emission]],
    start: int = 0,
) -> Iterator[list[RunEvent]]:
    """아직 순번과 시각이 없는 사건 묶음들에 그것을 매긴다 — 시각은 언제나 시계가 말해 준다.

    순번은 시계와 무관하게 이어지는 정수다: 시간이 어떻게 흐르든 실행의 차례는 하나뿐이다.
    빈 묶음은 흘려보내지 않는다 — 아무 일도 없었다는 말을 듣는 쪽에 보내지 않는다.
    """
    seqs = count(start)
    for batch in batches:
        stamped = [
            RunEvent(
                seq=next(seqs),
                run_id=run_id,
                event_type=emission.event_type,
                timestamp=clock(),
                spec_revision=spec.revision,
                payload=emission.payload,
                node_id=emission.node_id,
            )
            for emission in batch
        ]
        if stamped:
            yield stamped


def _even_beat(started_at: datetime, start: int = 0) -> Clock:
    """부를 때마다 한 박자씩 나아가는 시계 — 일괄 실행이 예나 지금이나 같은 박자로 흐르는 자리."""
    beats = count(start)
    return lambda: started_at + timedelta(milliseconds=next(beats) * EVENT_STEP_MS)


def _opening(spec: AgentSpec, input: Mapping[str, object] | None) -> _Emission:
    """실행이 열리는 사건 — 무엇을 건네받고 시작했는지도 여기 적힌다 (설계 §8).

    건넨 것이 없으면 그 자리도 없다: 아무것도 받지 않은 실행에 빈 자리를 지어내지 않는다.
    """
    payload: dict[str, object] = {"spec_id": spec.id}
    if input:
        payload["input"] = dict(input)
    return _Emission(EventType.RUN_STARTED, payload)


def routed_run_stream(
    spec: AgentSpec,
    run_id: str,
    clock: Clock,
    input: Mapping[str, object] | None = None,
    model: ModelCall = says_the_first_way,
    tool: CallsATool = just_echoes,
) -> Iterator[list[RunEvent]]:
    """그래프를 처음부터 돌리며, 노드 하나가 일할 때마다 그 사건들을 내놓는다.

    듣는 쪽은 실행이 끝나기를 기다리지 않는다 — 묶음이 나오는 대로 쌓으면 그것이 실행의 지금이다.
    시작하며 건네받은 것은 실행이 여는 상태다: 첫 노드부터 그것을 보고 일한다.
    """
    flow = _Flow(spec, model, state=input or {}, already_worked=[], tool=tool)
    yield from _stamped(
        spec, run_id, clock, chain([[_opening(spec, input)]], flow.go())
    )


def routed_run(
    spec: AgentSpec,
    run_id: str,
    started_at: datetime,
    input: Mapping[str, object] | None = None,
    model: ModelCall = says_the_first_way,
    tool: CallsATool = just_echoes,
) -> list[RunEvent]:
    """그래프를 처음부터 끝까지(또는 멈춰 설 때까지) 돌려 이벤트를 한 번에 돌려준다.

    점진 실행 위에 균일한 박자의 시계를 꽂은 것이다 — 시각까지 예전 실행과 같다.
    """
    beat = _even_beat(started_at)
    return list(
        chain.from_iterable(routed_run_stream(spec, run_id, beat, input, model, tool))
    )


def _spoken_events(
    spec: AgentSpec, events: Sequence[RunEvent]
) -> list[tuple[str, str]]:
    """말하는 노드가 낸 말들 — 일어난 순서 그대로, (노드 id, 말) 쌍이다.

    말은 그 노드가 마친 사건에 적혀 있다 (설계 §8 — 모델이 본 것도 말한 것도 기록된다).
    갈림길이 답한 봉투는 산출이 아니므로 여기서도 세지 않는다: 시작한 실행과 같은 규칙이다.
    """
    by_id = {node.id: node for node in spec.nodes}
    spoken: list[tuple[str, str]] = []
    for event in events:
        if event.event_type is not EventType.LLM_COMPLETED or event.node_id is None:
            continue
        node = by_id.get(event.node_id)
        said = event.payload.get("text")
        if node is None or not isinstance(said, str):
            continue
        if not _ways_offered(spec, node):
            spoken.append((node.id, said))
    return spoken


def _spoken_in(spec: AgentSpec, events: Sequence[RunEvent]) -> dict[str, str]:
    """이미 노드들이 낸 말 — 이어 달리는 실행도 앞 노드의 답을 그대로 본다.

    노드별로 마지막 값만 남는다: 같은 노드가 다시 일해 새로 말했으면 그 말로 덮인다.
    """
    return dict(_spoken_events(spec, events))


def spoken_llm_texts(spec: AgentSpec, events: Sequence[RunEvent]) -> list[str]:
    """말하는 노드들이 낸 말 — 갈림길 봉투는 빼고, 일어난 순서 그대로 공개한다.

    `_spoken_in`과 같은 규칙(갈림길 봉투 제외)을 쓰지만, 노드별로 마지막 값만 남기지
    않는다: "마지막으로 말한 것"이 필요한 자리(예: 배치 판정)를 위해 순서를 그대로 지킨다.
    """
    return [said for _node_id, said in _spoken_events(spec, events)]


def _gate_answers_in(
    spec: AgentSpec, events: Sequence[RunEvent]
) -> dict[str, ApprovalAnswer]:
    """사람이 답한 밸브들 — **control.human_gate만** 답을 남긴다.

    도구 노드도 node.completed에 approved를 적지만(거절이면 error 포트로 갈렸다는 표시일 뿐),
    그것은 밸브의 answer가 아니다. gate는 answer를 남기고 tool은 포트를 남긴다 — 두 벌로 겹쳐
    쓰지 않는다. 이 갈림이 없으면 거절된 도구가 answer로 오인돼 갈래가 어긋난다.
    """
    gate_ids = {node.id for node in spec.nodes if kind_of(node).waits_for_person}
    return {
        node_id: answer
        for node_id, answer in _answers_from(events).items()
        if node_id in gate_ids
    }


def _tool_events(events: Sequence[RunEvent]) -> Iterator[tuple[str, dict]]:
    """도구가 끝난 사건들 — (노드 id, 그때 적힌 것) 쌍이다."""
    for event in events:
        if event.event_type is EventType.TOOL_COMPLETED and event.node_id is not None:
            yield event.node_id, dict(event.payload)


def _tools_gave_in(events: Sequence[RunEvent]) -> dict[str, object]:
    """도구가 이미 낸 것 — 이어 달리는 실행은 그것을 이벤트에서 받아 온다.

    도구 결과가 사는 곳은 이 사건 하나뿐이다(P0c): 다시 부르지 않고 여기서 되살린다.
    """
    return {
        node_id: (told.get("result") if told.get("ok") else told.get("error"))
        for node_id, told in _tool_events(events)
    }


def _ports_taken_in(spec: AgentSpec, events: Sequence[RunEvent]) -> dict[str, str]:
    """도구 노드의 결과가 이미 나간 포트 — 이어 달려도 같은 갈래만 흐른다.

    도구가 불렸으면 tool.completed가 result/error를 가른다. 사람이 부르기 전에 멈춰 세운
    도구는 tool.completed가 없다 — 그 결말은 node.completed{approved:false}가 error 포트로
    말한다. 두 결말 모두 여기서 복원해야, 뒤이은 pause를 재개할 때 성공 갈래가 허위로 살아나지
    않는다(거절했는데 result 브랜치가 흐르는 거짓 초록불 금지).
    """
    tool_ids = {node.id for node in spec.nodes if kind_of(node).runs_a_tool}
    taken = {
        node_id: PORT_BY_OUTCOME[bool(told.get("ok"))]
        for node_id, told in _tool_events(events)
    }
    for event in events:
        if (
            event.event_type is EventType.NODE_COMPLETED
            and event.node_id in tool_ids
            and event.payload.get("approved") is False
        ):
            taken[event.node_id] = PORT_BY_OUTCOME[False]
    return taken


@dataclass(frozen=True)
class _CarriesOnFrom:
    """이어 달릴 자리 — 사람의 답을 기다리며 멈춰 선 밸브와, 거기까지 일어난 일들."""

    valve: str
    so_far: list[RunEvent]


def _read(spec: AgentSpec, events: Sequence[RunEvent]) -> _CarriesOnFrom | CannotResume:
    """일어난 일들을 읽어 이어 달릴 자리를 찾는다 — 못 찾으면 그 까닭을 값으로 돌려준다."""
    if not events:
        return "no_events"
    paused = events[-1]
    if paused.event_type is not EventType.RUN_PAUSED:
        return "not_paused"
    if paused.node_id is None:
        return "nowhere_to_answer"
    if _tells_of_another_graph(events, spec):
        return "another_revision"
    return _CarriesOnFrom(valve=paused.node_id, so_far=list(events))


def cannot_resume(spec: AgentSpec, events: Sequence[RunEvent]) -> CannotResume | None:
    """이 실행을 이어 달릴 수 없는 까닭 — 없으면 없음(이어 달릴 수 있다는 뜻).

    까닭은 값으로 답한다: 부르는 쪽이 왜 아무 일도 일어나지 않는지 알고 사람에게 말해 줄 수 있다.
    """
    read = _read(spec, events)
    return None if isinstance(read, _CarriesOnFrom) else read


def resume_routed_run_stream(
    spec: AgentSpec,
    events: Sequence[RunEvent],
    approval: ApprovalAnswer,
    clock: Clock,
    model: ModelCall = says_the_first_way,
    tool: CallsATool = just_echoes,
) -> Iterator[list[RunEvent]]:
    """멈춰 선 실행에 사람이 답한다 — 이어지는 새 사건들만 묶음으로 내놓는다.

    이미 걸은 길은 이벤트가 말해 준다: 일을 마친 노드는 다시 사건을 내지 않고, 고른 길과
    사람의 답도 이벤트에서 읽는다 (판단 주체를 다시 부르지 않는다).
    이어 달릴 수 없는 실행(`cannot_resume`)에서는 아무것도 나오지 않는다.
    """
    read = _read(spec, events)
    if not isinstance(read, _CarriesOnFrom):
        return
    so_far = read.so_far
    flow = _Flow(
        spec,
        model,
        state=_state_from(so_far),
        already_worked=_nodes_that_worked(so_far),
        answers={**_gate_answers_in(spec, so_far), read.valve: approval},
        already_reached=[read.valve],
        already_said={**_spoken_in(spec, so_far), **_tools_gave_in(so_far)},
        tool=tool,
        already_took=_ports_taken_in(spec, so_far),
    )
    yield from _stamped(spec, so_far[0].run_id, clock, flow.go(), start=len(so_far))


def resume_routed_run(
    spec: AgentSpec,
    events: Sequence[RunEvent],
    approval: ApprovalAnswer,
    model: ModelCall = says_the_first_way,
    tool: CallsATool = just_echoes,
) -> list[RunEvent]:
    """멈춰 선 실행에 사람이 답하고, 일어난 일 전부를 한 번에 돌려준다 (앞선 것 + 이어진 것).

    점진 실행 위에 균일한 박자의 시계를 꽂은 것이다 — 시각까지 예전 실행과 같다.
    이어 달릴 수 없는 실행에는 아무 일도 일어나지 않는다 (들어온 이벤트가 그대로 나온다).
    """
    so_far = list(events)
    if not so_far:
        return so_far
    beat = _even_beat(so_far[0].timestamp, len(so_far))
    carried_on = resume_routed_run_stream(spec, so_far, approval, beat, model, tool)
    return [*so_far, *chain.from_iterable(carried_on)]


__all__ = [
    "GATE",
    "KIND_BY_NODE_TYPE",
    "PORT_BY_ANSWER",
    "PORT_BY_OUTCOME",
    "ROUTE",
    "ROUTER",
    "TOOL",
    "CallsATool",
    "CannotResume",
    "Clock",
    "Judge",
    "ModelAsk",
    "ModelBalked",
    "ModelCall",
    "ModelSaid",
    "RouteAsk",
    "ToolAsk",
    "ToolBalked",
    "ToolReturned",
    "cannot_resume",
    "first_way",
    "judged_by",
    "just_echoes",
    "resume_routed_run",
    "resume_routed_run_stream",
    "routed_run",
    "routed_run_stream",
    "spoken_llm_texts",
]
