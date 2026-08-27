import pytest
from agentcanvas_contracts.agent_spec import (
    AgentSpec,
    AgentStatus,
    EdgeKind,
    Node,
    Position,
)
from agentcanvas_contracts.architect_patch import AgentSpecPatch
from agentcanvas_engine.architect_patch import PatchApplyError, apply_patch


def a_spec() -> AgentSpec:
    draft = AgentSpec(
        schema_version="agent.spec/v1",
        id="demo",
        name="Demo",
        version=4,
        revision="sha256:" + "0" * 64,
        status=AgentStatus.APPROVED,
        input_schema={"type": "object"},
        state_schema={"type": "object"},
        nodes=[
            Node(
                id="input",
                type="core.input",
                position=Position(x=0, y=0),
                config={"bindings": {"question": "input.question"}},
            ),
            Node(
                id="output",
                type="core.output",
                position=Position(x=240, y=0),
                config={"binding": "state.answer"},
            ),
        ],
        edges=[
            {
                "id": "input-output",
                "kind": EdgeKind.DATA,
                "source": {"node": "input", "port": "question"},
                "target": {"node": "output", "port": "input"},
            }
        ],
        resources=[],
        execution=None,
    )
    return draft.model_copy(update={"revision": draft.computed_revision()})


def a_patch(base: AgentSpec, *operations: dict) -> AgentSpecPatch:
    return AgentSpecPatch(
        schema_version="agent.patch/v1",
        base_revision=base.revision,
        operations=list(operations),
    )


def test_operations_are_applied_in_order_without_mutating_the_base():
    base = a_spec()
    patch = a_patch(
        base,
        {
            "op": "add_node",
            "node": {
                "id": "worker",
                "type": "llm.agent",
                "position": {"x": 120, "y": 0},
                "config": {},
            },
        },
        {"op": "replace_node_config", "node_id": "worker", "config": {"mode": "draft"}},
        {
            "op": "add_edge",
            "edge": {
                "id": "input-worker",
                "kind": "data",
                "source": {"node": "input", "port": "question"},
                "target": {"node": "worker", "port": "input"},
            },
        },
    )

    candidate = apply_patch(base, patch)

    assert [node.id for node in candidate.nodes] == ["input", "output", "worker"]
    assert candidate.nodes[-1].config == {"mode": "draft"}
    assert [edge.id for edge in candidate.edges] == ["input-output", "input-worker"]
    assert candidate.version == 5
    assert candidate.status is AgentStatus.DRAFT
    assert candidate.revision == candidate.computed_revision()
    assert [node.id for node in base.nodes] == ["input", "output"]
    assert base.version == 4


def test_a_connected_node_must_have_edges_removed_first():
    base = a_spec()
    patch = a_patch(base, {"op": "remove_node", "node_id": "input"})

    with pytest.raises(PatchApplyError) as caught:
        apply_patch(base, patch)

    assert caught.value.reason == "attached_node"


def test_removing_the_edge_then_the_node_is_allowed():
    base = a_spec()
    patch = a_patch(
        base,
        {"op": "remove_edge", "edge_id": "input-output"},
        {"op": "remove_node", "node_id": "input"},
    )

    candidate = apply_patch(base, patch)

    assert [node.id for node in candidate.nodes] == ["output"]
    assert candidate.edges == []


@pytest.mark.parametrize(
    ("operation", "reason"),
    [
        (
            {
                "op": "add_node",
                "node": {
                    "id": "input",
                    "type": "core.input",
                    "position": {"x": 0, "y": 0},
                    "config": {},
                },
            },
            "duplicate_node",
        ),
        ({"op": "remove_node", "node_id": "missing"}, "unknown_node"),
        (
            {"op": "replace_node_config", "node_id": "missing", "config": {}},
            "unknown_node",
        ),
        (
            {
                "op": "add_edge",
                "edge": {
                    "id": "input-output",
                    "kind": "data",
                    "source": {"node": "input", "port": "question"},
                    "target": {"node": "output", "port": "input"},
                },
            },
            "duplicate_edge",
        ),
        ({"op": "remove_edge", "edge_id": "missing"}, "unknown_edge"),
    ],
)
def test_conflicts_are_values_not_partial_candidates(operation: dict, reason: str):
    base = a_spec()

    with pytest.raises(PatchApplyError) as caught:
        apply_patch(base, a_patch(base, operation))

    assert caught.value.reason == reason


def test_a_stale_base_revision_is_rejected_before_any_operation_runs():
    base = a_spec()
    patch = AgentSpecPatch(
        schema_version="agent.patch/v1",
        base_revision="sha256:" + "f" * 64,
        operations=[{"op": "remove_edge", "edge_id": "input-output"}],
    )

    with pytest.raises(PatchApplyError) as caught:
        apply_patch(base, patch)

    assert caught.value.reason == "stale_revision"
    assert base.edges[0].id == "input-output"


def test_a_base_with_a_forged_revision_is_not_a_valid_patch_anchor():
    base = a_spec().model_copy(update={"revision": "sha256:" + "f" * 64})
    patch = AgentSpecPatch(
        schema_version="agent.patch/v1",
        base_revision=base.revision,
        operations=[{"op": "remove_edge", "edge_id": "input-output"}],
    )

    with pytest.raises(PatchApplyError) as caught:
        apply_patch(base, patch)

    assert caught.value.reason == "invalid_base_revision"
