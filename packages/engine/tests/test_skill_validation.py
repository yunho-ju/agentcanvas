"""입은 skill이 문서와 맞는가 — studio(TS)의 `skillIssues`와 같은 판정이어야 한다.

두 언어가 같은 케이스 파일(examples/skill-wearing/cases.json)을 읽어 같은 코드를 낸다.
문구는 비교하지 않는다 — 언어가 다르다 (examples/skill-wearing/README.md).
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from agentcanvas_contracts.agent_spec import AgentSpec
from agentcanvas_engine.validator import Severity, validate_graph

CASES: list[dict] = json.loads(
    (
        Path(__file__).resolve().parents[3] / "examples/skill-wearing/cases.json"
    ).read_text(encoding="utf-8")
)


def skill(name: str) -> dict:
    return {
        "ref": f"skill://{name}@1",
        "name": name,
        "description": f"Use when {name} is what the answer needs.",
        "body": "Do the thing this skill is named after.\n",
    }


def spec_wearing(skills: list[str], wears: list[str]) -> AgentSpec:
    return AgentSpec.model_validate(
        {
            "schema_version": "agent.spec/v1",
            "id": "test-agent",
            "version": 1,
            "revision": "sha256:" + "0" * 64,
            "status": "draft",
            "input_schema": {"type": "object"},
            "state_schema": {"type": "object"},
            "nodes": [
                {
                    "id": "agent",
                    "type": "llm.agent",
                    "position": {"x": 0, "y": 0},
                    "config": {"model_ref": "model://default", "skill_refs": wears},
                }
            ],
            "edges": [],
            "skills": [skill(name) for name in skills],
        }
    )


def skill_codes(spec: AgentSpec) -> list[str]:
    return sorted(
        issue.code for issue in validate_graph(spec) if issue.code.startswith("skill.")
    )


@pytest.mark.parametrize("case", CASES, ids=[case["name"] for case in CASES])
def test_the_shared_case_gets_the_expected_codes(case: dict):
    spec = spec_wearing(case["skills"], case["wears"])
    assert skill_codes(spec) == sorted(case["codes"])


def test_the_shared_cases_cover_every_skill_judgement():
    covered = {code for case in CASES for code in case["codes"]}
    assert covered == {"skill.missing", "skill.duplicate", "skill.unused"}


def test_wearing_a_skill_the_document_does_not_have_stops_the_run():
    issues = [
        issue
        for issue in validate_graph(spec_wearing([], ["skill://plain-answer@1"]))
        if issue.code == "skill.missing"
    ]
    assert [issue.severity for issue in issues] == [Severity.ERROR]
    assert issues[0].node_id == "agent"
    assert "skill://plain-answer@1" in issues[0].message


def test_the_same_skill_twice_stops_the_run():
    issues = [
        issue
        for issue in validate_graph(
            spec_wearing(["plain-answer", "plain-answer"], ["skill://plain-answer@1"])
        )
        if issue.code == "skill.duplicate"
    ]
    assert [issue.severity for issue in issues] == [Severity.ERROR]
    assert "skill://plain-answer@1" in issues[0].message


def test_a_skill_nobody_wears_is_only_worth_mentioning():
    """아무도 안 입은 skill은 잘못이 아니다 — 알려만 주고 실행을 막지 않는다."""
    issues = [
        issue
        for issue in validate_graph(spec_wearing(["plain-answer"], []))
        if issue.code == "skill.unused"
    ]
    assert [issue.severity for issue in issues] == [Severity.INFO]
    assert "skill://plain-answer@1" in issues[0].message
