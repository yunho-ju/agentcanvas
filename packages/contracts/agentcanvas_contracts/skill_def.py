"""SkillDef — 노드가 입는 지시 한 벌. 표준 `SKILL.md`(agentskills.io)를 그대로 담는다.

skill은 카탈로그가 아니라 **문서 안에 산다**(`spec.skills`) — 저장·판(revision)·게시·되돌리기가
resources와 똑같이 따라온다. v1은 지시 전용이다: 곁의 `scripts/`·`assets/`는 실행하지 않으므로
여기 담지 않고, `references/` 아래의 읽을 문서만 기록한다.
"""

from __future__ import annotations

import re

from pydantic import Field, model_validator

from .base import ContractModel, UtcDatetime
from .refs import SkillRef

# 표준 이름 규칙 — 1–64자, 소문자·숫자·하이픈, 시작·끝·연속 하이픈 금지.
SKILL_NAME_PATTERN = r"^[a-z0-9]+(?:-[a-z0-9]+)*$"
SKILL_NAME_MAX_LENGTH = 64
SKILL_DESCRIPTION_MAX_LENGTH = 1024

# 곁의 문서가 사는 자리 — 이 아래의 글만 skill과 함께 기록한다.
REFERENCES_PREFIX = "references/"

_NAME_IN_REF = re.compile(r"^skill://([^@]+)")


def skill_name_issue(name: str) -> str | None:
    """표준 이름 규칙을 어긴 이유 한 줄 — 지키면 None (예외를 던지지 않는다)."""
    if not 1 <= len(name) <= SKILL_NAME_MAX_LENGTH:
        return (
            f"a skill name must be 1 to {SKILL_NAME_MAX_LENGTH} characters, "
            f"but {name!r} is {len(name)}"
        )
    if re.fullmatch(SKILL_NAME_PATTERN, name) is None:
        return (
            f"a skill name may hold only lowercase letters, digits and single "
            f"hyphens between them, but {name!r} does not"
        )
    return None


def skill_ref_for(name: str, revision: str = "1") -> str:
    """이름 하나가 가리키는 ref — 이름과 ref는 한 자리에서만 이어 붙인다."""
    return f"skill://{name}@{revision}"


def name_in_skill_ref(ref: str) -> str | None:
    """ref가 가리키는 이름 부분 — skill ref가 아니면 없다고 말한다."""
    found = _NAME_IN_REF.match(ref)
    return found.group(1) if found else None


class SkillReference(ContractModel):
    """skill 곁의 읽을 문서 하나 — 점진 공개의 셋째 단계에서 사람이 펼쳐 본다."""

    path: str = Field(min_length=1)
    text: str

    @model_validator(mode="after")
    def _lives_under_references(self):
        if not self.path.startswith(REFERENCES_PREFIX):
            raise ValueError(
                f"a skill reference must live under {REFERENCES_PREFIX!r}, "
                f"but {self.path!r} does not"
            )
        return self


class SkillSource(ContractModel):
    """이 skill이 어디서 왔는가 — 나중에 새 판이 나왔는지 확인하는 데 쓴다."""

    url: str = Field(min_length=1)
    fetched_revision: str | None = None
    fetched_at: UtcDatetime | None = None


class SkillDef(ContractModel):
    """표준 SKILL.md 하나 — 노드는 `skill_refs`에 이 `ref`를 적어 입는다."""

    ref: SkillRef
    # 규칙은 JSON Schema에도 실린다 — 파이썬만 아는 규칙은 다른 언어에서 지켜지지 않는다.
    name: str = Field(
        min_length=1, max_length=SKILL_NAME_MAX_LENGTH, pattern=SKILL_NAME_PATTERN
    )
    description: str = Field(min_length=1, max_length=SKILL_DESCRIPTION_MAX_LENGTH)
    body: str = Field(min_length=1)
    license: str | None = None
    compatibility: str | None = None
    metadata: dict[str, str] = Field(default_factory=dict)
    references: list[SkillReference] = Field(default_factory=list)
    source: SkillSource | None = None

    @model_validator(mode="after")
    def _name_matches_the_standard_and_the_ref(self):
        issue = skill_name_issue(self.name)
        if issue is not None:
            raise ValueError(issue)
        if name_in_skill_ref(self.ref) != self.name:
            raise ValueError(
                f"a skill's name must be the name its ref points at, but {self.ref!r} "
                f"does not point at {self.name!r}"
            )
        if not self.body.strip():
            raise ValueError("a skill must say something — its body must not be blank")
        return self


__all__ = [
    "REFERENCES_PREFIX",
    "SKILL_DESCRIPTION_MAX_LENGTH",
    "SKILL_NAME_MAX_LENGTH",
    "SKILL_NAME_PATTERN",
    "SkillDef",
    "SkillReference",
    "SkillSource",
    "name_in_skill_ref",
    "skill_name_issue",
    "skill_ref_for",
]
