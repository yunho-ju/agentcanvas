"""표준 SKILL.md 하나를 읽고 다시 쓰는 순수 함수 (agentskills.io 형식 그대로).

우리만의 형식을 발명하지 않는다: 들여올 때도 내보낼 때도 표준 파일 그대로다.
frontmatter는 YAML **부분집합**만 읽는다 — 맨 위 `키: 스칼라` 줄과 한 단계 들여쓴
`metadata:` 맵. 그 밖의 모양은 조용히 넘기지 않고 `skill.frontmatter`로 말한다
(새 YAML 의존을 들이지 않기 위한 선택이다).

예외를 던지지 않는다 — 읽은 결과는 `SkillParse{skill, issues}`다.
studio(TS) `graph/skillMarkdown.ts`가 같은 판정을 낸다
(examples/skill-markdown/cases.json).
"""

from __future__ import annotations

from pydantic import Field

from .base import ContractModel
from .skill_def import (
    REFERENCES_PREFIX,
    SKILL_DESCRIPTION_MAX_LENGTH,
    SkillDef,
    SkillReference,
    skill_name_issue,
    skill_ref_for,
)

FRONTMATTER_FENCE = "---"

# 표준이 권하는 본문 길이 — 넘어도 읽지만, 넘었다고 말은 한다.
BODY_LINE_LIMIT = 500

# frontmatter가 이름표로 아는 키들. 그 밖의 키는 metadata에 그대로 남는다
# (`allowed-tools`도 여기 담긴다 — v1에서 실행 의미는 없다).
KNOWN_KEYS = ("name", "description", "license", "compatibility")
METADATA_KEY = "metadata"

_VALUE_STARTS_A_STRUCTURE = ("|", ">", "-", "[", "{", "&", "*")

# 본문 끝에서 떼어 내는 글자 — 두 언어가 똑같이 이 넉 자만 뗀다 (`_body_of` 참고).
TRAILING_WHITESPACE = " \t\r\n"


class SkillIssue(ContractModel):
    """이 SKILL.md를 두고 사람에게 할 말 한 마디."""

    code: str
    message: str


class SkillParse(ContractModel):
    """읽은 결과 — skill이 없으면 왜 없는지가 issues에 있다."""

    skill: SkillDef | None = None
    issues: list[SkillIssue] = Field(default_factory=list)


def _issue(code: str, message: str) -> SkillIssue:
    return SkillIssue(code=code, message=message)


def _split_frontmatter(text: str) -> tuple[list[str] | None, str]:
    """맨 위 `---` 두 줄 사이와 그 아래 본문 — 울타리가 없으면 앞이 없다고 답한다."""
    lines = text.split("\n")
    if not lines or lines[0].strip() != FRONTMATTER_FENCE:
        return None, text
    for index in range(1, len(lines)):
        if lines[index].strip() == FRONTMATTER_FENCE:
            return lines[1:index], "\n".join(lines[index + 1 :])
    return None, text


def _scalar_issue(key: str, value: str) -> SkillIssue | None:
    if not value:
        return _issue(
            "skill.frontmatter",
            f"{key!r} has no value — this file's front matter must be written as "
            "'key: value' on one line",
        )
    if value.startswith(_VALUE_STARTS_A_STRUCTURE):
        return _issue(
            "skill.frontmatter",
            f"{key!r} holds a value we do not read — we read only plain one-line "
            "values and a one-level 'metadata:' map",
        )
    return None


def _read_frontmatter(
    lines: list[str],
) -> tuple[dict[str, str], dict[str, str], list[SkillIssue]]:
    """읽은 맨 위 칸 — (이름표 키들, metadata, 못 읽은 모양들)."""
    fields: dict[str, str] = {}
    metadata: dict[str, str] = {}
    issues: list[SkillIssue] = []
    in_metadata = False

    for line in lines:
        if not line.strip():
            continue
        if line.startswith((" ", "\t")):
            if not in_metadata or not line.startswith("  ") or line[2:3] in (" ", "\t"):
                issues.append(
                    _issue(
                        "skill.frontmatter",
                        f"we do not read this line: {line.strip()!r} — only a "
                        "one-level 'metadata:' map may be indented",
                    )
                )
                continue
            key, separator, value = line[2:].partition(":")
            key, value = key.strip(), value.strip()
            if not separator:
                issues.append(
                    _issue(
                        "skill.frontmatter",
                        f"we do not read this line: {line.strip()!r} — write it as "
                        "'key: value'",
                    )
                )
                continue
            problem = _scalar_issue(key, value)
            if problem is not None:
                issues.append(problem)
                continue
            metadata[key] = value
            continue

        in_metadata = False
        key, separator, value = line.partition(":")
        key, value = key.strip(), value.strip()
        if not separator:
            issues.append(
                _issue(
                    "skill.frontmatter",
                    f"we do not read this line: {line.strip()!r} — write it as "
                    "'key: value'",
                )
            )
            continue
        if key == METADATA_KEY and not value:
            in_metadata = True
            continue
        problem = _scalar_issue(key, value)
        if problem is not None:
            issues.append(problem)
            continue
        if key in KNOWN_KEYS:
            fields[key] = value
        else:
            metadata[key] = value

    return fields, metadata, issues


def _body_of(remainder: str) -> str:
    """본문 — 앞의 빈 줄과 뒤의 여백을 떼고 늘 한 줄 바꿈으로 끝낸다 (왕복이 같아지도록).

    떼어 내는 여백은 `TRAILING_WHITESPACE` 넉 자뿐이다. 언어가 주는 기본 여백 집합
    (파이썬 `str.rstrip()`, JS `trimEnd()`)은 서로 달라서 — 예를 들어 JS는 글 끝의
    U+FEFF까지 떼어 낸다 — 그대로 쓰면 두 언어가 같은 파일에서 다른 본문을 읽는다.
    """
    body = remainder.lstrip("\n").rstrip(TRAILING_WHITESPACE)
    return f"{body}\n" if body else ""


def _content_issues(fields: dict[str, str], body: str) -> list[SkillIssue]:
    """skill을 만들 수 없는 이유들 — 하나라도 있으면 문서에 skill을 만들지 않는다."""
    issues: list[SkillIssue] = []
    name = fields.get("name", "")
    if not name:
        issues.append(
            _issue("skill.name", "a skill must say its name in 'name:' at the top")
        )
    else:
        problem = skill_name_issue(name)
        if problem is not None:
            issues.append(_issue("skill.name", problem))

    description = fields.get("description", "")
    if not description:
        issues.append(
            _issue(
                "skill.description",
                "a skill must say when to use it in 'description:' at the top",
            )
        )
    elif len(description) > SKILL_DESCRIPTION_MAX_LENGTH:
        issues.append(
            _issue(
                "skill.description",
                f"a description may be at most {SKILL_DESCRIPTION_MAX_LENGTH} "
                f"characters, but this one is {len(description)}",
            )
        )

    if not body:
        issues.append(
            _issue("skill.body", "a skill must say something under its front matter")
        )
    return issues


def _reference_result(
    references: dict[str, str],
) -> tuple[list[SkillReference], list[SkillIssue]]:
    """곁의 문서 — `references/` 아래의 읽을 글만 싣는다 (scripts/·assets/는 v1에서 뜻이 없다)."""
    kept: list[SkillReference] = []
    issues: list[SkillIssue] = []
    for path in sorted(references):
        if not path.startswith(REFERENCES_PREFIX):
            issues.append(
                _issue(
                    "skill.reference",
                    f"{path!r} is left out — a skill carries only the documents "
                    f"under {REFERENCES_PREFIX!r}",
                )
            )
            continue
        kept.append(SkillReference(path=path, text=references[path]))
    return kept, issues


def parse_skill_markdown(
    text: str, *, references: dict[str, str] | None = None
) -> SkillParse:
    """표준 SKILL.md 한 장을 읽는다 — 못 읽으면 예외 대신 이유를 돌려준다."""
    lines, remainder = _split_frontmatter(text)
    if lines is None:
        return SkillParse(
            issues=[
                _issue(
                    "skill.frontmatter",
                    "a SKILL.md starts with a '---' line, its name and description, "
                    "and another '---' line",
                )
            ]
        )

    fields, metadata, issues = _read_frontmatter(lines)
    body = _body_of(remainder)
    issues.extend(_content_issues(fields, body))
    if issues:
        return SkillParse(issues=issues)

    kept, reference_issues = _reference_result(references or {})
    issues.extend(reference_issues)
    if len(body.rstrip("\n").split("\n")) > BODY_LINE_LIMIT:
        issues.append(
            _issue(
                "skill.long",
                f"this skill is longer than the {BODY_LINE_LIMIT} lines the standard "
                "suggests — it still works, but a shorter one is easier to follow",
            )
        )

    return SkillParse(
        skill=SkillDef(
            ref=skill_ref_for(fields["name"]),
            name=fields["name"],
            description=fields["description"],
            body=body,
            license=fields.get("license"),
            compatibility=fields.get("compatibility"),
            metadata=metadata,
            references=kept,
        ),
        issues=issues,
    )


def render_skill_markdown(skill: SkillDef) -> str:
    """skill 하나를 표준 SKILL.md로 다시 쓴다 — 읽어 들이면 같은 skill이 된다."""
    front = [f"name: {skill.name}", f"description: {skill.description}"]
    if skill.license is not None:
        front.append(f"license: {skill.license}")
    if skill.compatibility is not None:
        front.append(f"compatibility: {skill.compatibility}")
    if skill.metadata:
        front.append(f"{METADATA_KEY}:")
        front.extend(
            f"  {key}: {skill.metadata[key]}" for key in sorted(skill.metadata)
        )
    fence = FRONTMATTER_FENCE
    return f"{fence}\n" + "\n".join(front) + f"\n{fence}\n\n{skill.body}"


__all__ = [
    "BODY_LINE_LIMIT",
    "SkillIssue",
    "SkillParse",
    "parse_skill_markdown",
    "render_skill_markdown",
]
