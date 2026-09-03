"""부를 모델이 없을 때 지시문을 표준 SKILL.md 구조로 옮기는 틀 초안 (순수).

모르는 것을 지어내지 않는다: 사람이 적지 않은 절은 만들지 않고, 본문은 적어 둔 지시문
그대로다. studio(TS) `graph/skillScaffold`의 짝이며, 두 언어가 같은 케이스 파일
(examples/skill-scaffold/cases.json)에서 같은 글자를 낸다.
"""

from __future__ import annotations

from .skill_markdown import FRONTMATTER_FENCE, quote_scalar

#: 지시문이 들어가는 절의 제목 — 모델이 짓는 초안도 같은 이름의 절을 쓴다.
HOW_TO_DO_IT = "## How to do it"


def _written(instruction: str) -> str:
    """앞의 빈 줄과 뒤의 여백만 뗀 지시문 — 줄 안의 들여쓰기는 사람이 적은 그대로다."""
    return instruction.lstrip("\n").rstrip(" \t\r\n")


def scaffold_skill(name: str, description: str, instruction: str) -> str:
    """지시문 하나를 표준 SKILL.md 한 장의 틀로 옮긴다 — 이름과 쓰임새는 사람이 적은 그대로."""
    body = [f"# {name}", "", description]
    steps = _written(instruction)
    if steps:
        body += ["", HOW_TO_DO_IT, "", steps]
    lines = [
        FRONTMATTER_FENCE,
        f"name: {quote_scalar(name)}",
        f"description: {quote_scalar(description)}",
        FRONTMATTER_FENCE,
        "",
        *body,
        "",
    ]
    return "\n".join(lines)


__all__ = ["HOW_TO_DO_IT", "scaffold_skill"]
