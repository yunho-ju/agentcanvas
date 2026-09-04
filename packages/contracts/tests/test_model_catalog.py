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


def test_a_model_says_whether_it_can_be_given_tools():
    """도구를 건넬 수 있는가는 모델마다 다르다 — 화면도 실행도 이 한 자리를 읽는다."""
    plain = ModelDef(
        ref="model://plain",
        title={"ko": "도구를 모르는 모델", "en": "A model that knows no tools"},
        provider="openai_compatible",
        model_id="tiny",
        base_url="http://127.0.0.1:11434/v1",
        tool_calling=False,
    )

    assert plain.tool_calling is False


def test_the_models_this_product_ships_with_can_all_be_given_tools():
    """번들 목록은 본사의 모델뿐이다 — 도구를 못 받는 것은 여기 없다."""
    assert {
        definition.tool_calling for definition in DEFAULT_MODEL_CATALOG.values()
    } == {True}


def test_a_model_can_say_it_needs_its_thinking_off_to_use_tools():
    """도구를 쓰려면 추론을 꺼야 하는 문이 있다 — 그 사정은 모델마다 다르므로 정의가 들고 있다."""
    thinking = ModelDef(
        ref="model://thinker",
        title={"ko": "생각하는 모델", "en": "A thinking model"},
        provider="openai_compatible",
        model_id="gpt-5.6-luna",
        tools_need_thinking_off=True,
    )

    assert thinking.tools_need_thinking_off is True


def test_a_model_is_not_asked_to_turn_its_thinking_off_unless_someone_says_so():
    """대부분의 문은 이 말을 아예 받지 않는다 — 기본은 보내지 않는 것이다."""
    assert {
        definition.tools_need_thinking_off
        for definition in DEFAULT_MODEL_CATALOG.values()
    } == {False}
