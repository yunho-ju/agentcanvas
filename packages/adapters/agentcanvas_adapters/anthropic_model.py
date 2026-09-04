"""Anthropic에게 실제로 물어보는 자리 — 그래프의 이름을 진짜 모델과 진짜 프롬프트로 푼다.

무엇을 묻고 무엇을 답으로 치는지는 model_talk이 정한다: 여기 있는 것은 그 말을 이 provider의
말투로 옮기고, 저쪽 사정을 값으로 되돌리는 일뿐이다.

보내지 않는 것: `thinking`(적으면 생각의 폭을 스스로 좁힌다)과 `temperature`·`top_p`·`top_k`
(이 모델들에게는 함께 보낼 수 없는 다이얼이라 요청이 통째로 거절된다). 다시 걸어 보는 일은
클라이언트가 알아서 한다 — 여기에 우리만의 재시도 고리를 얹지 않는다.
"""

from __future__ import annotations

from collections.abc import Callable, Mapping, Sequence
from typing import Any

import anthropic
from agentcanvas_contracts.model_catalog import DEFAULT_MODEL_CATALOG, ModelDef
from agentcanvas_engine.model_call import (
    ModelAsk,
    ModelBalked,
    ModelCall,
    ModelSaid,
    ModelTurn,
    ToolBrief,
    ToolCall,
    ToolReply,
    TranscriptItem,
)

from .model_talk import (
    CUT_SHORT,
    DECLINED,
    NO_ANSWER,
    cannot_take_tools,
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


def _tool_shape(brief: ToolBrief) -> dict[str, Any]:
    """도구 한 벌을 이 문의 말로 — 이름과 쉬운 설명과 넣을 것의 모양."""
    return {
        "name": brief.name,
        "description": brief.description,
        "input_schema": dict(brief.input_schema),
    }


def _the_turn_it_took(turn: ModelTurn) -> dict[str, Any]:
    """모델이 지난 턴에 한 것 — 말도 시킨 도구도 이 문에서는 같은 줄의 조각들이다."""
    spoken = [{"type": "text", "text": turn.text}] if turn.text else []
    return {
        "role": "assistant",
        "content": [
            *spoken,
            *(
                {
                    "type": "tool_use",
                    "id": call.call_id,
                    "name": call.name,
                    "input": dict(call.arguments),
                }
                for call in turn.tool_calls
            ),
        ],
    }


def _what_the_tools_answered(replies: Sequence[ToolReply]) -> dict[str, Any]:
    """한 턴에 부른 도구들이 돌려준 것 — 이 문에서는 사람이 말한 자리에 결과 조각으로 들어간다.

    한 줄에 모아 넣는 까닭: 한 턴에 도구를 둘 불렀으면 저쪽은 그 결과도 한 줄에서 기다린다.
    한 줄에 하나씩 나눠 보내면 첫 줄이 두 번째 호출의 답을 빠뜨린 것이 되어 청이 물린다.
    """
    return {
        "role": "user",
        "content": [
            {
                "type": "tool_result",
                "tool_use_id": reply.call_id,
                "content": reply.content,
            }
            for reply in replies
        ],
    }


def _turns_so_far(transcript: Sequence[TranscriptItem]) -> list[dict[str, Any]]:
    """이전 턴들을 이 문이 읽는 메시지 줄로 편다 — 일어난 차례 그대로, 붙어 있는 결과는 한 줄로."""
    written: list[dict[str, Any]] = []
    answered: list[ToolReply] = []
    for item in transcript:
        if isinstance(item, ToolReply):
            answered.append(item)
            continue
        written.extend(_gathered(answered))
        answered = []
        written.append(_the_turn_it_took(item))
    return [*written, *_gathered(answered)]


def _gathered(replies: Sequence[ToolReply]) -> list[dict[str, Any]]:
    """모아 둔 결과들을 한 줄로 — 모아 둔 것이 없으면 줄도 없다."""
    return [_what_the_tools_answered(replies)] if replies else []


def _request(ask: ModelAsk, model: ModelDef) -> dict[str, Any]:
    """저쪽에 보낼 청 한 벌 — 갈림길이면 답의 모양까지, 도구가 있으면 도구까지 함께 조인다."""
    request: dict[str, Any] = {
        "model": model.model_id,
        "max_tokens": MAX_TOKENS,
        "system": system_for(ask),
        "messages": [
            {"role": "user", "content": instruction(ask)},
            *_turns_so_far(ask.transcript),
        ],
    }
    if ask.tools:
        request["tools"] = [_tool_shape(brief) for brief in ask.tools]
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


def _calls_it_asked_for(answer: Any) -> tuple[ToolCall, ...]:
    """응답에서 도구를 시킨 조각들을 계약의 호출로 옮긴다 — 인자는 이미 풀려서 온다."""
    return tuple(
        ToolCall(call_id=block.id, name=block.name, arguments=block.input)
        for block in answer.content
        if getattr(block, "type", None) == "tool_use"
    )


def asks_anthropic(
    client: Any, catalog: Mapping[str, ModelDef] | None = None
) -> ModelCall:
    """열려 있는 클라이언트로 Anthropic에게 물어보는 것 — 시험은 결정론 대역을 넣는다."""
    known = DEFAULT_MODEL_CATALOG if catalog is None else catalog

    def asks(ask: ModelAsk) -> ModelSaid | ModelBalked:
        model = known.get(ask.model_ref)
        if model is None:
            return no_such_model(ask.model_ref)
        if ask.tools and not model.tool_calling:
            return cannot_take_tools(ask.model_ref)
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
        return heard(
            ask,
            _words_of(answer),
            prompt_of(request["system"], request["messages"][0]["content"]),
            answer.usage.input_tokens,
            answer.usage.output_tokens,
            _calls_it_asked_for(answer),
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
