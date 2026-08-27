"""OpenAI 말투를 쓰는 곳에 물어보는 자리 — 본사도, 내 컴퓨터에서 띄운 것도 같은 계약이다.

어느 문으로 갈지는 모델 정의의 `base_url`이 정한다: 주소가 없으면 그 회사의 제자리, 있으면
거기서 띄운 서빙(Ollama 등)이다. 로컬 서빙은 열쇠를 검사하지 않으므로 관례값 하나면 되고,
회사 제자리에는 진짜 열쇠가 있어야 한다 — 없으면 그물에 나가기 전에 그 까닭을 답한다.

무엇을 묻고 무엇을 답으로 치는지는 model_talk이 정한다. 다시 걸어 보는 일은 클라이언트가
알아서 한다 — 여기에 우리만의 재시도 고리를 얹지 않는다.
"""

from __future__ import annotations

from collections.abc import Callable, Mapping
from dataclasses import replace
from time import perf_counter
from typing import Any
from uuid import uuid4

import openai
from agentcanvas_contracts.model_catalog import DEFAULT_MODEL_CATALOG, ModelDef
from agentcanvas_engine.model_call import (
    ModelAsk,
    ModelBalked,
    ModelCall,
    ModelEvidence,
    ModelSaid,
)

from .model_talk import (
    CUT_SHORT,
    DECLINED,
    NO_ANSWER,
    NOTHING_SAID,
    heard,
    instruction,
    missing_key,
    no_such_model,
    one_way_only,
    prompt_of,
    system_for,
    trouble,
)
from .secrets import SecretResolver

#: 이 provider의 열쇠가 금고에서 갖는 이름.
OPENAI_API_KEY_REF = "secret://openai-api-key"

#: 내 컴퓨터에서 띄운 서빙에 대는 관례값 — 그쪽은 열쇠를 보지 않지만 자리는 비울 수 없다.
LOCAL_KEY = "ollama"

#: 답 하나에 내주는 크기 — 생각하는 데 먼저 쓰이는 판이 있어 인색하게 잡으면 답할 몫이 남지 않는다.
MAX_TOKENS = 4096

#: 그 크기를 문마다 어떤 말로 부르는가 — 본사의 생각하는 모델은 옛 이름을 아예 받지 않고,
#: 어딘가에서 띄운 서빙(Ollama 등)은 옛 이름으로 받는다(실측으로 확인한 자리).
ROOM_AT_THE_COMPANY = "max_completion_tokens"
ROOM_AT_A_SERVING = "max_tokens"

#: 조인 모양에 이 provider가 요구하는 이름표.
WAY_SHAPE_NAME = "the_way_to_take"

#: 답이 끝까지 오지 못한 까닭 → 사람에게 할 말. 표에 없는 까닭은 답이 온 것으로 본다.
TROUBLE_BY_FINISH_REASON = {
    "length": CUT_SHORT,
    "content_filter": DECLINED,
}


def _at_the_company(model: ModelDef) -> bool:
    """이 모델이 그 회사의 제자리에 있는가 — 주소가 적혀 있으면 거기서 띄운 서빙이다."""
    return model.base_url is None


def _room_for_an_answer(model: ModelDef) -> dict[str, Any]:
    """이 문이 답의 크기를 듣는 말 — 본사는 새 이름만 받고, 서빙은 옛 이름으로 받는다."""
    heard_as = ROOM_AT_THE_COMPANY if _at_the_company(model) else ROOM_AT_A_SERVING
    return {heard_as: MAX_TOKENS}


def _way_shape(ways: tuple[str, ...], model: ModelDef) -> dict[str, Any]:
    """답의 모양을 청하는 말 — 본사에는 엄격하게 청해 고른 길이 정말 그 목록 안에서 오게 한다.

    어딘가에서 띄운 서빙에는 예나 지금이나 같은 모양으로 청한다: 실측으로 확인한 자리에
    확인하지 못한 말을 얹지 않는다.
    """
    shape: dict[str, Any] = {"name": WAY_SHAPE_NAME}
    if _at_the_company(model):
        shape["strict"] = True
    return {**shape, "schema": one_way_only(ways)}


def _response_shape(ask: ModelAsk) -> dict[str, Any]:
    """임의 응답이 아니라 ask가 정한 JSON Schema를 provider 말투로 옮긴다.

    갈림길과 달리 여기서는 어느 문에도 엄격을 얹지 않는다. 엄격은 모든 열쇠가 required이고
    여분을 막을 것을 요구하는데, ask가 들고 오는 모양에는 선택 열쇠도 자유로운 판(config 같은
    임의 객체)도 있다 — 얹으면 저쪽이 청을 통째로 물린다(실측으로 확인한 자리). 온 답이 정말
    그 모양인지는 받는 쪽이 계약으로 다시 본다.
    """
    return {
        "name": ask.response_name or "structured_response",
        "schema": dict(ask.response_schema or {}),
    }


def _request(ask: ModelAsk, model: ModelDef) -> dict[str, Any]:
    """저쪽에 보낼 청 한 벌 — 갈림길이면 답의 모양까지 함께 조인다."""
    request: dict[str, Any] = {
        "model": model.model_id,
        **_room_for_an_answer(model),
        "messages": [
            {"role": "system", "content": system_for(ask)},
            {"role": "user", "content": instruction(ask)},
        ],
    }
    if ask.response_schema is not None:
        request["response_format"] = {
            "type": "json_schema",
            "json_schema": _response_shape(ask),
        }
    elif ask.ways:
        request["response_format"] = {
            "type": "json_schema",
            "json_schema": _way_shape(ask.ways, model),
        }
    if _at_the_company(model):
        # ARCH-4 preview는 저장하지 않는 요청임을 provider에도 명시한다.
        request["store"] = False
    return request


def _prompt_sent(request: Mapping[str, Any]) -> str:
    system, said = request["messages"]
    return prompt_of(system["content"], said["content"])


def _read(
    ask: ModelAsk, request: Mapping[str, Any], answer: Any
) -> ModelSaid | ModelBalked:
    """온 답을 계약의 말로 옮긴다 — 끝까지 오지 못한 답은 반쪽이라도 답으로 치지 않는다."""
    if not answer.choices:
        return trouble(NOTHING_SAID)
    chose = answer.choices[0]
    cut = TROUBLE_BY_FINISH_REASON.get(chose.finish_reason)
    if cut is not None:
        return trouble(cut)
    said = chose.message.content
    if not said:
        return trouble(NOTHING_SAID)
    return heard(
        ask,
        said,
        _prompt_sent(request),
        answer.usage.prompt_tokens,
        answer.usage.completion_tokens,
    )


def _request_id(answer: Any, client_request_id: str) -> str:
    """provider가 준 id를 우선하고, 없으면 우리가 보낸 안전한 id를 쓴다."""
    supplied = getattr(answer, "_request_id", None)
    return supplied if isinstance(supplied, str) and supplied else client_request_id


def _processing_ms(answer: Any) -> int | None:
    """SDK가 노출한 processing header만 읽고, 없으면 지어내지 않는다."""
    headers = getattr(answer, "headers", None)
    if headers is None or not hasattr(headers, "get"):
        return None
    raw = headers.get("openai-processing-ms")
    try:
        value = int(raw)
    except (TypeError, ValueError):
        return None
    return value if value >= 0 else None


def opens_openai(base_url: str | None, key: str) -> openai.OpenAI:
    """열쇠 하나로 그 주소의 문을 연다 — 주소가 없으면 그 회사의 제자리다."""
    return openai.OpenAI(api_key=key, base_url=base_url)


def openai_from(
    vault: SecretResolver,
    catalog: Mapping[str, ModelDef] | None = None,
    client_from: Callable[[str | None, str], Any] = opens_openai,
) -> ModelCall:
    """금고의 열쇠로 OpenAI 말투를 쓰는 곳에 물어볼 자리를 연다.

    열쇠는 문을 만들 때 한 번만 꺼내고, 문 하나는 주소마다 한 번만 연다 (물을 때마다 열지 않는다).
    """
    known = DEFAULT_MODEL_CATALOG if catalog is None else catalog
    key = vault(OPENAI_API_KEY_REF)
    opened: dict[str | None, Any] = {}

    def door_to(model: ModelDef, with_key: str) -> Any:
        if model.base_url not in opened:
            opened[model.base_url] = client_from(model.base_url, with_key)
        return opened[model.base_url]

    def asks(ask: ModelAsk) -> ModelSaid | ModelBalked:
        model = known.get(ask.model_ref)
        if model is None:
            return no_such_model(ask.model_ref)
        if model.base_url is None and key is None:
            # 회사 제자리에는 진짜 열쇠가 있어야 한다 — 관례값으로 문을 두드리지 않는다.
            return missing_key(OPENAI_API_KEY_REF)
        # 로컬 서빙은 열쇠를 보지 않는다 — 자리만 채워 준다.
        client = door_to(model, key if key is not None else LOCAL_KEY)
        client_request_id = f"agentcanvas-{uuid4().hex}"
        request = {
            **_request(ask, model),
            "extra_headers": {"X-Client-Request-Id": client_request_id},
        }
        started = perf_counter()
        try:
            answer = client.chat.completions.create(**request)
        except openai.OpenAIError:
            # 저쪽 사정은 여기서 끝난다 — 무엇이 어긋났는지는 우리 화면의 말이 아니다.
            return trouble(NO_ANSWER)
        said = _read(ask, request, answer)
        if not isinstance(said, ModelSaid):
            return said
        return replace(
            said,
            evidence=ModelEvidence(
                provider=model.provider,
                model_id=model.model_id,
                request_id=_request_id(answer, client_request_id),
                latency_ms=max(0, round((perf_counter() - started) * 1000)),
                provider_processing_ms=_processing_ms(answer),
            ),
        )

    return asks


__all__ = [
    "LOCAL_KEY",
    "MAX_TOKENS",
    "OPENAI_API_KEY_REF",
    "ROOM_AT_A_SERVING",
    "ROOM_AT_THE_COMPANY",
    "TROUBLE_BY_FINISH_REASON",
    "WAY_SHAPE_NAME",
    "openai_from",
    "opens_openai",
]
