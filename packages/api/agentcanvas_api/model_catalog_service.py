"""이 서버가 아는 모델과, 그중 지금 부를 수 있는 것 — 화면이 고를 목록의 원천.

제품이 싣고 다니는 번들 카탈로그만 보면, OpenAI만 설정된 서버에서 화면은 부를 수 없는
이름만 내놓는다. 그래서 서버가 자기 사정을 말한다: 무엇을 알고(공개 정의 그대로),
그중 무엇에 지금 닿을 수 있는가(runtime과 같은 판정 — can_be_asked 하나뿐이다).

나가는 것은 화면이 읽을 것뿐이다: 이름과 부르는 말, 그리고 판정. 서버를 띄운 자리의 설정
(주소·모델 ID)은 이 모양에 자리가 없고, 열쇠는 애초에 실릴 곳이 없다.
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Literal

from agentcanvas_adapters.providers import can_be_asked
from agentcanvas_adapters.secrets import SecretResolver
from agentcanvas_contracts.localized import LocalizedText
from agentcanvas_contracts.model_catalog import ModelDef
from agentcanvas_contracts.refs import ModelRef
from pydantic import BaseModel

#: 부를 수 없는 까닭 — 지금 이 서버가 말할 수 있는 것은 이 하나다(열쇠가 없다).
WhyNotCallable = Literal["missing_secret"]

#: 이 서버의 실행이 도는 자리 — 진짜 모델에게 묻거나(live), 연습용 답으로 돌거나(stand_in).
RunMode = Literal["live", "stand_in"]


class ModelStanding(BaseModel):
    """모델 하나가 이 서버에서 서는가 — 화면이 고르는 데 필요한 것만 든 모양.

    계약(AgentSpec)의 모양이 아니라 이 서버의 지금 사정이라 API 모델로만 있다:
    같은 문서가 서버마다 다르게 돌아가는 까닭을 화면이 읽는 자리다(EvaluatorStanding 선례).
    """

    ref: ModelRef
    title: LocalizedText
    callable: bool
    reason: WhyNotCallable | None


class ServerModels(BaseModel):
    """이 서버가 화면에 말하는 모델 사정 — 어떤 자리로 도는지와, 아는 모델들.

    모드가 따로 있는 까닭: 열쇠가 하나도 없는 서버는 실행이 연습용 답으로 **모든 이름에**
    답한다. 그때 열쇠 없음만 보고 전부 잠그면 화면이 실제와 다른 말을 하게 된다.
    """

    mode: RunMode
    models: list[ModelStanding]


def models_standing(
    catalog: Mapping[str, ModelDef], vault: SecretResolver
) -> list[ModelStanding]:
    """이 서버가 아는 모델을 카탈로그 순서 그대로, 부를 수 있는지와 함께 말한다."""
    return [
        _standing_of(model, can_be_asked(ref, vault, catalog))
        for ref, model in catalog.items()
    ]


def _standing_of(model: ModelDef, callable_now: bool) -> ModelStanding:
    return ModelStanding(
        ref=model.ref,
        title=model.title,
        callable=callable_now,
        reason=None if callable_now else "missing_secret",
    )


__all__ = [
    "ModelStanding",
    "RunMode",
    "ServerModels",
    "WhyNotCallable",
    "models_standing",
]
