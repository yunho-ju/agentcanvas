import pytest
from agentcanvas_contracts import (
    DEFAULT_INSTRUCTION_CATALOG,
    InstructionPresetDef,
    resolve_instruction_preset,
)
from pydantic import ValidationError

SUMMARIZE = "summarize"


def test_the_catalog_keys_every_preset_by_its_own_id():
    assert DEFAULT_INSTRUCTION_CATALOG
    assert all(
        preset_id == preset.id
        for preset_id, preset in DEFAULT_INSTRUCTION_CATALOG.items()
    )


def test_the_seed_offers_the_jobs_people_ask_for_first():
    assert sorted(DEFAULT_INSTRUCTION_CATALOG) == [
        "classify",
        "simplify",
        "summarize",
        "translate",
    ]


def test_every_preset_has_a_title_and_a_text_in_both_languages():
    for preset in DEFAULT_INSTRUCTION_CATALOG.values():
        assert preset.title.ko.strip()
        assert preset.title.en.strip()
        assert preset.text.ko.strip()
        assert preset.text.en.strip()


def test_the_title_says_what_the_step_will_do():
    assert DEFAULT_INSTRUCTION_CATALOG[SUMMARIZE].title.ko == "요약해요"
    assert DEFAULT_INSTRUCTION_CATALOG[SUMMARIZE].title.en == "Summarize"
    assert DEFAULT_INSTRUCTION_CATALOG["simplify"].title.ko == "쉬운 말로 바꿔요"
    assert DEFAULT_INSTRUCTION_CATALOG["simplify"].title.en == "Put it in plain words"


def test_the_text_is_the_instruction_itself_written_in_plain_words():
    assert DEFAULT_INSTRUCTION_CATALOG[SUMMARIZE].text.ko == (
        "다음 글을 읽고 중요한 내용만 세 문장 이내로 요약해요. 쉬운 말로 써요."
    )
    assert DEFAULT_INSTRUCTION_CATALOG[SUMMARIZE].text.en == (
        "Read the input and summarize only the important points in three "
        "sentences or fewer. Use plain language."
    )


def test_a_preset_needs_an_id_that_is_not_empty():
    with pytest.raises(ValidationError):
        InstructionPresetDef(
            id="",
            title={"ko": "요약해요", "en": "Summarize"},
            text={"ko": "요약해요.", "en": "Summarize it."},
        )


def test_a_preset_is_a_title_and_a_text_and_nothing_else():
    """프리셋으로 채운 글은 손으로 쓴 글과 같다 — 어디서 왔는지 남길 자리가 없다."""
    assert sorted(InstructionPresetDef.model_fields) == ["id", "text", "title"]


def test_resolve_instruction_preset_finds_an_id_the_catalog_holds():
    assert (
        resolve_instruction_preset(SUMMARIZE) is DEFAULT_INSTRUCTION_CATALOG[SUMMARIZE]
    )


@pytest.mark.parametrize(
    "preset_id",
    [
        "",
        "nothing-here",
        "SUMMARIZE",
        "summarize ",
        "instruction://summarize",
        "not an id at all",
    ],
)
def test_resolve_instruction_preset_says_nothing_rather_than_raising(preset_id):
    assert resolve_instruction_preset(preset_id) is None
