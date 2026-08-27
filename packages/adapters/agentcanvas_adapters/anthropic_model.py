"""Anthropic에게 실제로 물어보는 자리 — 그래프의 이름을 진짜 모델과 진짜 프롬프트로 푼다.

무엇을 묻고 무엇을 답으로 치는지는 model_talk이 정한다: 여기 있는 것은 그 말을 이 provider의
말투로 옮기고, 저쪽 사정을 값으로 되돌리는 일뿐이다.

보내지 않는 것: `thinking`(적으면 생각의 폭을 스스로 좁힌다)과 `temperature`·`top_p`·`top_k`
(이 모델들에게는 함께 보낼 수 없는 다이얼이라 요청이 통째로 거절된다). 다시 걸어 보는 일은
클라이언트가 알아서 한다 — 여기에 우리만의 재시도 고리를 얹지 않는다.
"""

from __future__ import annotations

from collections.abc import Callable, Mapping
from typing import Any

import anthropic
from agentcanvas_contracts.model_catalog import DEFAULT_MODEL_CATALOG, ModelDef
from agentcanvas_engine.model_call import ModelAsk, ModelBalked, ModelCall, ModelSaid

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

#: 이 provider의 열쇠가 금고에서 갖는 이름 — 그래프에도 카탈로그에도 값이 아니라 이 이름만 산다.
ANTHROPIC_API_KEY_REF = "secret://anthropic-api-key"

#: 답 하나에 넉넉히 내주는 크기 — 생각하는 데 쓰는 몫까지 함께 세는 한도라 인색하게 잡지 않는다.
MAX_TOKENS = 4096

#: 답이 끝까지 오지 못한 까닭 → 사람에게 할 말. 표에 없는 까닭은 답이 온 것으로 본다.
TROUBLE_BY_STOP_REASON = {
    "refusal": DECLINED,
    "max_tokens": CUT_SHORT,
}


def _request(ask: ModelAsk, model: ModelDef) -> dict[str, Any]:
    """저쪽에 보낼 청 한 벌 — 갈림길이면 답의 모양까지 함께 조인다."""
    request: dict[str, Any] = {
        "model": model.model_id,
        "max_tokens": MAX_TOKENS,
        "system": system_for(ask),
        "messages": [{"role": "user", "content": instruction(ask)}],
    }
    if ask.response_schema is not None:
        request["output_config"] = {
            "format": {"type": "json_schema", "schema": dict(ask.response_schema)}
        }
    elif ask.ways:
        request["output_config"] = {
            "format": {"type": "json_schema", "schema": one_way_only(ask.ways)}
        }
    return request


def _words_of(answer: Any) -> str | None:
    """응답에서 말이 담긴 조각들만 이어 붙인다 — 말 조각이 하나도 없으면 없다고 답한다."""
    said = [
        block.text for block in answer.content if getattr(block, "type", None) == "text"
    ]
    return "".join(said) if said else None


def asks_anthropic(
    client: Any, catalog: Mapping[str, ModelDef] | None = None
) -> ModelCall:
    """열려 있는 클라이언트로 Anthropic에게 물어보는 것 — 시험은 결정론 대역을 넣는다."""
    known = DEFAULT_MODEL_CATALOG if catalog is None else catalog

    def asks(ask: ModelAsk) -> ModelSaid | ModelBalked:
        model = known.get(ask.model_ref)
        if model is None:
            return no_such_model(ask.model_ref)
        request = _request(ask, model)
        try:
            answer = client.messages.create(**request)
        except anthropic.AnthropicError:
            # 저쪽 사정은 여기서 끝난다 — 무엇이 어긋났는지는 우리 화면의 말이 아니다.
            return trouble(NO_ANSWER)
        # 거절도 잘림도 200으로 온다 — 말을 읽기 전에 왜 멈췄는지부터 본다.
        cut = TROUBLE_BY_STOP_REASON.get(answer.stop_reason)
        if cut is not None:
            return trouble(cut)
        said = _words_of(answer)
        if not said:
            return trouble(NOTHING_SAID)
        return heard(
            ask,
            said,
            prompt_of(request["system"], request["messages"][0]["content"]),
            answer.usage.input_tokens,
            answer.usage.output_tokens,
        )

    return asks


def opens_anthropic(key: str) -> anthropic.Anthropic:
    """열쇠 하나로 진짜 문을 연다 — 끊긴 그물에 다시 걸어 보는 일은 이 클라이언트가 알아서 한다."""
    return anthropic.Anthropic(api_key=key)


def _balks(balked: ModelBalked) -> ModelCall:
    """물어볼 수 없는 자리 — 물을 때마다 같은 까닭을 답한다 (부를 때 터지지 않는다)."""
    return lambda ask: balked


def anthropic_from(
    vault: SecretResolver,
    catalog: Mapping[str, ModelDef] | None = None,
    client_from_key: Callable[[str], Any] = opens_anthropic,
) -> ModelCall:
    """금고의 열쇠로 Anthropic에게 물어볼 자리를 연다 — 열쇠가 없으면 그 까닭을 답하는 자리가 된다.

    열쇠는 문을 만들 때 한 번만 꺼낸다: 물어볼 때마다 금고를 여는 것은 열쇠를 그만큼 더 흘리는 일이다.
    """
    key = vault(ANTHROPIC_API_KEY_REF)
    if key is None:
        return _balks(missing_key(ANTHROPIC_API_KEY_REF))
    return asks_anthropic(client_from_key(key), catalog)


__all__ = [
    "ANTHROPIC_API_KEY_REF",
    "MAX_TOKENS",
    "anthropic_from",
    "asks_anthropic",
    "opens_anthropic",
]
