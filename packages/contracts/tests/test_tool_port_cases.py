"""도구 노드의 포트 — studio(TS)의 `resolvePorts`와 같은 포트를 내놓아야 한다.

두 언어가 같은 케이스 파일(examples/tool-ports/cases.json)을 읽어 같은 답을 낸다:
여기서는 `resolve_ports`가, studio에서는 `resolvePorts`가 무엇을 내놓는지 본다
(examples/tool-ports/README.md).
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from agentcanvas_contracts.agent_spec import Node, ResourceBinding
from agentcanvas_contracts.node_registry import DEFAULT_NODE_TYPES, resolve_ports

CASES: list[dict] = json.loads(
    (Path(__file__).resolve().parents[3] / "examples/tool-ports/cases.json").read_text(
        encoding="utf-8"
    )
)


def node_of(case: dict) -> Node:
    return Node.model_validate(
        {
            "id": "tool",
            "type": case["node_type"],
            "position": {"x": 0, "y": 0},
            "config": case["config"],
        }
    )


def resources_of(case: dict) -> list[ResourceBinding]:
    return [ResourceBinding.model_validate(one) for one in case["resources"]]


@pytest.mark.parametrize("case", CASES, ids=[case["name"] for case in CASES])
def test_the_shared_case_resolves_to_the_expected_ports(case: dict):
    resolved = resolve_ports(
        node_of(case),
        DEFAULT_NODE_TYPES[case["node_type"]],
        None,
        resources_of(case),
    )
    schemas = {
        side: {name: port.schema_ for name, port in getattr(resolved, side).items()}
        for side in ("inputs", "outputs")
    }
    assert schemas == case["expected"]


def test_the_shared_cases_cover_both_the_tool_schema_and_the_fallback():
    static_ports = {
        "inputs": {"input": {"type": "object"}},
        "outputs": {"result": {}, "error": {"type": "object"}},
    }
    answers = [case["expected"] == static_ports for case in CASES]
    assert set(answers) == {True, False}
