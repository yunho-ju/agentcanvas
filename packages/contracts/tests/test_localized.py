import pytest
from agentcanvas_contracts.localized import LocalizedText
from pydantic import ValidationError


def test_localized_text_carries_both_languages():
    text = LocalizedText.model_validate({"ko": "입력", "en": "Input"})
    assert (text.ko, text.en) == ("입력", "Input")


@pytest.mark.parametrize("missing", ["ko", "en"])
def test_localized_text_requires_both_languages(missing):
    values = {"ko": "입력", "en": "Input"}
    del values[missing]
    with pytest.raises(ValidationError) as exc:
        LocalizedText.model_validate(values)
    assert exc.value.errors()[0]["loc"] == (missing,)


@pytest.mark.parametrize("language", ["ko", "en"])
@pytest.mark.parametrize("blank", ["", "   ", "\t"])
def test_localized_text_rejects_a_blank_language(language, blank):
    with pytest.raises(ValidationError) as exc:
        LocalizedText.model_validate({"ko": "입력", "en": "Input", language: blank})
    assert exc.value.errors()[0]["loc"] == (language,)


def test_localized_text_rejects_a_language_we_do_not_publish():
    with pytest.raises(ValidationError):
        LocalizedText.model_validate({"ko": "입력", "en": "Input", "ja": "入力"})


def test_localized_text_reads_a_plain_dump_back():
    text = LocalizedText(ko="입력", en="Input")
    assert LocalizedText.model_validate(text.model_dump(mode="json")) == text
