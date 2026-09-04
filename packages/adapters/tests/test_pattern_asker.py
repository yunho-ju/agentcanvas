from __future__ import annotations

import json

import pytest
from agentcanvas_adapters.pattern_asker import (
    PATTERN_ASKS_PROMPT_REF,
    PatternAskRequest,
    ProposedAsk,
    pattern_asker_from,
)
from agentcanvas_contracts.patterns import DEFAULT_PATTERNS
from agentcanvas_engine.model_call import ModelAsk, ModelBalked, ModelSaid

REQUEST = "answer customer questions and look up stock"


def a_request() -> PatternAskRequest:
    return PatternAskRequest(
        request=REQUEST,
        model_ref="model://architect",
        patterns=tuple(DEFAULT_PATTERNS.values()),
    )


def a_model(text: str):
    seen: list[ModelAsk] = []

    def model(ask: ModelAsk) -> ModelSaid:
        seen.append(ask)
        return ModelSaid(input_tokens=1, output_tokens=1, text=text, prompt="prompt")

    return model, seen


def asks_for(text: str) -> tuple[ProposedAsk, ...]:
    model, _ = a_model(text)
    return pattern_asker_from(model)(a_request())


def prompt_for() -> str:
    model, seen = a_model(json.dumps({"asks": []}))
    pattern_asker_from(model)(a_request())
    return seen[0].instruction


def test_the_model_reads_the_request_and_the_shapes_it_may_ask_about():
    prompt = prompt_for()

    assert REQUEST in prompt
    for pattern in DEFAULT_PATTERNS.values():
        assert pattern.id in prompt
        assert pattern.question.en in prompt
        assert pattern.applies_when.en in prompt


def test_the_model_is_never_shown_the_template_that_places_the_shape():
    """모델은 무엇을 물을지만 고른다 — 구조를 짓는 일은 서버의 템플릿이 한다 (D11)."""
    prompt = prompt_for()

    assert "add_node" not in prompt
    assert "requires_tools" not in prompt


def test_the_ask_carries_the_version_of_the_prompt_this_adapter_sends():
    model, seen = a_model(json.dumps({"asks": []}))
    pattern_asker_from(model)(a_request())

    assert seen[0].prompt_ref == PATTERN_ASKS_PROMPT_REF


def test_what_the_model_proposed_comes_back_with_the_fragment_it_quoted():
    proposed = asks_for(
        json.dumps({"asks": [{"pattern_id": "react", "why": "look up stock"}]})
    )

    assert proposed == (ProposedAsk(pattern_id="react", why="look up stock"),)


@pytest.mark.parametrize(
    "text", ["", "not json at all", json.dumps({"asks": [{"why": "look up stock"}]})]
)
def test_an_answer_this_adapter_cannot_read_asks_nothing(text: str):
    """되묻기는 있으면 좋은 것이다 — 읽지 못한 답이 초안을 막지 않는다."""
    assert asks_for(text) == ()


def test_a_provider_that_balked_asks_nothing():
    def model(ask: ModelAsk) -> ModelBalked:
        return ModelBalked(reason="provider_error", message="down")

    assert pattern_asker_from(model)(a_request()) == ()
