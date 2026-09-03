"""표준 SKILL.md 하나를 읽고 다시 쓰는 순수 함수 — studio(TS)와 같은 판정이어야 한다.

두 언어가 같은 케이스 파일(examples/skill-markdown/cases.json)과 같은 `cases/*.md`를
읽어 같은 issue 코드·같은 skill을 내놓는다. 문구는 비교하지 않는다 — 언어가 다르다
(examples/skill-markdown/README.md).
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from agentcanvas_contracts.skill_markdown import (
    parse_skill_markdown,
    render_skill_markdown,
)

CASE_DIR = Path(__file__).resolve().parents[3] / "examples/skill-markdown"
CASES: list[dict] = json.loads((CASE_DIR / "cases.json").read_text(encoding="utf-8"))


def text_of(case: dict) -> str:
    return (CASE_DIR / "cases" / case["file"]).read_text(encoding="utf-8")


@pytest.mark.parametrize("case", CASES, ids=[case["name"] for case in CASES])
def test_the_shared_case_gets_the_expected_issue_codes(case: dict):
    parsed = parse_skill_markdown(text_of(case))
    assert [issue.code for issue in parsed.issues] == case["issues"]


@pytest.mark.parametrize("case", CASES, ids=[case["name"] for case in CASES])
def test_the_shared_case_builds_the_expected_skill(case: dict):
    parsed = parse_skill_markdown(text_of(case))
    if case["expect"] is None:
        assert parsed.skill is None
        return
    assert parsed.skill is not None
    assert {key: getattr(parsed.skill, key) for key in case["expect"]} == case["expect"]


@pytest.mark.parametrize("case", CASES, ids=[case["name"] for case in CASES])
def test_writing_a_skill_back_out_and_reading_it_returns_the_same_skill(case: dict):
    parsed = parse_skill_markdown(text_of(case))
    if parsed.skill is None:
        return
    again = parse_skill_markdown(render_skill_markdown(parsed.skill))
    assert again.skill == parsed.skill


def test_the_shared_cases_cover_both_answers():
    assert {case["expect"] is None for case in CASES} == {True, False}


def test_a_file_without_frontmatter_says_so_instead_of_throwing():
    parsed = parse_skill_markdown("Write short sentences.\n")
    assert [issue.code for issue in parsed.issues] == ["skill.frontmatter"]
    assert parsed.skill is None


@pytest.mark.parametrize(
    "frontmatter",
    [
        "name:\n  - plain-answer",
        "name plain-answer",
        "metadata:\n  nested:\n    deep: 1",
        "name: |\n  plain-answer",
    ],
)
def test_frontmatter_outside_the_subset_we_read_says_so(frontmatter: str):
    """YAML 전부를 읽지 않는다 — 못 읽는 모양은 조용히 넘기지 않고 말한다."""
    parsed = parse_skill_markdown(f"---\n{frontmatter}\n---\n\nbody\n")
    assert "skill.frontmatter" in [issue.code for issue in parsed.issues]
    assert parsed.skill is None


def test_an_empty_body_says_the_skill_must_say_something():
    parsed = parse_skill_markdown(
        "---\nname: plain-answer\ndescription: Use when it must be plain.\n---\n\n"
    )
    assert [issue.code for issue in parsed.issues] == ["skill.body"]
    assert parsed.skill is None


def test_the_documents_beside_the_skill_ride_along():
    parsed = parse_skill_markdown(
        (CASE_DIR / "cases/valid.md").read_text(encoding="utf-8"),
        references={"references/style.md": "Short lines."},
    )
    assert parsed.skill is not None
    assert [reference.path for reference in parsed.skill.references] == [
        "references/style.md"
    ]


def test_a_file_outside_the_references_folder_is_left_out_and_said_out_loud():
    """scripts/·assets/는 v1에서 실행 의미가 없다 — 조용히 담지 않고 이유를 말한다."""
    parsed = parse_skill_markdown(
        (CASE_DIR / "cases/valid.md").read_text(encoding="utf-8"),
        references={"scripts/run.sh": "echo hi"},
    )
    assert [issue.code for issue in parsed.issues] == ["skill.reference"]
    assert parsed.skill is not None
    assert parsed.skill.references == []


def test_a_message_says_what_to_do_about_the_name():
    parsed = parse_skill_markdown(
        (CASE_DIR / "cases/bad-name.md").read_text(encoding="utf-8")
    )
    assert "Plain Answer" in parsed.issues[0].message
