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
from agentcanvas_engine.validator import Severity, validate_graph


def a_tool(name: str = "search_article") -> dict:
    return {
        "name": name,
        "plain_description": {"en": "look something up", "ko": "무언가를 찾는다"},
        "input_schema": {"type": "object"},
        "output_schema": {"type": "object"},
        "timeout_ms": 5000,
        "call": {"transport": "mcp", "remote_name": name},
    }


def a_binding(binding_id: str = "clinical-reference", *tools: dict) -> dict:
    return {
        "id": binding_id,
        "kind": "mcp.toolset",
        "server_ref": f"mcp://{binding_id}",
        "approval_policy": "read_only_auto",
        "tools": list(tools),
    }


def a_spec(resources: list[dict] | None = None) -> AgentSpec:
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
        resources=resources or [],
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


def test_a_binding_can_be_added_and_the_revision_moves_with_it():
    base = a_spec()
    patch = a_patch(base, {"op": "add_resource", "resource": a_binding()})

    candidate = apply_patch(base, patch)

    assert [resource.id for resource in candidate.resources] == ["clinical-reference"]
    assert candidate.revision == candidate.computed_revision()
    assert candidate.revision != base.revision
    assert base.resources == []


def test_replacing_a_binding_swaps_the_whole_binding_including_its_tools():
    base = a_spec([a_binding("clinical-reference", a_tool("search_article"))])
    replacement = a_binding("clinical-reference", a_tool("get_article"))
    replacement["approval_policy"] = "ask_first"
    patch = a_patch(base, {"op": "replace_resource", "resource": replacement})

    candidate = apply_patch(base, patch)

    assert [resource.id for resource in candidate.resources] == ["clinical-reference"]
    assert [tool.name for tool in candidate.resources[0].tools] == ["get_article"]
    assert candidate.resources[0].approval_policy == "ask_first"


def test_replacing_a_binding_leaves_it_where_it_was():
    """자리가 바뀌면 revision이 뜻 없이 흔들린다 — 교체는 제자리에서 일어난다."""
    base = a_spec([a_binding("first"), a_binding("second")])
    patch = a_patch(
        base,
        {"op": "replace_resource", "resource": a_binding("first", a_tool("lookup"))},
    )

    candidate = apply_patch(base, patch)

    assert [resource.id for resource in candidate.resources] == ["first", "second"]
    assert [tool.name for tool in candidate.resources[0].tools] == ["lookup"]


def test_a_binding_can_be_removed():
    base = a_spec([a_binding("clinical-reference"), a_binding("scratchpad")])
    patch = a_patch(base, {"op": "remove_resource", "resource_id": "scratchpad"})

    candidate = apply_patch(base, patch)

    assert [resource.id for resource in candidate.resources] == ["clinical-reference"]


@pytest.mark.parametrize(
    ("operation", "reason"),
    [
        ({"op": "add_resource", "resource": a_binding()}, "duplicate_resource"),
        (
            {"op": "replace_resource", "resource": a_binding("ghost")},
            "unknown_resource",
        ),
        ({"op": "remove_resource", "resource_id": "ghost"}, "unknown_resource"),
    ],
)
def test_binding_conflicts_are_values_not_partial_candidates(
    operation: dict, reason: str
):
    base = a_spec([a_binding()])

    with pytest.raises(PatchApplyError) as caught:
        apply_patch(base, a_patch(base, operation))

    assert caught.value.reason == reason


def test_a_duplicate_binding_is_never_silently_overwritten():
    base = a_spec([a_binding("clinical-reference", a_tool("search_article"))])
    patch = a_patch(base, {"op": "add_resource", "resource": a_binding()})

    with pytest.raises(PatchApplyError):
        apply_patch(base, patch)

    assert [tool.name for tool in base.resources[0].tools] == ["search_article"]


def test_node_and_binding_operations_are_applied_in_the_order_they_are_written():
    base = a_spec()
    patch = a_patch(
        base,
        {"op": "add_resource", "resource": a_binding()},
        {
            "op": "add_node",
            "node": {
                "id": "lookup",
                "type": "tool.mcp",
                "position": {"x": 120, "y": 0},
                "config": {
                    "resource_ref": "clinical-reference",
                    "tool_name": "search_article",
                },
            },
        },
        {
            "op": "add_edge",
            "edge": {
                "id": "input-lookup",
                "kind": "data",
                "source": {"node": "input", "port": "question"},
                "target": {"node": "lookup", "port": "input"},
            },
        },
    )

    candidate = apply_patch(base, patch)

    assert [resource.id for resource in candidate.resources] == ["clinical-reference"]
    assert [node.id for node in candidate.nodes] == ["input", "output", "lookup"]
    assert [edge.id for edge in candidate.edges] == ["input-output", "input-lookup"]


def test_a_patch_without_resource_operations_leaves_the_bindings_alone():
    """옛 patch는 그대로 옳다 — 바인딩을 말하지 않은 patch가 바인딩을 지우지 않는다."""
    base = a_spec([a_binding("clinical-reference", a_tool("search_article"))])
    patch = a_patch(base, {"op": "remove_edge", "edge_id": "input-output"})

    candidate = apply_patch(base, patch)

    assert candidate.resources == base.resources


def a_spec_whose_node_uses_a_binding() -> AgentSpec:
    """바인딩을 쓰는 노드가 있는 그래프 — patch 자신으로 세운다."""
    start = a_spec()
    return apply_patch(
        start,
        a_patch(
            start,
            {"op": "add_resource", "resource": a_binding()},
            {
                "op": "add_node",
                "node": {
                    "id": "lookup",
                    "type": "tool.mcp",
                    "position": {"x": 120, "y": 0},
                    "config": {
                        "resource_ref": "clinical-reference",
                        "tool_name": "search_article",
                    },
                },
            },
            {
                "op": "add_edge",
                "edge": {
                    "id": "input-lookup",
                    "kind": "data",
                    "source": {"node": "input", "port": "question"},
                    "target": {"node": "lookup", "port": "input"},
                },
            },
        ),
    )


def test_removing_a_binding_a_node_still_uses_applies_and_validation_says_so():
    """apply는 기계적이다 — 뜻이 맞는지는 그다음 validate_graph가 말한다."""
    base = a_spec_whose_node_uses_a_binding()
    assert [resource.id for resource in base.resources] == ["clinical-reference"]
    patch = a_patch(
        base, {"op": "remove_resource", "resource_id": "clinical-reference"}
    )

    candidate = apply_patch(base, patch)

    assert candidate.resources == []
    assert [node.id for node in candidate.nodes] == ["input", "output", "lookup"]
    unknown = [
        issue
        for issue in validate_graph(candidate)
        if issue.code == "node.unknown_binding"
    ]
    assert [issue.severity for issue in unknown] == [Severity.ERROR]
    assert unknown[0].node_id == "lookup"


def test_the_same_graph_is_valid_while_the_binding_is_still_there():
    """짝: 바인딩이 있는 동안에는 아무도 없는 이름을 가리키지 않는다."""
    spec = a_spec_whose_node_uses_a_binding()

    assert [
        issue for issue in validate_graph(spec) if issue.code == "node.unknown_binding"
    ] == []
