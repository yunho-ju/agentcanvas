import pytest
from agentcanvas_contracts.architect_asks import (
    PatternAnswer,
    PatternAsk,
    SkippedPattern,
)
from pydantic import ValidationError


def test_an_ask_carries_the_two_sentences_a_person_reads():
    ask = PatternAsk.model_validate(
        {
            "pattern_id": "react",
            "question": {"ko": "찾아봐야 하나요?", "en": "Does it look things up?"},
            "cost": {"ko": "실행이 길어져요", "en": "Runs take longer"},
        }
    )
    assert ask.question.ko == "찾아봐야 하나요?"
    assert ask.cost.en == "Runs take longer"


def test_an_ask_must_speak_both_languages():
    with pytest.raises(ValidationError):
        PatternAsk.model_validate(
            {
                "pattern_id": "react",
                "question": {"ko": "찾아봐야 하나요?"},
                "cost": {"ko": "실행이 길어져요", "en": "Runs take longer"},
            }
        )


@pytest.mark.parametrize("answer", ["yes", "no", "skipped"])
def test_a_person_may_say_yes_no_or_that_they_do_not_know(answer: str):
    assert (
        PatternAnswer.model_validate({"pattern_id": "react", "answer": answer}).answer
        == answer
    )


def test_an_answer_this_card_cannot_give_is_refused():
    with pytest.raises(ValidationError):
        PatternAnswer.model_validate({"pattern_id": "react", "answer": "maybe"})


def test_a_skipped_shape_says_why_in_both_languages():
    skipped = SkippedPattern.model_validate(
        {
            "pattern_id": "react",
            "why": {"ko": "쓸 도구를 먼저 골라 주세요.", "en": "Pick the tools first."},
        }
    )
    assert skipped.pattern_id == "react"
    assert skipped.why.ko == "쓸 도구를 먼저 골라 주세요."
