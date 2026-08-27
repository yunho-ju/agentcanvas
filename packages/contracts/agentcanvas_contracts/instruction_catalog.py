"""지시문 프리셋 카탈로그 — 빈 상자 앞에서 무엇을 적을지 모르는 사람이 고르는 시작 글.

고른 글은 그대로 노드의 지시문이 되고, 거기서부터 고쳐 쓴다.
저장되는 것은 글 하나뿐이라, 프리셋으로 채운 글과 손으로 쓴 글은 구별되지 않는다.
"""

from __future__ import annotations

from pydantic import Field

from .agent_spec import ContractModel
from .localized import LocalizedText


class InstructionPresetDef(ContractModel):
    """골라 채우는 시작 글 하나 — 이름표(제목)와 채워질 본문이 전부다."""

    #: 카탈로그 안에서 이 글을 가리키는 이름 — 화면에 나가지 않는다.
    id: str = Field(min_length=1)
    title: LocalizedText
    text: LocalizedText


DEFAULT_INSTRUCTION_CATALOG: dict[str, InstructionPresetDef] = {
    preset.id: preset
    for preset in [
        InstructionPresetDef.model_validate(
            {
                "id": "summarize",
                "title": {"ko": "요약해요", "en": "Summarize"},
                "text": {
                    "ko": (
                        "다음 글을 읽고 중요한 내용만 세 문장 이내로 요약해요. "
                        "쉬운 말로 써요."
                    ),
                    "en": (
                        "Read the input and summarize only the important points "
                        "in three sentences or fewer. Use plain language."
                    ),
                },
            }
        ),
        InstructionPresetDef.model_validate(
            {
                "id": "classify",
                "title": {"ko": "분류해요", "en": "Classify"},
                "text": {
                    "ko": (
                        "다음 글이 어떤 갈래에 속하는지 정하고, 그 갈래 이름 하나만 "
                        "답해요. 이유는 덧붙이지 않아요."
                    ),
                    "en": (
                        "Decide which category the input belongs to and answer "
                        "with just that category name. Do not add reasons."
                    ),
                },
            }
        ),
        InstructionPresetDef.model_validate(
            {
                "id": "simplify",
                "title": {"ko": "쉬운 말로 바꿔요", "en": "Put it in plain words"},
                "text": {
                    "ko": (
                        "다음 글을 처음 보는 사람도 이해할 수 있게 쉬운 말로 다시 "
                        "써요. 뜻은 바꾸지 않아요."
                    ),
                    "en": (
                        "Rewrite the input in plain language so a first-time "
                        "reader can understand it. Keep the meaning unchanged."
                    ),
                },
            }
        ),
        InstructionPresetDef.model_validate(
            {
                "id": "translate",
                "title": {"ko": "번역해요", "en": "Translate"},
                "text": {
                    "ko": (
                        "다음 글이 한국어면 영어로, 영어면 한국어로 자연스럽게 "
                        "번역해요."
                    ),
                    "en": (
                        "Translate the input — into English if it is Korean, "
                        "into Korean if it is English."
                    ),
                },
            }
        ),
    ]
}


def resolve_instruction_preset(preset_id: str) -> InstructionPresetDef | None:
    """id가 가리키는 프리셋을 돌려준다 — 정확히 같은 이름만 찾고, 못 찾으면 없다고 말한다."""
    return DEFAULT_INSTRUCTION_CATALOG.get(preset_id)


__all__ = [
    "DEFAULT_INSTRUCTION_CATALOG",
    "InstructionPresetDef",
    "resolve_instruction_preset",
]
