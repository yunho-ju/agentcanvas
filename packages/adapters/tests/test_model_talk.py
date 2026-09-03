"""모델이 실제로 읽는 지시문 — 무엇이 실리고, 무엇이 실리지 않는가.

입은 skill은 지시문 뒤에 한 절로 실린다. 아무것도 입지 않은 걸음의 글은 예나 지금이나
한 글자도 다르지 않다 (skill이 없는 문서의 실행이 달라지지 않는다는 뜻이다).
"""

from __future__ import annotations

from dataclasses import replace

from agentcanvas_adapters.model_talk import instruction
from agentcanvas_contracts.agent_spec import Node, Position
from agentcanvas_engine.model_call import ModelAsk
from agentcanvas_engine.skill_wear import SkillBrief


def a_brief(name: str, body: str | None) -> SkillBrief:
    return SkillBrief(
        ref=f"skill://{name}@1",
        name=name,
        description=f"Use when {name} is what the answer needs.",
        body=body,
    )


def an_ask(skills: tuple[SkillBrief, ...] = ()) -> ModelAsk:
    return ModelAsk(
        node=Node(
            id="writer", type="llm.agent", position=Position(x=0, y=0), config={}
        ),
        state={},
        ways=(),
        model_ref="model://default",
        prompt_ref="prompt://writer@1",
        instruction="Answer the question.",
        skills=skills,
    )


def test_a_step_wearing_nothing_reads_exactly_what_it_always_read():
    assert instruction(an_ask()) == (
        "step: writer (llm.agent)\n"
        "instruction: Answer the question.\n"
        "what has flowed in so far:\n"
        "nothing has flowed into this step yet."
    )


def test_the_skill_a_step_wears_is_read_right_after_the_instruction_body_and_all():
    """지시 바로 다음에 '어떻게 일하는가'가 온다 — 흘러 들어온 것보다 앞이다."""
    written = instruction(
        an_ask((a_brief("plain-answer", "Say it in short words.\n"),))
    )

    assert written == (
        "step: writer (llm.agent)\n"
        "instruction: Answer the question.\n"
        "skills you follow:\n"
        "## plain-answer — Use when plain-answer is what the answer needs.\n"
        "Say it in short words.\n"
        "\n"
        "what has flowed in so far:\n"
        "nothing has flowed into this step yet."
    )


def test_two_skills_are_read_in_the_order_the_step_wears_them():
    written = instruction(
        an_ask((a_brief("second", "Second body.\n"), a_brief("first", "First body.\n")))
    )

    assert written.index("## second") < written.index("## first")


def test_a_skill_whose_body_did_not_fit_still_says_what_it_is_for():
    written = instruction(an_ask((a_brief("plain-answer", None),)))

    assert written == (
        "step: writer (llm.agent)\n"
        "instruction: Answer the question.\n"
        "skills you follow:\n"
        "## plain-answer — Use when plain-answer is what the answer needs.\n"
        "what has flowed in so far:\n"
        "nothing has flowed into this step yet."
    )


def test_a_fork_reads_its_skills_before_the_ways_it_can_choose_from():
    forking = replace(an_ask((a_brief("plain-answer", None),)), ways=("left", "right"))

    written = instruction(forking)

    assert written.index("skills you follow:") < written.index("ways you can choose")
