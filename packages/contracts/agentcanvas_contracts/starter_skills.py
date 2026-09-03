"""번들 시작 skill — 빈 문서 앞에서 바로 입어 볼 수 있는 세 벌.

카탈로그가 아니라 **시작 재료**다: 고르면 문서 안(`spec.skills`)으로 복사되어 그때부터
그 문서의 것이 된다. 도메인 중립으로 고른다 — 어느 분야에서 만들든 첫 skill이 될 만한 것.

파일은 표준 `SKILL.md` 그대로이고, 우리 파서(`skill_markdown`)로 읽는다 — 우리가 싣는
skill이 우리 규칙을 통과하지 못하면 그 규칙은 규칙이 아니다.

디스크는 **처음 쓸 때** 읽는다: 계약을 import했다는 이유로 파일을 읽지 않고, 깨진 파일은
조용히 빠지지 않고 처음 쓰는 순간 이름을 대고 부서진다.
"""

from __future__ import annotations

from functools import cache
from pathlib import Path

from .skill_def import SkillDef
from .skill_markdown import parse_skill_markdown

STARTER_SKILL_DIR = Path(__file__).resolve().parent / "skills"

STARTER_SKILL_NAMES = ("ask-before-acting", "cite-sources", "plain-answer")


def _load(name: str) -> SkillDef:
    """이름 = 디렉터리 이름 = SKILL.md의 name. 셋이 갈리면 여기서 부서진다 (기동 시점)."""
    text = (STARTER_SKILL_DIR / name / "SKILL.md").read_text(encoding="utf-8")
    parsed = parse_skill_markdown(text)
    if parsed.skill is None or parsed.issues:
        raise ValueError(
            f"the starter skill {name!r} does not read as a standard SKILL.md: "
            + "; ".join(issue.message for issue in parsed.issues)
        )
    if parsed.skill.name != name:
        raise ValueError(
            f"the starter skill in folder {name!r} calls itself "
            f"{parsed.skill.name!r} — a skill's name is its folder's name"
        )
    return parsed.skill


@cache
def starter_skills() -> dict[str, SkillDef]:
    """시작 skill 한 벌 — 처음 부를 때 한 번 읽고, 그다음부터는 같은 것을 돌려준다."""
    return {skill.ref: skill for skill in (_load(name) for name in STARTER_SKILL_NAMES)}


def resolve_starter_skill(ref: str) -> SkillDef | None:
    """ref가 가리키는 시작 skill — 정확히 같은 이름만 찾고, 못 찾으면 없다고 말한다."""
    return starter_skills().get(ref)


__all__ = [
    "STARTER_SKILL_DIR",
    "STARTER_SKILL_NAMES",
    "resolve_starter_skill",
    "starter_skills",
]
