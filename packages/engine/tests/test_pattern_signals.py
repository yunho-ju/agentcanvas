"""문서 하나를 보고 "이 모양이 빠져 있다"를 말하는 순수 규칙들.

케이스는 examples/pattern-signals/cases.json에 있고, 여기서는 그 파일이 말하는 신호가
그대로 나오는지 본다. 규칙은 카탈로그의 `detects` 이름으로 찾아 돌린다 — 항목을 하나
더해도 이 파일은 바뀌지 않는다(표에 규칙 하나를 더할 뿐이다).
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from agentcanvas_contracts.agent_spec import AgentSpec
from agentcanvas_contracts.node_registry import DEFAULT_NODE_TYPES
from agentcanvas_contracts.patterns import DEFAULT_PATTERNS, PatternDef
from agentcanvas_engine.node_work import DEFAULT_MAX_TURNS
from agentcanvas_engine.patterns import detect as detecting
from agentcanvas_engine.patterns.detect import DETECTORS, detect_all

CASES: list[dict] = json.loads(
    (
        Path(__file__).resolve().parents[3] / "examples/pattern-signals/cases.json"
    ).read_text(encoding="utf-8")
)


def a_connection(resource: dict) -> dict:
    return {
        "kind": "mcp",
        "server_ref": f"mcp://{resource['id']}",
        **resource,
    }


def a_flow(source: str, target: str) -> dict:
    """포트 이름은 이 판정에 쓰이지 않는다 — 값이 어디서 어디로 가는지만 본다."""
    return {
        "id": f"{source}-{target}",
        "kind": "data",
        "source": {"node": source, "port": "response"},
        "target": {"node": target, "port": "review"},
    }


def spec_of(case: dict) -> AgentSpec:
    return AgentSpec.model_validate(
        {
            "schema_version": "agent.spec/v1",
            "id": "signal-case",
            "version": 1,
            "revision": "sha256:" + "0" * 64,
            "status": "draft",
            "input_schema": {"type": "object"},
            "state_schema": {"type": "object"},
            "nodes": [{**node, "position": {"x": 0, "y": 0}} for node in case["nodes"]],
            "edges": [a_flow(*pair) for pair in case.get("edges", [])],
            "resources": [
                a_connection(resource) for resource in case.get("resources", [])
            ],
        }
    )


def said_by(case: dict) -> list[dict]:
    return [
        {
            "pattern_id": signal.pattern_id,
            "node_ids": list(signal.node_ids),
            "strength": signal.strength,
        }
        for signal in detect_all(spec_of(case))
    ]


@pytest.mark.parametrize("case", CASES, ids=[case["name"] for case in CASES])
def test_the_document_gives_the_signals_the_case_file_says(case: dict):
    assert said_by(case) == case["signals"]


@pytest.mark.parametrize("case", CASES, ids=[case["name"] for case in CASES])
def test_every_signal_says_why_in_both_languages(case: dict):
    for signal in detect_all(spec_of(case)):
        assert signal.why.ko.strip() and signal.why.en.strip()


def test_every_pattern_in_the_catalog_has_the_rule_it_names():
    assert {pattern.detects for pattern in DEFAULT_PATTERNS.values()} == set(DETECTORS)


def test_a_pattern_naming_a_rule_nobody_wrote_is_passed_over_in_silence(monkeypatch):
    """카탈로그가 앞서 나가도 실행이 멈추지 않는다 — 규칙이 없는 항목은 말하지 않는다."""
    made_up = PatternDef.model_validate(
        {
            **DEFAULT_PATTERNS["router"].model_dump(),
            "id": "made-up",
            "detects": "nobody_wrote_this_rule",
        }
    )
    monkeypatch.setattr(detecting, "DEFAULT_PATTERNS", {"made-up": made_up})

    assert detect_all(spec_of(CASES[1])) == []


def test_the_turn_count_a_rule_assumes_is_the_one_the_engine_runs():
    assert DEFAULT_MAX_TURNS == (
        DEFAULT_NODE_TYPES["llm.agent"]
        .config_schema["properties"]["max_turns"]
        .get("default")
    )


def test_the_cases_cover_a_document_that_needs_nothing():
    assert any(case["signals"] == [] for case in CASES)


def test_the_cases_cover_both_a_sure_reading_and_a_hunch():
    strengths = {signal["strength"] for case in CASES for signal in case["signals"]}

    assert strengths == {"strong", "weak"}
