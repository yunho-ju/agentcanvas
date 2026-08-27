"""노드를 뺐을 때 무엇이 닿지 않게 되는가 — studio의 impact 분석과 같은 기대값을 읽는다.

studio(TS)의 `analyzeDetach`와 여기 validator는 같은 도달성 규칙을 따라야 한다.
두 언어가 같은 예시 spec과 같은 기대값 파일(detach_reachability.json)로 판정을 맞춘다.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from agentcanvas_contracts.agent_spec import AgentSpec
from agentcanvas_engine.validator import Severity, validate_graph

EXAMPLE_DIR = Path(__file__).resolve().parents[3] / "examples/basic-agent"
EXPECTED_UNREACHABLE: dict[str, list[str]] = json.loads(
    (EXAMPLE_DIR / "detach_reachability.json").read_text(encoding="utf-8")
)


def load_example() -> AgentSpec:
    return AgentSpec.model_validate(
        json.loads((EXAMPLE_DIR / "agent_spec.json").read_text(encoding="utf-8"))
    )


def without_node(spec: AgentSpec, node_id: str) -> AgentSpec:
    return spec.model_copy(
        update={
            "nodes": [node for node in spec.nodes if node.id != node_id],
            "edges": [
                edge
                for edge in spec.edges
                if node_id not in (edge.source.node, edge.target.node)
            ],
        }
    )


def unreachable_ids(spec: AgentSpec) -> list[str]:
    return [
        issue.node_id
        for issue in validate_graph(spec)
        if issue.code == "graph.unreachable_node" and issue.node_id is not None
    ]


def test_the_example_starts_with_everything_in_reach():
    assert unreachable_ids(load_example()) == []


@pytest.mark.parametrize(("node_id", "expected"), sorted(EXPECTED_UNREACHABLE.items()))
def test_removing_a_node_puts_the_expected_nodes_out_of_reach(
    node_id: str, expected: list[str]
):
    assert unreachable_ids(without_node(load_example(), node_id)) == expected


def test_every_node_of_the_example_has_an_expectation():
    assert sorted(EXPECTED_UNREACHABLE) == sorted(
        node.id for node in load_example().nodes
    )


def test_unreachable_nodes_are_a_warning_not_an_error():
    spec = without_node(load_example(), "triage")
    assert [
        issue.severity
        for issue in validate_graph(spec)
        if issue.code == "graph.unreachable_node"
    ] == [Severity.WARNING] * 3
