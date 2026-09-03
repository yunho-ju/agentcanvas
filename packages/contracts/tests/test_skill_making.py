"""지시문 하나가 skill이 되기까지의 순수한 셈 — studio(TS)와 같은 답이어야 한다.

두 언어가 같은 케이스 파일(examples/skill-similarity, examples/skill-scaffold)을 읽는다.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from agentcanvas_contracts.skill_def import SkillDef, skill_ref_for
from agentcanvas_contracts.skill_markdown import parse_skill_markdown
from agentcanvas_contracts.skill_scaffold import scaffold_skill
from agentcanvas_contracts.skill_similarity import SkillQuery, similar_skills

EXAMPLES = Path(__file__).resolve().parents[3] / "examples"
SIMILAR_CASES = json.loads(
    (EXAMPLES / "skill-similarity/cases.json").read_text(encoding="utf-8")
)
SCAFFOLD_CASES = json.loads(
    (EXAMPLES / "skill-scaffold/cases.json").read_text(encoding="utf-8")
)


def a_skill(one: dict[str, str]) -> SkillDef:
    """케이스가 적어 둔 세 칸으로 문서 안 skill 하나를 짓는다."""
    return SkillDef(
        ref=skill_ref_for(one["name"]),
        name=one["name"],
        description=one["description"],
        body=one["body"],
    )


@pytest.mark.parametrize("case", SIMILAR_CASES, ids=lambda case: case["name"])
def test_both_languages_pick_the_same_references(case: dict) -> None:
    chosen = similar_skills(
        SkillQuery(**case["query"]),
        [a_skill(one) for one in case["candidates"]],
        case["howMany"],
    )

    assert [skill.name for skill in chosen] == case["expect"]


def test_nothing_to_pick_from_gives_an_empty_list() -> None:
    assert similar_skills(SkillQuery(description="anything", body="anything"), []) == []


def test_three_are_picked_when_nobody_says_how_many() -> None:
    many = [
        a_skill(
            {
                "name": f"answer-{at}",
                "description": "Use when you answer a person.",
                "body": f"Write {'very ' * at}short sentences.\n",
            }
        )
        for at in (1, 2, 3, 4)
    ]

    picked = similar_skills(SkillQuery(description="answer a person", body=""), many)

    assert len(picked) == 3


@pytest.mark.parametrize("case", SCAFFOLD_CASES, ids=lambda case: case["name"])
def test_both_languages_scaffold_the_same_text(case: dict) -> None:
    written = scaffold_skill(
        case["skillName"], case["description"], case["instruction"]
    )

    assert written == "\n".join(case["expect"]) + "\n"


@pytest.mark.parametrize("case", SCAFFOLD_CASES, ids=lambda case: case["name"])
def test_our_own_scaffold_reads_as_a_standard_skill(case: dict) -> None:
    parsed = parse_skill_markdown(
        scaffold_skill(case["skillName"], case["description"], case["instruction"])
    )

    assert parsed.issues == []
    assert parsed.skill is not None
    assert parsed.skill.name == case["skillName"]
    assert parsed.skill.description == case["description"]
