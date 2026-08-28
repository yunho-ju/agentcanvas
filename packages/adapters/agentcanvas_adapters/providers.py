"""어느 곳에 물을지 고르는 자리 — 모델 정의가 말하는 provider가 그대로 물을 자리를 정한다.

여기가 provider를 아는 마지막 자리다: 실행기도 서비스도 이 이름을 알지 못한다.
새 provider는 표에 한 줄이면 된다 (분기 대신 표 — 기존 줄을 고치지 않는다).
"""

from __future__ import annotations

from collections.abc import Callable, Mapping
from dataclasses import dataclass

from agentcanvas_contracts.model_catalog import (
    DEFAULT_MODEL_CATALOG,
    ModelDef,
    Provider,
)
from agentcanvas_engine.model_call import ModelAsk, ModelBalked, ModelCall, ModelSaid

from .anthropic_model import ANTHROPIC_API_KEY_REF, anthropic_from
from .model_talk import no_such_model
from .openai_model import OPENAI_API_KEY_REF, openai_from
from .secrets import SecretResolver

#: 금고와 카탈로그를 받아 그곳에 물어볼 자리를 여는 것.
OpensADoor = Callable[[SecretResolver, Mapping[str, ModelDef]], ModelCall]


@dataclass(frozen=True)
class ProviderDoor:
    """모델이 사는 곳 하나 — 어떤 열쇠를 찾고, 어떻게 그 자리를 여는가."""

    key_ref: str
    opens: OpensADoor


#: 모델이 사는 곳 → 그 문. 새 provider는 여기 한 줄이다.
OPENS_BY_PROVIDER: dict[Provider, ProviderDoor] = {
    "anthropic": ProviderDoor(ANTHROPIC_API_KEY_REF, anthropic_from),
    "openai_compatible": ProviderDoor(OPENAI_API_KEY_REF, openai_from),
}


def nobody_to_ask(
    vault: SecretResolver, catalog: Mapping[str, ModelDef] | None = None
) -> bool:
    """Catalog에 실제로 물을 수 있는 provider나 keyless local model이 없는가.

    열쇠는 같은 provider의 모델이 catalog에 있을 때만 그 문을 연다. 내 컴퓨터에서
    띄운 모델(base_url이 있는 정의)은 열쇠 없이도 물을 수 있다.
    """
    known = DEFAULT_MODEL_CATALOG if catalog is None else catalog
    if any(model.base_url for model in known.values()):
        return False
    providers = {model.provider for model in known.values()}
    return not any(
        vault(OPENS_BY_PROVIDER[provider].key_ref) is not None for provider in providers
    )


def can_be_asked(
    model_ref: str, vault: SecretResolver, catalog: Mapping[str, ModelDef] | None = None
) -> bool:
    """이 이름 하나가 이 서버에서 실제로 답까지 닿는가 — 세워 두지 않은 이름도, 열쇠 없는 문도 닿지 못한다.

    nobody_to_ask는 "아무나 물을 곳이 있는가"를 묻고, 이쪽은 "바로 이 이름을 물을 수 있는가"를
    묻는다. 두 물음을 같은 것으로 쓰면, 다른 문이 열린 서버에서 닿지도 못할 이름을 세워 두고
    매번 balk를 답으로 받는다 — 조용한 거짓말이 된다.
    """
    known = DEFAULT_MODEL_CATALOG if catalog is None else catalog
    model = known.get(model_ref)
    if model is None:
        return False
    if model.base_url:
        return True
    return vault(OPENS_BY_PROVIDER[model.provider].key_ref) is not None


def asks_whoever_serves(
    vault: SecretResolver, catalog: Mapping[str, ModelDef] | None = None
) -> ModelCall:
    """물음 하나가 그 모델이 사는 곳에 닿게 한다 — 아무도 세워 두지 않은 이름은 아무에게도 닿지 않는다.

    문은 모두 미리 열어 둔다: 열쇠를 꺼내는 일은 물을 때마다 할 일이 아니다.
    """
    known = DEFAULT_MODEL_CATALOG if catalog is None else catalog
    doors = {name: door.opens(vault, known) for name, door in OPENS_BY_PROVIDER.items()}

    def asks(ask: ModelAsk) -> ModelSaid | ModelBalked:
        model = known.get(ask.model_ref)
        if model is None:
            return no_such_model(ask.model_ref)
        return doors[model.provider](ask)

    return asks


__all__ = [
    "OPENS_BY_PROVIDER",
    "OpensADoor",
    "ProviderDoor",
    "asks_whoever_serves",
    "can_be_asked",
    "nobody_to_ask",
]
