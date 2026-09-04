"""앵커가 이 문서의 어느 노드가 되는가 — 화면과 나눠 읽는 케이스 파일.

케이스는 examples/pattern-anchors/cases.json에 있고, 같은 파일을 studio의 resolveAnchors가
읽는다(미러 규율). 여기서는 엔진의 fill_template이 그 답과 같은 노드를 건드리는지, 못 채우는
케이스는 같은 까닭을 말하는지 본다. 자리 정하기는 이 파일이 맞추지 않는다 — 서버에는 뷰포트가 없다.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from agentcanvas_contracts.agent_spec import AgentSpec
from agentcanvas_contracts.architect_patch import (
    AddEdgeOperation,
    AddNodeOperation,
    PatchOperation,
    ReplaceNodeConfigOperation,
)
from agentcanvas_contracts.patterns import DEFAULT_PATTERNS
from agentcanvas_engine.patterns.apply import TemplateCannotFill, fill_template

EXAMPLES = Path(__file__).resolve().parents[3] / "examples/pattern-anchors"

CASES: list[dict] = json.loads((EXAMPLES / "cases.json").read_text(encoding="utf-8"))


def a_connection(resource: dict) -> dict:
    return {"kind": "mcp", "server_ref": f"mcp://{resource['id']}", **resource}


def a_flow(source: str, target: str) -> dict:
    return {
        "id": f"{source}-{target}",
        "kind": "data",
        "source": {"node": source, "port": "response"},
        "target": {"node": target, "port": "input"},
    }


def spec_of(case: dict) -> AgentSpec:
    return AgentSpec.model_validate(
        {
            "schema_version": "agent.spec/v1",
            "id": "anchor-case",
            "version": 1,
            "revision": "sha256:" + "0" * 64,
            "status": "draft",
            "input_schema": {
                "type": "object",
                "properties": {"question": {"type": "string"}},
            },
            "state_schema": {"type": "object"},
            "nodes": [{**node, "position": {"x": 0, "y": 0}} for node in case["nodes"]],
            "edges": [a_flow(*pair) for pair in case.get("edges", [])],
            "resources": [
                a_connection(resource) for resource in case.get("resources", [])
            ],
        }
    )


def filled(case: dict) -> list[PatchOperation] | TemplateCannotFill:
    return fill_template(
        DEFAULT_PATTERNS[case["pattern"]].template,
        spec_of(case),
        anchor=case.get("selected"),
    )


def nodes_it_touched(ops: list[PatchOperation], spec: AgentSpec) -> set[str]:
    """작업들이 건드린 **문서의** 노드 — 새로 놓는 노드는 문서의 노드가 아니다."""
    standing = {node.id for node in spec.nodes}
    named: list[str] = []
    for op in ops:
        if isinstance(op, ReplaceNodeConfigOperation):
            named.append(op.node_id)
        elif isinstance(op, AddEdgeOperation):
            named += [op.edge.source.node, op.edge.target.node]
        elif isinstance(op, AddNodeOperation):
            continue
    return {name for name in named if name in standing}


@pytest.mark.parametrize("case", CASES, ids=[case["name"] for case in CASES])
def test_the_anchors_stand_on_the_nodes_the_case_file_names(case: dict):
    ops = filled(case)
    if "anchors" not in case:
        pytest.skip("이 케이스는 채울 수 없는 케이스다")

    assert not isinstance(ops, TemplateCannotFill), ops
    assert nodes_it_touched(ops, spec_of(case)) == set(case["anchors"].values())


@pytest.mark.parametrize("case", CASES, ids=[case["name"] for case in CASES])
def test_a_document_the_shape_cannot_stand_on_says_the_same_why(case: dict):
    if "cannot" not in case:
        pytest.skip("이 케이스는 채워지는 케이스다")
    ops = filled(case)

    assert isinstance(ops, TemplateCannotFill)
    assert ops.reason == case["cannot"]


def test_the_templates_the_screen_answers_with_are_this_catalogs_own():
    """화면이 읽는 catalog.json은 이 카탈로그의 복사본이다 — 설정값은 앵커 규칙 밖이다."""
    held = json.loads((EXAMPLES / "catalog.json").read_text(encoding="utf-8"))

    assert {
        pattern_id: [
            {key: value for key, value in op.items() if key != "config"} for op in ops
        ]
        for pattern_id, ops in held.items()
    } == {
        pattern.id: [
            op.model_dump(mode="json", exclude={"config"}) for op in pattern.template
        ]
        for pattern in DEFAULT_PATTERNS.values()
    }


def test_the_cases_cover_every_shape_in_the_catalog():
    assert {case["pattern"] for case in CASES} == set(DEFAULT_PATTERNS)


def test_the_cases_cover_every_reason_the_anchor_rule_can_give():
    """포트 해석(unknown_port)은 앵커 규칙 밖이라 이 목록에 없다 — README가 그 경계를 적는다."""
    assert {case["cannot"] for case in CASES if "cannot" in case} == {
        "ambiguous_anchor",
        "missing_node",
        "needs_tools",
        "no_tools_anywhere",
    }
