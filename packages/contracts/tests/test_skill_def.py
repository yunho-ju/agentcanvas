"""SkillDef — 문서 안에 사는 skill 하나의 계약 (SKILL.md 표준을 그대로 담는다)."""

import json
import re
from pathlib import Path

import jsonschema
import pytest
from agentcanvas_contracts.skill_def import (
    SkillDef,
    name_in_skill_ref,
    skill_name_issue,
)
from pydantic import ValidationError

VALID = {
    "ref": "skill://plain-answer@1",
    "name": "plain-answer",
    "description": "Use when the answer must be easy for anyone to read.",
    "body": "# Plain answer\n\nWrite short sentences.\n",
}


def test_a_skill_keeps_what_the_standard_file_said():
    skill = SkillDef.model_validate(VALID)
    assert skill.ref == "skill://plain-answer@1"
    assert skill.name == "plain-answer"
    assert skill.body.startswith("# Plain answer")
    assert skill.metadata == {}
    assert skill.references == []
    assert skill.source is None


def test_the_name_must_be_the_name_the_ref_points_at():
    """ref와 이름이 갈리면 노드가 입은 skill이 어느 것인지 알 수 없다."""
    with pytest.raises(ValidationError) as exc:
        SkillDef.model_validate({**VALID, "name": "other-name"})
    assert "skill://plain-answer@1" in str(exc.value)


@pytest.mark.parametrize(
    "name", ["-plain", "plain-", "plain--answer", "Plain", "plain answer", "plain_a"]
)
def test_a_name_outside_the_standard_rule_is_refused(name):
    with pytest.raises(ValidationError):
        SkillDef.model_validate({**VALID, "ref": f"skill://{name}@1", "name": name})


def test_a_name_longer_than_the_standard_allows_is_refused():
    long_name = "a" * 65
    with pytest.raises(ValidationError):
        SkillDef.model_validate(
            {**VALID, "ref": f"skill://{long_name}@1", "name": long_name}
        )


def test_a_description_longer_than_the_standard_allows_is_refused():
    with pytest.raises(ValidationError):
        SkillDef.model_validate({**VALID, "description": "x" * 1025})


def test_an_empty_body_is_refused():
    with pytest.raises(ValidationError):
        SkillDef.model_validate({**VALID, "body": "   "})


def test_a_skill_can_carry_the_files_beside_it_and_where_it_came_from():
    skill = SkillDef.model_validate(
        {
            **VALID,
            "license": "Apache-2.0",
            "compatibility": ">=1.0",
            "metadata": {"allowed-tools": "Read Bash"},
            "references": [{"path": "references/style.md", "text": "Short lines."}],
            "source": {
                "url": "https://example.com/skills/plain-answer",
                "fetched_revision": "abc123",
                "fetched_at": "2026-09-03T00:00:00Z",
            },
        }
    )
    assert skill.metadata["allowed-tools"] == "Read Bash"
    assert skill.references[0].path == "references/style.md"
    assert skill.source is not None
    assert skill.source.url == "https://example.com/skills/plain-answer"


def test_a_reference_outside_the_references_folder_is_refused():
    """곁의 문서만 기록한다 — scripts/·assets/는 실행 의미가 없으므로 여기 담지 않는다."""
    with pytest.raises(ValidationError):
        SkillDef.model_validate(
            {**VALID, "references": [{"path": "scripts/run.sh", "text": "echo hi"}]}
        )


SCHEMA_PATH = Path(__file__).resolve().parents[1] / "json_schema/skill_def.json"
BAD_NAMES = ["Plain-Answer", "plain--answer", "-plain", "plain-", "plain answer", ""]


def name_field_of_the_committed_schema() -> dict:
    schema = json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))
    return schema["properties"]["name"]


@pytest.mark.parametrize("name", BAD_NAMES)
def test_the_committed_schema_refuses_a_name_outside_the_standard_rule(name: str):
    """이름 규칙은 파이썬 밖에서도 지켜져야 한다 — JSON Schema가 그 규칙을 싣는다."""
    schema = json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))
    with pytest.raises(jsonschema.ValidationError):
        jsonschema.validate(
            instance={**VALID, "ref": f"skill://{name}@1", "name": name}, schema=schema
        )


def test_the_committed_schema_carries_the_length_the_standard_gives():
    field = name_field_of_the_committed_schema()
    assert field["minLength"] == 1
    assert field["maxLength"] == 64


@pytest.mark.parametrize(
    "name",
    ["plain-answer", "a", "a1-b2", "Plain-Answer", "plain--answer", "-plain", "plain-"],
)
def test_the_exported_name_pattern_accepts_exactly_what_the_model_accepts(name: str):
    """JSON Schema에 실은 pattern과 런타임 판정이 같은 집합을 뜻한다."""
    pattern = name_field_of_the_committed_schema()["pattern"]
    accepted_by_schema = re.fullmatch(pattern, name) is not None
    try:
        SkillDef.model_validate({**VALID, "ref": f"skill://{name}@1", "name": name})
    except ValidationError:
        accepted_by_model = False
    else:
        accepted_by_model = True
    assert accepted_by_schema is accepted_by_model


@pytest.mark.parametrize("name", ["plain-answer\n", "plain-answer\n\n"])
def test_a_name_with_a_newline_after_it_is_not_the_name(name: str):
    """`$`는 뒤따르는 개행을 봐준다 — 이름 규칙은 글자 전체를 본다."""
    assert skill_name_issue(name) is not None


@pytest.mark.parametrize(
    ("ref", "name"),
    [
        ("skill://plain-answer@1", "plain-answer"),
        ("skill://plain-answer", "plain-answer"),
        ("skill://", None),
        ("tool://plain-answer@1", None),
    ],
)
def test_the_name_a_ref_points_at(ref: str, name: str | None):
    """studio(TS)의 `nameInSkillRef`와 같은 케이스에 같은 답을 낸다 — 미러 정합성."""
    assert name_in_skill_ref(ref) == name
