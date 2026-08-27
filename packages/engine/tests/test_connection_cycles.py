"""연결 하나를 그었을 때 순환이 생기는가 — studio(TS)의 판정과 같은 답이어야 한다.

두 언어가 같은 케이스 파일(examples/connection-cycles/cases.json)을 읽어 같은 판정을 낸다:
여기서는 그은 연결까지 넣은 그래프를 validator에게 물어 `graph.cycle`이 나오는지 보고,
studio에서는 같은 연결을 `checkConnection`에게 물어 거절하는지 본다.

케이스의 노드는 모두 llm.router다 — input·passthrough 포트의 schema가 비어 있어
어느 쪽으로 이어도 타입은 걸리지 않는다. 오직 순환만이 판정을 가른다.

두 물음은 밑그림(`edges`)이 비순환일 때만 같은 답을 낸다 (examples/connection-cycles/README.md).
그 전제는 `test_every_case_starts_from_a_graph_that_does_not_loop`가 지킨다.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from agentcanvas_contracts.agent_spec import AgentSpec
from agentcanvas_engine.validator import Severity, validate_graph

CASES: list[dict] = json.loads(
    (
        Path(__file__).resolve().parents[3] / "examples/connection-cycles/cases.json"
    ).read_text(encoding="utf-8")
)


def router(node_id: str) -> dict:
    return {
        "id": node_id,
        "type": "llm.router",
        "position": {"x": 0, "y": 0},
        "config": {"model_ref": "model://default", "prompt_ref": "prompt://x@1"},
    }


def link(source: str, target: str) -> dict:
    return {
        "id": f"{source}-{target}",
        "kind": "data",
        "source": {"node": source, "port": "passthrough"},
        "target": {"node": target, "port": "input"},
    }


def spec_of(case: dict, links: list[list[str]]) -> AgentSpec:
    return AgentSpec.model_validate(
        {
            "schema_version": "agent.spec/v1",
            "id": "cycle-case",
            "version": 1,
            "revision": "sha256:" + "0" * 64,
            "status": "draft",
            "input_schema": {"type": "object"},
            "state_schema": {"type": "object"},
            "nodes": [router(node_id) for node_id in case["nodes"]],
            "edges": [link(source, target) for source, target in links],
        }
    )


def loops(spec: AgentSpec) -> bool:
    return any(
        issue.code == "graph.cycle" and issue.severity is Severity.ERROR
        for issue in validate_graph(spec)
    )


def makes_a_cycle(case: dict) -> bool:
    return loops(spec_of(case, case["edges"] + [case["draw"]]))


@pytest.mark.parametrize("case", CASES, ids=[case["name"] for case in CASES])
def test_drawing_the_connection_makes_the_expected_cycle_judgement(case: dict):
    assert makes_a_cycle(case) is case["cycle"]


@pytest.mark.parametrize("case", CASES, ids=[case["name"] for case in CASES])
def test_every_case_starts_from_a_graph_that_does_not_loop(case: dict):
    """밑그림이 비순환일 때만 두 언어의 물음이 같은 답을 낸다 (README의 전제)."""
    assert loops(spec_of(case, case["edges"])) is False


def test_the_shared_cases_cover_both_answers():
    assert {case["cycle"] for case in CASES} == {True, False}
