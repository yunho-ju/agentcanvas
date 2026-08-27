"""연결에 적힌 조건을 읽는 일 — 아주 좁은 CEL 부분집합.

읽지 못하는 표현식은 조용히 참·거짓으로 삼지 않고, 읽지 못했다고 값으로 답한다.
"""

from __future__ import annotations

import pytest
from agentcanvas_engine.edge_condition import Unsupported, evaluate, named_value


class TestSayingTwoThingsAreTheSame:
    def test_it_is_true_when_the_state_holds_that_very_word(self):
        assert evaluate("route == 'clinical'", {"route": "clinical"}) is True

    def test_it_is_false_when_the_state_holds_another_word(self):
        assert evaluate("route == 'clinical'", {"route": "billing"}) is False

    def test_double_quotes_say_the_same_thing_as_single_ones(self):
        assert evaluate('route == "clinical"', {"route": "clinical"}) is True

    def test_spaces_around_the_comparison_do_not_matter(self):
        assert evaluate("  route=='clinical'  ", {"route": "clinical"}) is True

    def test_a_name_the_state_never_heard_of_is_not_that_word(self):
        assert evaluate("route == 'clinical'", {}) is False

    def test_a_value_that_is_not_a_word_is_not_that_word_either(self):
        assert evaluate("route == 'clinical'", {"route": 3}) is False


class TestSayingTwoThingsDiffer:
    def test_it_is_true_when_the_state_holds_another_word(self):
        assert evaluate("route != 'clinical'", {"route": "billing"}) is True

    def test_it_is_false_when_the_state_holds_that_very_word(self):
        assert evaluate("route != 'clinical'", {"route": "clinical"}) is False

    def test_a_name_the_state_never_heard_of_does_not_even_differ(self):
        """값이 없으면 어느 견줌도 성립하지 않는다 — 빈 자리가 조용히 갈래를 열지 않는다."""
        assert evaluate("route != 'clinical'", {}) is False


class TestAnExpressionThisReaderCannotRead:
    @pytest.mark.parametrize(
        "expression",
        [
            "route in ['a']",
            "route == other",
            "route",
            "route == 'a' && step == 'b'",
            "size(route) == 1",
            "",
        ],
    )
    def test_it_says_it_could_not_read_it_instead_of_guessing(self, expression: str):
        assert evaluate(expression, {"route": "a"}) == Unsupported(expression)

    def test_it_never_raises_no_matter_what_is_written(self):
        assert isinstance(evaluate("(((", {}), Unsupported)

    def test_what_it_could_not_read_is_carried_in_the_answer(self):
        answer = evaluate("route in ['a']", {})

        assert isinstance(answer, Unsupported)
        assert answer.expression == "route in ['a']"


class TestTheValueAConditionIsLookingFor:
    def test_it_is_the_word_the_condition_compares_that_name_to(self):
        assert named_value("route == 'clinical'", "route") == "clinical"

    def test_double_quotes_hold_the_same_word(self):
        assert named_value('route == "clinical"', "route") == "clinical"

    def test_a_condition_about_another_name_is_looking_for_nothing_here(self):
        assert named_value("step == 'clinical'", "route") is None

    def test_a_condition_that_says_they_differ_names_no_value_to_go_to(self):
        assert named_value("route != 'clinical'", "route") is None

    def test_a_condition_this_reader_cannot_read_names_nothing(self):
        assert named_value("route in ['a']", "route") is None
