"""모델 카탈로그 — `model://` ref가 가리키는 모델이 사는 곳.

어떤 모델에게 맡길지는 노드 config의 이름(ref) 하나로만 적힌다.
많이 쓰는 이름은 여기 있어서 고르기만 하면 되고, 특수한 이름만 직접 적는다.
"""

from __future__ import annotations

from typing import Literal

from pydantic import Field

from .agent_spec import ContractModel
from .localized import LocalizedText
from .refs import ModelRef

#: 지금 실제로 부를 수 있는 곳 — 새 곳이 생기면 여기 한 이름을 더한다.
#: `openai_compatible`은 OpenAI 말투로 답하는 곳 전부다 (본사도, 내 컴퓨터에서 띄운 것도).
Provider = Literal["anthropic", "openai_compatible"]


class ModelDef(ContractModel):
    """ref 하나가 가리키는 모델 — 형식이 아니라 이름이라 schema를 들고 다니지 않는다.

    이 목록은 git에 커밋되고 화면으로 그대로 나가는 공개 데이터다: 열쇠는 여기 적지 않는다
    (열쇠는 서버만 아는 `secret://` 이름으로 따로 산다).
    """

    ref: ModelRef
    title: LocalizedText
    provider: Provider
    #: 그곳에 물어볼 때 대는 이름 — 사람이 고르는 ref와 달리 부르는 쪽의 말이다.
    model_id: str = Field(min_length=1)
    #: 어느 문으로 물어볼지 — 적지 않으면 그 provider의 제자리다. 내 컴퓨터에서 띄운 모델은
    #: 이 자리에 그 주소를 적는다 (주소는 열쇠가 아니다 — 감출 것이 없다).
    base_url: str | None = None


DEFAULT_MODEL_CATALOG: dict[str, ModelDef] = {
    definition.ref: definition
    for definition in [
        ModelDef.model_validate(
            {
                "ref": "model://default",
                "provider": "anthropic",
                "model_id": "claude-opus-5",
                "title": {"ko": "기본 모델", "en": "Default model"},
            }
        ),
        ModelDef.model_validate(
            {
                "ref": "model://claude-sonnet",
                "provider": "anthropic",
                "model_id": "claude-sonnet-5",
                "title": {
                    "ko": "Claude Sonnet — 빠르고 균형 잡힘",
                    "en": "Claude Sonnet — fast and balanced",
                },
            }
        ),
        ModelDef.model_validate(
            {
                "ref": "model://claude-opus",
                "provider": "anthropic",
                "model_id": "claude-opus-5",
                "title": {
                    "ko": "Claude Opus — 깊은 판단",
                    "en": "Claude Opus — deep reasoning",
                },
            }
        ),
        ModelDef.model_validate(
            {
                "ref": "model://claude-haiku",
                "provider": "anthropic",
                "model_id": "claude-haiku-4-5",
                "title": {
                    "ko": "Claude Haiku — 가장 빠름",
                    "en": "Claude Haiku — fastest",
                },
            }
        ),
    ]
}


def resolve_model(ref: str) -> ModelDef | None:
    """ref가 가리키는 모델을 돌려준다 — 정확히 같은 이름만 찾고, 못 찾으면 없다고 말한다."""
    return DEFAULT_MODEL_CATALOG.get(ref)


__all__ = ["DEFAULT_MODEL_CATALOG", "ModelDef", "Provider", "resolve_model"]
