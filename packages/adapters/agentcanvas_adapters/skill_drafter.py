"""Skill drafter adapter — 사람이 적어 둔 지시문을 표준 SKILL.md 초안으로 옮긴다.

tool_wrapper와 같은 골격(같은 ModelAsk 자리·같은 물러섬)을 쓰고, 다른 것은 둘뿐이다:
이 서비스의 프롬프트와, 이 서비스가 돌려주는 것(patch가 아니라 글 한 장).

읽을 수 있는 초안인지 판정하는 일은 여기 있지 않다 — 그것은 계약의 파서가 하는 일이고,
이 자리는 "물어보고 들은 말을 그대로 건네는 것"까지다.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass

from agentcanvas_contracts.agent_spec import Node, Position
from agentcanvas_contracts.skill_def import SkillDef
from agentcanvas_contracts.skill_markdown import render_skill_markdown
from agentcanvas_contracts.skill_scaffold import HOW_TO_DO_IT
from agentcanvas_engine.model_call import ModelAsk, ModelBalked, ModelCall, ModelTrouble

SKILL_DRAFTER_PROMPT_REF = "prompt://skill-drafter@1"

#: 초안이 가져야 하는 절 — 틀 초안이 쓰는 그 제목에서 시작한다(두 초안이 같은 모양이다).
SECTIONS = (
    HOW_TO_DO_IT,
    "## What good looks like",
    "## What to avoid",
)

WHAT_YOU_DO = (
    "You turn what a person wrote for one step of their agent into one standard "
    "SKILL.md — a written way of working that the step can follow."
)

SHAPE_OF_A_SKILL = (
    "Write one standard SKILL.md file and nothing else. It starts with a '---' line, "
    "then 'name: <name>' and 'description: <description>' on their own lines, then "
    "another '---' line, then the body. Return no markdown fence, no prose around it, "
    "and no JSON."
)

SHAPE_OF_THE_BODY = (
    "The body starts with '# <name>', then one sentence saying what this skill is for, "
    "then these sections in this order: "
    + ", ".join(f"'{one}'" for one in SECTIONS)
    + ". "
    "Write only what the person's own instruction supports — invent no rule they did "
    "not ask for, and leave a section out rather than filling it with guesses."
)

KEEP_THE_NAME = (
    "Use exactly the name and the description given below. Do not rename them and do "
    "not rewrite the description."
)


@dataclass(frozen=True)
class SkillDraftRequest:
    """지시문 하나를 skill로 옮겨 달라는 청 — 참고 skill은 예시로만 실린다."""

    instruction: str
    name: str
    description: str
    references: tuple[SkillDef, ...]
    model_ref: str
    prompt_ref: str = SKILL_DRAFTER_PROMPT_REF


@dataclass(frozen=True)
class SkillDrafted:
    """모델이 지어 온 글 그대로 — 읽을 수 있는지는 부른 쪽이 파서에게 묻는다."""

    text: str


@dataclass(frozen=True)
class SkillDraftBalked:
    """물어보지 못했거나 쓸 만한 말을 듣지 못했다 — 예외가 아니라 값이다."""

    reason: ModelTrouble | str
    message: str


type SkillDraftCall = Callable[[SkillDraftRequest], SkillDrafted | SkillDraftBalked]


def _examples(references: tuple[SkillDef, ...]) -> list[str]:
    """참고 skill들 — 우리가 읽는 그 모양 그대로 보여 준다(형식을 말로 설명하지 않는다)."""
    if not references:
        return []
    return ["Here are skills of this kind, as examples of the shape:"] + [
        render_skill_markdown(skill) for skill in references
    ]


def _skill_drafter_prompt(asked: SkillDraftRequest) -> str:
    """모델에게 보내는 입력 — 사람이 적은 것을 표준 한 장으로 옮기게 한다."""
    return "\n".join(
        [
            WHAT_YOU_DO,
            SHAPE_OF_A_SKILL,
            KEEP_THE_NAME,
            f"name: {asked.name}",
            f"description: {asked.description}",
            SHAPE_OF_THE_BODY,
            *_examples(asked.references),
            "This is what the person wrote for that step:",
            asked.instruction.strip(),
        ]
    )


def _ask_for(asked: SkillDraftRequest) -> ModelAsk:
    return ModelAsk(
        node=Node(
            id="skill-drafter",
            type="llm.agent",
            position=Position(x=0, y=0),
            config={"model_ref": asked.model_ref},
        ),
        state={},
        ways=(),
        model_ref=asked.model_ref,
        prompt_ref=asked.prompt_ref,
        instruction=_skill_drafter_prompt(asked),
    )


def skill_drafter_from(model: ModelCall) -> SkillDraftCall:
    """기존 ModelCall을 skill 초안 자리로 감싼다 — 말이 없으면 없다고 답한다."""

    def asks(asked: SkillDraftRequest) -> SkillDrafted | SkillDraftBalked:
        said = model(_ask_for(asked))
        if isinstance(said, ModelBalked):
            return SkillDraftBalked(reason=said.reason, message=said.message)
        if not said.text:
            return SkillDraftBalked(
                reason="provider_error", message="the model said nothing"
            )
        return SkillDrafted(text=said.text)

    return asks


__all__ = [
    "SECTIONS",
    "SKILL_DRAFTER_PROMPT_REF",
    "SkillDraftBalked",
    "SkillDraftCall",
    "SkillDraftRequest",
    "SkillDrafted",
    "skill_drafter_from",
]
