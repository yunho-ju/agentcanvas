"""노드 설정에 문제가 있는가 — studio(TS)의 `validateConfig`와 같은 판정이어야 한다.

두 언어가 같은 케이스 파일(examples/node-configs/cases.json)을 읽어 같은 판정을 낸다:
여기서는 `config_issues`가 문장을 내놓는지 보고, studio에서는 `validateConfig`가
오류를 내놓는지 본다. 문구는 비교하지 않는다 — 언어가 다르다 (examples/node-configs/README.md).
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from agentcanvas_contracts.agent_spec import Node
from agentcanvas_contracts.node_registry import DEFAULT_NODE_TYPES, config_issues

CASES: list[dict] = json.loads(
    (
        Path(__file__).resolve().parents[3] / "examples/node-configs/cases.json"
    ).read_text(encoding="utf-8")
)


def node_of(case: dict) -> Node:
    return Node.model_validate(
        {
            "id": "n",
            "type": case["node_type"],
            "position": {"x": 0, "y": 0},
            "config": case["config"],
        }
    )


@pytest.mark.parametrize("case", CASES, ids=[case["name"] for case in CASES])
def test_the_shared_case_gets_the_expected_judgement(case: dict):
    issues = config_issues(node_of(case), DEFAULT_NODE_TYPES[case["node_type"]])
    assert (issues == []) is case["valid"]


def test_the_shared_cases_cover_both_answers():
    assert {case["valid"] for case in CASES} == {True, False}
