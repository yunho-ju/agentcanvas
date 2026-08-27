import pytest
from agentcanvas_contracts import DEFAULT_SCHEMA_CATALOG, SchemaDef, resolve_schema
from pydantic import ValidationError

ANSWER_REVIEW = "schema://answer-review@1"


def test_the_catalog_keys_every_definition_by_its_own_ref():
    assert DEFAULT_SCHEMA_CATALOG
    assert all(
        ref == definition.ref for ref, definition in DEFAULT_SCHEMA_CATALOG.items()
    )


def test_every_definition_has_a_title_in_both_languages():
    for definition in DEFAULT_SCHEMA_CATALOG.values():
        assert definition.title.ko.strip()
        assert definition.title.en.strip()


def test_the_seed_form_asks_for_an_optional_review_note():
    definition = DEFAULT_SCHEMA_CATALOG[ANSWER_REVIEW]
    comment = definition.schema_["properties"]["comment"]

    assert definition.schema_["type"] == "object"
    assert definition.schema_["required"] == []
    assert comment["type"] == "string"
    assert comment["format"] == "textarea"
    assert comment["title"] == "Review note"
    assert comment["x-i18n"]["ko"]["title"] == "검토 의견"


def test_resolve_schema_finds_a_ref_the_catalog_holds():
    assert resolve_schema(ANSWER_REVIEW) is DEFAULT_SCHEMA_CATALOG[ANSWER_REVIEW]


@pytest.mark.parametrize(
    "ref",
    [
        "",
        "schema://nothing-here@1",
        "schema://answer-review@2",
        "schema://answer-review",
        "SCHEMA://ANSWER-REVIEW@1",
        "not a ref at all",
    ],
)
def test_resolve_schema_says_nothing_rather_than_raising(ref):
    assert resolve_schema(ref) is None


def test_a_definition_ref_must_be_a_schema_reference():
    with pytest.raises(ValidationError):
        SchemaDef(
            ref="answer-review",
            title={"ko": "답 검토", "en": "Answer review"},
            schema={"type": "object"},
        )
