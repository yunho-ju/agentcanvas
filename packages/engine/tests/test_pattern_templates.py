"""카탈로그의 템플릿을 이 문서에 채우기 — 앵커가 실제 노드가 되고, 못 채우면 값으로 말한다.

채운 결과는 지어낸 새 계약이 아니라 `agent.patch/v1`의 작업들이라, 기존 apply_patch·검증
게이트를 그대로 탄다. 여기서는 세 패턴이 (채움 성공 / 채울 수 없음) 두 갈래로 어떻게 되는지,
새 노드가 어디에 앉는지, 그리고 채운 patch가 실제로 문서에 붙는지를 본다.
"""

from __future__ import annotations

from typing import get_args

import pytest
from agentcanvas_contracts.agent_spec import AgentSpec
from agentcanvas_contracts.architect_patch import (
    AddEdgeOperation,
    AddNodeOperation,
    AgentSpecPatch,
    RemoveEdgeOperation,
    ReplaceNodeConfigOperation,
)
from agentcanvas_contracts.patterns import DEFAULT_PATTERNS, PatchTemplate
from agentcanvas_engine.architect_patch import apply_patch
from agentcanvas_engine.patterns.apply import (
    NEW_NODE_DROP_Y,
    CannotFillReason,
    TemplateCannotFill,
    fill_template,
)
from agentcanvas_engine.validator import Severity, validate_graph

A_CONNECTION = {
    "id": "records",
    "kind": "mcp",
    "server_ref": "mcp://records",
    "approval_policy": "read_only_auto",
}
A_CONNECTION_WITH_A_TOOL = {
    **A_CONNECTION,
    "tools": [
        {
            "name": "look-up",
            "plain_description": {"ko": "찾아본다.", "en": "Looks it up."},
            "input_schema": {"type": "object"},
            "output_schema": {"type": "object"},
            "timeout_ms": 5000,
            "call": {"transport": "mcp", "remote_name": "look-up"},
        }
    ],
}
AN_INPUT = {
    "id": "start",
    "type": "core.input",
    "position": {"x": 0, "y": 0},
    "config": {"bindings": {"question": "input.question"}},
}
AN_AGENT = {
    "id": "clinical-agent",
    "type": "llm.agent",
    "position": {"x": 200, "y": 0},
    "config": {"model_ref": "model://claude-sonnet", "toolset_refs": ["records"]},
}
ANOTHER_AGENT = {**AN_AGENT, "id": "second-agent", "position": {"x": 200, "y": 200}}
AN_OUTPUT = {
    "id": "answer",
    "type": "core.output",
    "position": {"x": 400, "y": 0},
    "config": {"binding": "state.answer"},
}
AN_EDGE_TO_THE_ANSWER = {
    "id": "agent-answer",
    "kind": "data",
    "source": {"node": "clinical-agent", "port": "response"},
    "target": {"node": "answer", "port": "input"},
}


def a_document(
    nodes: list[dict],
    edges: list[dict] | None = None,
    resources: list[dict] | None = None,
) -> AgentSpec:
    spec = AgentSpec.model_validate(
        {
            "schema_version": "agent.spec/v1",
            "id": "template-case",
            "version": 1,
            "revision": "sha256:" + "0" * 64,
            "status": "draft",
            "input_schema": {
                "type": "object",
                "properties": {"question": {"type": "string"}},
            },
            "state_schema": {"type": "object"},
            "nodes": nodes,
            "edges": edges or [],
            "resources": [A_CONNECTION] if resources is None else resources,
        }
    )
    return spec.model_copy(update={"revision": spec.computed_revision()})


def a_whole_document() -> AgentSpec:
    return a_document([AN_INPUT, AN_AGENT, AN_OUTPUT], [AN_EDGE_TO_THE_ANSWER])


def filled(pattern_id: str, spec: AgentSpec, **choosing: str):
    return fill_template(DEFAULT_PATTERNS[pattern_id].template, spec, **choosing)


def placed(operations: list) -> list[AddNodeOperation]:
    return [op for op in operations if isinstance(op, AddNodeOperation)]


def applied(pattern_id: str, spec: AgentSpec) -> AgentSpec:
    operations = filled(pattern_id, spec)
    assert not isinstance(operations, TemplateCannotFill)
    return apply_patch(
        spec,
        AgentSpecPatch(
            schema_version="agent.patch/v1",
            base_revision=spec.revision,
            operations=operations,
        ),
    )


class TestLookingThingsUp:
    def test_it_raises_the_turns_of_the_agent_the_document_already_has(self):
        operations = filled("react", a_whole_document())

        assert operations == [
            ReplaceNodeConfigOperation(
                op="replace_node_config",
                node_id="clinical-agent",
                config={
                    "model_ref": "model://claude-sonnet",
                    "toolset_refs": ["records"],
                    "max_turns": 3,
                },
            )
        ]

    def test_an_agent_that_picked_no_tool_is_told_to_pick_one(self):
        """못 쓰는 칸을 켜 두지 않는다 — 도구가 없으면 턴을 늘려도 달라지는 것이 없다."""
        tool_less = {**AN_AGENT, "config": {"model_ref": "model://claude-sonnet"}}

        cannot = filled(
            "react",
            a_document(
                [AN_INPUT, tool_less, AN_OUTPUT], resources=[A_CONNECTION_WITH_A_TOOL]
            ),
        )

        assert isinstance(cannot, TemplateCannotFill)
        assert cannot.reason == "needs_tools"
        assert "골라" in cannot.message.ko and "Pick" in cannot.message.en

    def test_a_document_with_no_tool_anywhere_says_where_to_make_one(self):
        """고를 것이 없는데 고르라고 하지 않는다 — 만드는 길을 가리킨다 (DESIGN §7)."""
        tool_less = {**AN_AGENT, "config": {"model_ref": "model://claude-sonnet"}}

        cannot = filled(
            "react", a_document([AN_INPUT, tool_less, AN_OUTPUT], resources=[])
        )

        assert isinstance(cannot, TemplateCannotFill)
        assert cannot.reason == "no_tools_anywhere"
        assert "연결 패널" in cannot.message.ko
        assert "connections panel" in cannot.message.en

    def test_the_two_tool_troubles_do_not_answer_to_the_same_name(self):
        """부르는 쪽은 이름으로 문구를 고른다 — 다른 사정이면 이름도 달라야 한다."""
        tool_less = {**AN_AGENT, "config": {"model_ref": "model://claude-sonnet"}}
        nothing_to_pick = filled(
            "react", a_document([AN_INPUT, tool_less, AN_OUTPUT], resources=[])
        )
        picked_none = filled(
            "react",
            a_document(
                [AN_INPUT, tool_less, AN_OUTPUT], resources=[A_CONNECTION_WITH_A_TOOL]
            ),
        )

        assert isinstance(nothing_to_pick, TemplateCannotFill)
        assert isinstance(picked_none, TemplateCannotFill)
        assert nothing_to_pick.reason != picked_none.reason

    def test_an_agent_naming_a_connection_this_document_lacks_has_no_tools(self):
        stranger = {**AN_AGENT, "config": {"toolset_refs": ["somewhere-else"]}}

        cannot = filled(
            "react",
            a_document(
                [AN_INPUT, stranger, AN_OUTPUT], resources=[A_CONNECTION_WITH_A_TOOL]
            ),
        )

        assert isinstance(cannot, TemplateCannotFill)
        assert cannot.reason == "needs_tools"

    def test_a_document_with_no_agent_says_it_cannot_be_filled(self):
        cannot = filled("react", a_document([AN_INPUT, AN_OUTPUT]))

        assert isinstance(cannot, TemplateCannotFill)
        assert cannot.reason == "missing_node"
        assert cannot.message.ko.strip() and cannot.message.en.strip()


class TestAPersonCheckingFirst:
    def test_the_gate_takes_the_place_of_the_agent_s_own_way_out(self):
        after = applied("human_gate", a_whole_document())

        assert [node.type for node in after.nodes].count("control.human_gate") == 1
        assert AN_EDGE_TO_THE_ANSWER["id"] not in [edge.id for edge in after.edges]
        feeding_the_answer = [
            edge.source.node for edge in after.edges if edge.target.node == "answer"
        ]
        assert feeding_the_answer == ["gate"]

    def test_the_new_node_does_not_take_a_name_the_document_already_uses(self):
        taken = {**AN_INPUT, "id": "gate"}
        spec = a_document([taken, AN_AGENT, AN_OUTPUT])

        assert placed(filled("human_gate", spec))[0].node.id != "gate"

    def test_an_agent_that_does_not_yet_reach_the_answer_loses_no_connection(self):
        operations = filled("human_gate", a_document([AN_AGENT, AN_OUTPUT]))

        assert [op for op in operations if isinstance(op, RemoveEdgeOperation)] == []

    def test_a_document_with_no_answer_node_says_it_cannot_be_filled(self):
        cannot = filled("human_gate", a_document([AN_INPUT, AN_AGENT]))

        assert isinstance(cannot, TemplateCannotFill)
        assert cannot.reason == "missing_node"


class TestSeveralDifferentJobs:
    def test_the_fork_takes_the_value_the_input_node_actually_hands_out(self):
        operations = filled("router", a_whole_document())
        into_the_fork = [
            op
            for op in operations
            if isinstance(op, AddEdgeOperation) and op.edge.source.node == "start"
        ]

        assert into_the_fork[0].edge.source.port == "question"

    def test_an_input_node_that_hands_out_nothing_says_it_cannot_be_filled(self):
        empty_handed = {**AN_INPUT, "config": {"bindings": {}}}

        cannot = filled("router", a_document([empty_handed, AN_AGENT, AN_OUTPUT]))

        assert isinstance(cannot, TemplateCannotFill)
        assert cannot.reason == "unknown_port"
        assert "start" in cannot.message.en

    def test_a_document_with_no_input_node_says_it_cannot_be_filled(self):
        cannot = filled("router", a_document([AN_AGENT, AN_OUTPUT]))

        assert isinstance(cannot, TemplateCannotFill)
        assert cannot.reason == "missing_node"


class TestWhichNodeTheTemplateMeans:
    def test_two_agents_leave_it_asking_which_one_rather_than_guessing(self):
        spec = a_document([AN_INPUT, AN_AGENT, ANOTHER_AGENT, AN_OUTPUT])

        cannot = filled("react", spec)

        assert isinstance(cannot, TemplateCannotFill)
        assert cannot.reason == "ambiguous_anchor"
        assert cannot.message.ko.strip() and cannot.message.en.strip()

    def test_the_node_a_person_chose_is_the_one_it_changes(self):
        spec = a_document([AN_INPUT, AN_AGENT, ANOTHER_AGENT, AN_OUTPUT])

        operations = filled("react", spec, anchor="second-agent")

        assert not isinstance(operations, TemplateCannotFill)
        assert operations[0].node_id == "second-agent"

    def test_a_chosen_node_of_another_kind_does_not_stand_in_for_the_agent(self):
        spec = a_document([AN_INPUT, AN_AGENT, ANOTHER_AGENT, AN_OUTPUT])

        cannot = filled("react", spec, anchor="start")

        assert isinstance(cannot, TemplateCannotFill)
        assert cannot.reason == "ambiguous_anchor"

    def test_the_other_anchors_still_stand_on_the_only_node_of_their_kind(self):
        spec = a_document(
            [AN_INPUT, AN_AGENT, ANOTHER_AGENT, AN_OUTPUT], [AN_EDGE_TO_THE_ANSWER]
        )

        operations = filled("human_gate", spec, anchor="clinical-agent")

        assert not isinstance(operations, TemplateCannotFill)
        assert [op for op in operations if isinstance(op, RemoveEdgeOperation)] != []


class TestWhereTheNewNodeSits:
    def test_a_gate_sits_between_the_two_nodes_it_comes_between(self):
        node = placed(filled("human_gate", a_whole_document()))[0].node

        assert (node.position.x, node.position.y) == (300, 0)

    def test_a_fork_sits_between_what_feeds_it_and_what_it_feeds(self):
        node = placed(filled("router", a_whole_document()))[0].node

        assert (node.position.x, node.position.y) == (100, 0)

    def test_a_taken_spot_pushes_the_new_node_one_card_down(self):
        in_the_way = {**AN_INPUT, "id": "note", "position": {"x": 300, "y": 0}}
        spec = a_document(
            [AN_INPUT, AN_AGENT, in_the_way, AN_OUTPUT], [AN_EDGE_TO_THE_ANSWER]
        )

        node = placed(filled("human_gate", spec))[0].node

        assert (node.position.x, node.position.y) == (300, NEW_NODE_DROP_Y)

    def test_a_node_with_nothing_to_sit_between_stands_beside_the_others(self):
        lonely: PatchTemplate = [
            op
            for op in DEFAULT_PATTERNS["human_gate"].template
            if getattr(op, "op", None) == "add_node"
        ]

        node = placed(fill_template(lonely, a_whole_document()))[0].node

        assert node.position.x > AN_OUTPUT["position"]["x"]


class TestATemplateThatPointsAtWhatIsNotThereYet:
    def test_asking_a_node_it_has_not_placed_for_a_value_cannot_be_filled(self):
        pointing_ahead: PatchTemplate = [
            op
            for op in DEFAULT_PATTERNS["router"].template
            if getattr(op, "op", None) == "add_edge"
        ]
        pointing_ahead[0] = pointing_ahead[0].model_copy(
            update={
                "source": pointing_ahead[0].source.model_copy(
                    update={"node": "{new:router}"}
                )
            }
        )

        cannot = fill_template(pointing_ahead, a_whole_document())

        assert isinstance(cannot, TemplateCannotFill)
        assert cannot.reason == "missing_node"


def a_tool_less_agent() -> dict:
    return {**AN_AGENT, "config": {"model_ref": "model://claude-sonnet"}}


#: 못 채우는 까닭마다 그것을 실제로 만드는 문서 한 벌 — 이름과 문구가 함께 산다.
TROUBLES: dict[str, tuple[str, AgentSpec]] = {
    "missing_node": ("react", a_document([AN_INPUT, AN_OUTPUT])),
    "ambiguous_anchor": (
        "react",
        a_document([AN_INPUT, AN_AGENT, ANOTHER_AGENT, AN_OUTPUT]),
    ),
    "unknown_port": (
        "router",
        a_document([{**AN_INPUT, "config": {"bindings": {}}}, AN_AGENT, AN_OUTPUT]),
    ),
    "needs_tools": (
        "react",
        a_document(
            [AN_INPUT, a_tool_less_agent(), AN_OUTPUT],
            resources=[A_CONNECTION_WITH_A_TOOL],
        ),
    ),
    "no_tools_anywhere": (
        "react",
        a_document([AN_INPUT, a_tool_less_agent(), AN_OUTPUT], resources=[]),
    ),
}


def test_every_reason_a_template_can_give_is_one_a_document_really_makes():
    """이름만 늘어나는 일을 막는다 — 새 까닭에는 그것을 만드는 문서가 있어야 한다."""
    assert set(TROUBLES) == set(get_args(CannotFillReason.__value__))


@pytest.mark.parametrize("reason", sorted(TROUBLES))
def test_every_reason_carries_a_message_in_both_languages(reason: str):
    pattern_id, spec = TROUBLES[reason]

    cannot = filled(pattern_id, spec)

    assert isinstance(cannot, TemplateCannotFill)
    assert cannot.reason == reason
    assert cannot.message.ko.strip() and cannot.message.en.strip()


#: 아직 채우지 않은 설정 — 미리보기 게이트가 막지 않는 그 한 가지다 (api preview_of).
UNFINISHED_CONFIG = "node.invalid_config"


@pytest.mark.parametrize("pattern_id", sorted(DEFAULT_PATTERNS))
def test_the_document_each_pattern_makes_is_one_the_validator_accepts(pattern_id: str):
    """템플릿이 놓은 그림에는 구조의 잘못이 없다 — 빈 설정 칸은 서버나 사람이 채운다."""
    after = applied(pattern_id, a_whole_document())

    assert [
        issue
        for issue in validate_graph(after)
        if issue.severity is Severity.ERROR and issue.code != UNFINISHED_CONFIG
    ] == []


@pytest.mark.parametrize("pattern_id", sorted(DEFAULT_PATTERNS))
def test_filling_a_pattern_leaves_the_document_at_a_new_revision(pattern_id: str):
    after = applied(pattern_id, a_whole_document())

    assert after.revision != a_whole_document().revision
