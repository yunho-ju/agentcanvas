import pytest
from agentcanvas_contracts.agent_spec import (
    Edge,
    EdgeEndpoint,
    EdgeKind,
    Node,
    Position,
)
from agentcanvas_contracts.architect_patch import AgentSpecPatch
from pydantic import ValidationError


def a_node(node_id: str = "worker") -> dict:
    return {
        "id": node_id,
        "type": "llm.agent",
        "position": {"x": 80, "y": 120},
        "config": {},
    }


def a_patch(*operations: dict, base_revision: str | None = None) -> AgentSpecPatch:
    return AgentSpecPatch(
        schema_version="agent.patch/v1",
        base_revision=base_revision or "sha256:" + "a" * 64,
        operations=list(operations),
    )


def test_the_patch_is_a_discriminated_ordered_operation_list():
    patch = a_patch(
        {"op": "add_node", "node": a_node()},
        {"op": "remove_node", "node_id": "worker"},
    )

    assert patch.operations[0].op == "add_node"
    assert patch.operations[1].op == "remove_node"
    assert patch.model_dump(mode="json")["schema_version"] == "agent.patch/v1"


def test_unknown_fields_are_not_silently_accepted():
    with pytest.raises(ValidationError):
        a_patch({"op": "remove_node", "node_id": "worker", "path": "/nodes"})


def test_only_the_revision_shape_is_accepted():
    with pytest.raises(ValidationError):
        a_patch({"op": "remove_node", "node_id": "worker"}, base_revision="old")


def test_the_operation_count_is_bounded():
    with pytest.raises(ValidationError):
        a_patch(*({"op": "remove_node", "node_id": f"node-{i}"} for i in range(33)))


def test_nested_node_and_edge_contracts_are_real_contract_models():
    patch = a_patch(
        {
            "op": "add_edge",
            "edge": {
                "id": "worker-output",
                "kind": "data",
                "source": {"node": "worker", "port": "response"},
                "target": {"node": "output", "port": "input"},
            },
        }
    )

    assert isinstance(patch.operations[0].edge, Edge)
    assert patch.operations[0].edge.kind is EdgeKind.DATA
    assert isinstance(patch.operations[0].edge.source, EdgeEndpoint)
    assert isinstance(patch.operations[0].edge, Edge)
    assert Node.model_validate(a_node()).position == Position(x=80, y=120)


def test_raw_secret_in_a_replaced_config_is_rejected():
    with pytest.raises(ValidationError, match="raw secret"):
        a_patch(
            {
                "op": "replace_node_config",
                "node_id": "worker",
                "config": {"api_key": "sk-live-never-store-this"},
            }
        )
