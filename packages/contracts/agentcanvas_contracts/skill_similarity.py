"""이 지시문과 비슷한 skill을 고르는 순수한 셈 — 참고할 만한 글을 앞에 놓는다.

studio(TS) `graph/similarSkills`의 짝이다: 화면이 사람에게 보여 주는 참고와 서버가
초안 프롬프트에 싣는 예시가 갈리면, 사람이 본 것과 모델이 읽은 것이 달라진다
(examples/skill-similarity/cases.json이 두 언어를 맞춰 본다).

셈은 낱말 겹침 하나뿐이다: 뜻을 아는 척하지 않고, 같은 입력에 언제나 같은 답을 낸다.
"""

from __future__ import annotations

import re
from collections.abc import Sequence

from .base import ContractModel
from .skill_def import SkillDef

#: 몇 개까지 참고로 보여 주는가 — DESIGN §7 skill-make-card의 '2~3개'.
SIMILAR_SKILL_LIMIT = 3

#: 어느 글에나 있어 아무것도 가려내지 못하는 낱말들 — 최소한만 둔다.
#: 늘리는 것은 두 언어에 함께 늘린다 (한쪽만 늘리면 같은 픽스처에서 다른 줄을 고른다).
EVERYDAY_WORDS = frozenset(
    {
        "a", "an", "and", "are", "as", "at", "be", "but", "by", "can", "do", "for",
        "from", "has", "have", "how", "if", "in", "into", "is", "it", "its", "must",
        "not", "of", "on", "or", "so", "that", "the", "then", "they", "this", "to",
        "up", "use", "used", "uses", "using", "was", "we", "what", "when", "which",
        "who", "will", "with", "you", "your",
    }
)  # fmt: skip

_WORD = re.compile(r"[a-z0-9]+")


class SkillQuery(ContractModel):
    """지금 만들고 있는 skill — 아직 문서의 것이 아니라 SkillDef가 아니다."""

    name: str = ""
    description: str
    body: str


def _words_in(text: str) -> set[str]:
    """글 하나가 쓴 낱말들 — 대소문자·구두점은 셈에 들지 않는다."""
    return {word for word in _WORD.findall(text.lower()) if word not in EVERYDAY_WORDS}


def _overlap(one: set[str], other: set[str]) -> float:
    """두 글이 얼마나 같은 낱말을 쓰는가 — 겹친 수를 둘이 쓴 낱말 수로 나눈 값."""
    shared = len(one & other)
    if shared == 0:
        return 0.0
    return shared / (len(one) + len(other) - shared)


def _text_of(name: str, description: str, body: str) -> str:
    return f"{name} {description} {body}"


def similar_skills(
    query: SkillQuery,
    candidates: Sequence[SkillDef],
    how_many: int = SIMILAR_SKILL_LIMIT,
) -> list[SkillDef]:
    """이 지시문과 가장 비슷한 skill들 — 겹치는 낱말이 없는 것은 참고가 아니다.

    점수가 같으면 이름 차례다: 두 언어가 같은 줄을 고르도록 흔들리는 자리를 남기지 않는다.
    """
    asked = _words_in(_text_of(query.name, query.description, query.body))
    scored = [
        (
            _overlap(
                asked, _words_in(_text_of(skill.name, skill.description, skill.body))
            ),
            skill,
        )
        for skill in candidates
    ]
    picked = sorted(
        (one for one in scored if one[0] > 0),
        key=lambda one: (-one[0], one[1].name),
    )
    return [skill for _score, skill in picked[:how_many]]


__all__ = [
    "EVERYDAY_WORDS",
    "SIMILAR_SKILL_LIMIT",
    "SkillQuery",
    "similar_skills",
]
