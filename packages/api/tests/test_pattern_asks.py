from __future__ import annotations

import pytest
from agentcanvas_adapters.pattern_asker import ProposedAsk
from agentcanvas_api.pattern_asks import MOST_ASKS, asks_worth_making
from agentcanvas_contracts.patterns import DEFAULT_PATTERNS

REQUEST = "Take customer questions, look up stock, and get approval before it sends"

ON_OFFER = list(DEFAULT_PATTERNS.values())


def proposed(*pairs: tuple[str, str]) -> list[ProposedAsk]:
    return [ProposedAsk(pattern_id=one, why=why) for one, why in pairs]


def trimmed(*pairs: tuple[str, str], request: str = REQUEST) -> list[str]:
    return [
        ask.pattern_id
        for ask in asks_worth_making(
            proposed(*pairs), on_offer=ON_OFFER, request=request
        )
    ]


def test_the_three_the_model_picked_come_through_in_the_order_it_picked_them():
    assert trimmed(
        ("human_gate", "approval before it sends"),
        ("react", "look up stock"),
        ("router", "customer questions"),
    ) == ["human_gate", "react", "router"]


def test_a_shape_this_server_cannot_do_is_dropped():
    assert trimmed(("supervisor", "look up stock"), ("react", "look up stock")) == [
        "react"
    ]


def test_the_same_shape_asked_twice_is_asked_once():
    assert trimmed(("react", "look up stock"), ("react", "customer questions")) == [
        "react"
    ]


def test_a_reason_that_is_not_in_the_request_is_dropped():
    """부탁에 없는 말을 근거로 들면 그것은 모델이 지어낸 이유다."""
    assert trimmed(("react", "translate it into French")) == []


def test_a_reason_is_found_across_different_case_and_spacing():
    assert trimmed(("react", "  Look  Up Stock ")) == ["react"]


def test_a_reason_wrapped_in_quotation_marks_is_still_a_quote():
    """실측: 모델은 인용한 조각에 따옴표를 둘러 보낸다 — 따옴표는 부탁의 글자가 아니다."""
    assert trimmed(("react", '"look up stock"')) == ["react"]
    assert trimmed(("human_gate", "“approval before it sends”")) == ["human_gate"]


@pytest.mark.parametrize("why", ["a", "s", "sand", "  ", "  '  '  "])
def test_a_fragment_too_small_or_cut_out_of_a_word_is_not_a_quote(why: str):
    """한두 글자와 낱말 속 조각은 어느 부탁에나 들어 있다 — 그것은 근거가 아니다."""
    assert trimmed(("react", why), request="A thousand customers ask questions") == []


def test_a_quote_that_ends_inside_a_word_still_counts_when_it_starts_at_one():
    """말끝이 붙는 말(조사·어미)까지 정확히 인용하기를 요구하지 않는다."""
    assert trimmed(
        ("react", "재고를 조회"), request="고객 문의를 읽고 재고를 조회해서 답한다"
    ) == ["react"]


def test_a_reason_that_quotes_nothing_is_dropped():
    assert trimmed(("react", "   ")) == []


def test_only_the_first_three_are_asked():
    """되묻기는 설문지가 되지 않는다 — 상한은 계약이 정한 세 개다."""
    many = proposed(
        ("react", "look up stock"),
        ("human_gate", "approval before it sends"),
        ("router", "customer questions"),
        ("react", "look up stock"),
    ) + proposed(("human_gate", "get approval"))
    asked = asks_worth_making(many, on_offer=ON_OFFER, request=REQUEST)

    assert len(asked) <= MOST_ASKS
    assert [ask.pattern_id for ask in asked] == ["react", "human_gate", "router"]


def test_nothing_left_after_trimming_means_no_asking_at_all():
    assert trimmed(("supervisor", "look up stock"), ("react", "made up reason")) == []


def test_an_ask_carries_the_catalog_sentences_the_card_shows():
    """화면이 문장을 짓지 않는다 — 물음과 대가는 카탈로그의 것 그대로다."""
    [ask] = asks_worth_making(
        proposed(("react", "look up stock")), on_offer=ON_OFFER, request=REQUEST
    )

    assert ask.question == DEFAULT_PATTERNS["react"].question
    assert ask.cost == DEFAULT_PATTERNS["react"].cost
