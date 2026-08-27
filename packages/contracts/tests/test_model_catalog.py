import pytest
from agentcanvas_contracts import DEFAULT_MODEL_CATALOG, ModelDef, resolve_model
from agentcanvas_contracts.refs import SECRET_FIELD_PATTERN
from pydantic import ValidationError

DEFAULT_MODEL = "model://default"


def test_the_catalog_keys_every_definition_by_its_own_ref():
    assert DEFAULT_MODEL_CATALOG
    assert all(
        ref == definition.ref for ref, definition in DEFAULT_MODEL_CATALOG.items()
    )


def test_every_definition_has_a_title_in_both_languages():
    for definition in DEFAULT_MODEL_CATALOG.values():
        assert definition.title.ko.strip()
        assert definition.title.en.strip()


def test_the_seed_offers_the_models_people_reach_for_first():
    assert sorted(DEFAULT_MODEL_CATALOG) == [
        "model://claude-haiku",
        "model://claude-opus",
        "model://claude-sonnet",
        "model://default",
    ]


def test_the_plain_title_says_what_the_model_is_like():
    assert DEFAULT_MODEL_CATALOG[DEFAULT_MODEL].title.ko == "기본 모델"
    assert DEFAULT_MODEL_CATALOG[DEFAULT_MODEL].title.en == "Default model"
    assert (
        DEFAULT_MODEL_CATALOG["model://claude-sonnet"].title.ko
        == "Claude Sonnet — 빠르고 균형 잡힘"
    )
    assert (
        DEFAULT_MODEL_CATALOG["model://claude-sonnet"].title.en
        == "Claude Sonnet — fast and balanced"
    )


def test_every_definition_says_who_serves_it_and_by_which_name():
    """ref 하나로 실제 모델을 부르려면 어디에 무슨 이름으로 물어야 하는지가 적혀 있어야 한다."""
    assert {
        ref: (definition.provider, definition.model_id)
        for ref, definition in DEFAULT_MODEL_CATALOG.items()
    } == {
        "model://default": ("anthropic", "claude-opus-5"),
        "model://claude-opus": ("anthropic", "claude-opus-5"),
        "model://claude-sonnet": ("anthropic", "claude-sonnet-5"),
        "model://claude-haiku": ("anthropic", "claude-haiku-4-5"),
    }


def test_the_catalog_is_public_data_so_it_carries_no_keys():
    """카탈로그는 git에 커밋되고 화면으로 그대로 나간다 — 열쇠가 낄 자리를 두지 않는다."""
    assert not [
        name for name in ModelDef.model_fields if SECRET_FIELD_PATTERN.search(name)
    ]


def test_a_definition_must_name_a_provider_this_runtime_knows():
    with pytest.raises(ValidationError):
        ModelDef(
            ref="model://default",
            title={"ko": "기본 모델", "en": "Default model"},
            provider="nobody",
            model_id="claude-opus-5",
        )


def test_a_model_is_a_name_not_a_shape():
    """모델은 형식이 아니다 — 폼을 그릴 schema를 들고 다니지 않는다."""
    assert "schema" not in ModelDef.model_fields


def test_resolve_model_finds_a_ref_the_catalog_holds():
    assert resolve_model(DEFAULT_MODEL) is DEFAULT_MODEL_CATALOG[DEFAULT_MODEL]


@pytest.mark.parametrize(
    "ref",
    [
        "",
        "model://nothing-here",
        "model://default@2",
        "MODEL://DEFAULT",
        "schema://answer-review@1",
        "not a ref at all",
    ],
)
def test_resolve_model_says_nothing_rather_than_raising(ref):
    assert resolve_model(ref) is None


def test_a_definition_ref_must_be_a_model_reference():
    with pytest.raises(ValidationError):
        ModelDef(ref="default", title={"ko": "기본 모델", "en": "Default model"})


def test_a_model_can_live_somewhere_other_than_a_company_s_own_door():
    """OpenAI 말투를 쓰는 곳이면 내 컴퓨터에서 띄운 것도 같은 계약으로 부른다."""
    local = ModelDef(
        ref="model://local",
        title={"ko": "내 컴퓨터의 모델", "en": "The model on my computer"},
        provider="openai_compatible",
        model_id="gemma4:26b",
        base_url="http://127.0.0.1:11434/v1",
    )

    assert local.base_url == "http://127.0.0.1:11434/v1"


def test_the_models_this_product_ships_with_are_at_their_own_door():
    """어디로 물어볼지 적지 않은 정의는 그 provider의 제자리로 간다."""
    assert {definition.base_url for definition in DEFAULT_MODEL_CATALOG.values()} == {
        None
    }
