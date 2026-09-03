"""노드가 입은 skill을 실제로 풀어 주는 자리 — 이름표 하나가 읽을 지시 한 벌이 되기까지.

문서(`spec.skills`)를 뒤지는 일은 여기서 끝난다: 묻는 쪽(adapter)은 풀린 것만 받아 읽는다
(의존은 한쪽으로만 흐른다). 예외를 던지지 않는 순수 함수다 — 문서에 없는 이름표도, 너무
긴 본문도 실행을 세우지 않고 값으로 돌아온다.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass

from agentcanvas_contracts.agent_spec import AgentSpec, Node
from agentcanvas_contracts.node_registry import DEFAULT_NODE_TYPES, skill_refs

#: 한 물음에 실을 수 있는 skill 본문의 총량 — 넘어선 skill은 설명만 싣는다.
SKILL_BODY_BUDGET_CHARS = 20_000

#: 이 걸음이 무엇을 따랐는지 사건에 적히는 자리의 이름 (studio가 이 이름으로 읽는다).
FOLLOWED_SKILLS = "skill_refs"


@dataclass(frozen=True)
class SkillBrief:
    """모델이 읽을 skill 한 벌 — 본문이 예산을 넘어섰으면 그 자리는 비어 있다.

    비어 있는 본문은 "이 skill을 안 따른다"는 뜻이 아니라 "이번 물음에는 설명만 실렸다"는
    뜻이다: 무엇을 따랐는지는 그래도 ref로 남는다.
    """

    ref: str
    name: str
    description: str
    body: str | None


@dataclass(frozen=True)
class WornSkills:
    """이 걸음이 실제로 입은 것과, 온전히 입지 못한 이름표들."""

    briefs: tuple[SkillBrief, ...] = ()
    #: 문서가 갖고 있지 않아 건너뛴 이름표 — 사람이 문서에서 고칠 일이다.
    missing: tuple[str, ...] = ()
    #: 본문이 예산에 들어가지 못해 설명만 실린 이름표 — 따르긴 하되 반쪽만 갔다.
    over_budget: tuple[str, ...] = ()


def skills_worn_by(spec: AgentSpec, node: Node) -> WornSkills:
    """이 노드가 입겠다고 적은 순서 그대로 풀어 준다 — 문서에 없는 이름표는 건너뛴다.

    같은 이름표를 두 번 적어도 한 벌이다: 처음 적은 자리만 세고, 본문도 예산도 기록도 한 번씩만
    센다. 본문은 남은 예산에 들어갈 때만 실린다: 자리가 없는 본문은 빠지고 설명만 간다
    (긴 skill 하나가 뒤의 skill을 통째로 지워 버리지 않게, 이름과 설명은 언제나 실린다).
    """
    node_type = DEFAULT_NODE_TYPES.get(node.type)
    if node_type is None:
        return WornSkills()
    held = {skill.ref: skill for skill in spec.skills}

    briefs: list[SkillBrief] = []
    missing: list[str] = []
    over_budget: list[str] = []
    spent = 0
    for ref in dict.fromkeys(skill_refs(node, node_type)):
        skill = held.get(ref)
        if skill is None:
            missing.append(ref)
            continue
        fits = spent + len(skill.body) <= SKILL_BODY_BUDGET_CHARS
        if fits:
            spent += len(skill.body)
        else:
            over_budget.append(skill.ref)
        briefs.append(
            SkillBrief(
                ref=skill.ref,
                name=skill.name,
                description=skill.description,
                body=skill.body if fits else None,
            )
        )
    return WornSkills(
        briefs=tuple(briefs),
        missing=tuple(missing),
        over_budget=tuple(over_budget),
    )


def followed_skills(refs: Sequence[str]) -> dict[str, object]:
    """따른 skill이 사건에 적히는 모습 — 진짜 실행과 가짜 실행이 같은 자리에 같은 것을 적는다.

    따른 skill이 없으면 그 자리도 없다: skill을 모르던 시절의 기록과 같은 모양이라, 옛 실행을
    다시 읽어도 달라지는 것이 없다(읽는 쪽에게 없음과 빈 목록은 같은 말이다).
    """
    return {FOLLOWED_SKILLS: list(refs)} if refs else {}


__all__ = [
    "FOLLOWED_SKILLS",
    "SKILL_BODY_BUDGET_CHARS",
    "SkillBrief",
    "WornSkills",
    "followed_skills",
    "skills_worn_by",
]
