import pytest
from agentcanvas_contracts.evaluator_catalog import (
    DEFAULT_EVALUATOR_CATALOG,
    EvaluatorDef,
    resolve_evaluator,
)
from pydantic import ValidationError

EXPECTED_PHRASES = "expected_phrases"


def test_the_catalog_keys_every_evaluator_by_its_own_name():
    assert DEFAULT_EVALUATOR_CATALOG
    assert all(
        name == evaluator.name for name, evaluator in DEFAULT_EVALUATOR_CATALOG.items()
    )


def test_the_seed_offers_exactly_one_evaluator():
    assert sorted(DEFAULT_EVALUATOR_CATALOG) == [EXPECTED_PHRASES]


def test_every_evaluator_has_a_plain_description_and_an_example_in_both_languages():
    for evaluator in DEFAULT_EVALUATOR_CATALOG.values():
        assert evaluator.plain_description.ko.strip()
        assert evaluator.plain_description.en.strip()
        assert evaluator.example.ko.strip()
        assert evaluator.example.en.strip()


def test_an_evaluator_needs_a_plain_description():
    with pytest.raises(ValidationError):
        EvaluatorDef(
            name="expected_phrases",
            version="v1",
            example={"ko": "예시", "en": "example"},
        )


def test_an_evaluator_needs_an_example():
    with pytest.raises(ValidationError):
        EvaluatorDef(
            name="expected_phrases",
            version="v1",
            plain_description={"ko": "설명", "en": "description"},
        )


def test_resolve_evaluator_finds_a_name_the_catalog_holds():
    assert (
        resolve_evaluator(EXPECTED_PHRASES)
        is DEFAULT_EVALUATOR_CATALOG[EXPECTED_PHRASES]
    )


def test_resolve_evaluator_says_nothing_rather_than_raising():
    assert resolve_evaluator("nothing-here") is None
