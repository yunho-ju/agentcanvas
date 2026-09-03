"""Skill 초안 서비스 — 모델이 지어 온 글을 우리 규칙으로 읽고, 못 읽으면 틀 초안으로 떨어진다.

정직한 폴백이다: 부를 모델이 없거나 저쪽이 답하지 못하거나 지어 온 글을 읽지 못하면
**실패라고 말하는 대신** 지시문을 표준 구조에 옮긴 틀 초안을 돌려주고, 무엇으로 지었는지
(`drafted_by`)와 무슨 일이 있었는지(`issues`)를 사실대로 함께 말한다.

이름과 쓰임새는 사람이 적은 것이 이긴다 — 모델이 바꿔 적었어도 덮어쓴다.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal

from agentcanvas_adapters.skill_drafter import (
    SkillDrafted,
    SkillDraftRequest,
    skill_drafter_from,
)
from agentcanvas_contracts.skill_def import SkillDef, skill_ref_for
from agentcanvas_contracts.skill_markdown import (
    parse_skill_markdown,
    render_skill_markdown,
)
from agentcanvas_contracts.skill_scaffold import scaffold_skill
from agentcanvas_contracts.skill_similarity import SkillQuery, similar_skills
from agentcanvas_engine.model_call import ModelCall

#: 무엇이 이 초안을 지었는가 — 화면은 이 말로 캡션을 고른다.
DraftedBy = Literal["model", "scaffold"]

#: 물어볼 곳이 없어 틀만 잡았다 — 실패가 아니라 사정이다.
NOBODY_TO_ASK = "skill.draft.nobodyToAsk"

#: 물어봤지만 저쪽이 답하지 못했다.
PROVIDER_TROUBLE = "skill.draft.providerTrouble"


@dataclass(frozen=True)
class SkillDraft:
    """돌려주는 초안 한 장 — 글과, 무엇이 지었는지와, 그 사이에 있었던 일."""

    text: str
    drafted_by: DraftedBy
    issues: list[str] = field(default_factory=list)


class SkillDraftService:
    """지시문 하나를 표준 SKILL.md 초안으로 옮긴다 — 저장은 하지 않는 preview다."""

    def __init__(self, model: ModelCall, *, someone_to_ask: bool) -> None:
        self._draft = skill_drafter_from(model)
        self._someone_to_ask = someone_to_ask

    def draft(
        self,
        *,
        instruction: str,
        name: str,
        description: str,
        references: list[SkillDef],
        model_ref: str,
    ) -> SkillDraft:
        scaffold = _readable_scaffold(name, description, instruction)
        if not self._someone_to_ask:
            return SkillDraft(scaffold, "scaffold", [NOBODY_TO_ASK])

        said = self._draft(
            SkillDraftRequest(
                instruction=instruction,
                name=name,
                description=description,
                # 참고를 고르는 규칙은 화면의 것과 같은 한 곳이다 (skill_similarity).
                references=tuple(
                    similar_skills(
                        SkillQuery(
                            name=name, description=description, body=instruction
                        ),
                        references,
                    )
                ),
                model_ref=model_ref,
            )
        )
        if not isinstance(said, SkillDrafted):
            return SkillDraft(scaffold, "scaffold", [PROVIDER_TROUBLE])

        parsed = parse_skill_markdown(said.text)
        if parsed.skill is None:
            return SkillDraft(
                scaffold, "scaffold", [issue.code for issue in parsed.issues]
            )

        ours = render_skill_markdown(
            _as_the_person_wrote(parsed.skill, name, description)
        )
        # 우리가 내보내는 것은 우리가 다시 읽을 수 있어야 한다 — 사람이 적은 이름·쓰임새를
        # 덮어쓴 뒤의 글도 마찬가지다. 읽히지 않으면 초안이라 부르지 않고 틀로 떨어진다.
        again = parse_skill_markdown(ours)
        if again.skill is None:
            return SkillDraft(
                scaffold, "scaffold", [issue.code for issue in again.issues]
            )
        return SkillDraft(ours, "model", [issue.code for issue in parsed.issues])


def _readable_scaffold(name: str, description: str, instruction: str) -> str:
    """틀 초안 — 이것마저 읽히지 않으면 우리 잘못이라, 조용히 내보내지 않고 부서진다."""
    text = scaffold_skill(name, description, instruction)
    if parse_skill_markdown(text).skill is None:
        raise ValueError(
            "the scaffold we wrote does not read as a standard SKILL.md — "
            "the writing rule and the reading rule have drifted apart"
        )
    return text


def _as_the_person_wrote(drafted: SkillDef, name: str, description: str) -> SkillDef:
    """이름과 쓰임새는 사람이 적은 것이다 — 모델이 바꿔 적었어도 그대로 덮어쓴다."""
    return drafted.model_copy(
        update={"ref": skill_ref_for(name), "name": name, "description": description}
    )


__all__ = [
    "NOBODY_TO_ASK",
    "PROVIDER_TROUBLE",
    "DraftedBy",
    "SkillDraft",
    "SkillDraftService",
]
