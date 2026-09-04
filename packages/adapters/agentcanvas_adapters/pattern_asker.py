"""부탁 문장 하나를 읽고 무엇을 되물을지 고르는 자리 (설계 문서 D11).

모델은 **무엇을 물을지만** 고른다: 카탈로그의 물음과 근거만 보고, 부탁 문장에서 그 근거를
찾았으면 그 조각을 인용해 내민다. 템플릿은 보여 주지 않는다 — 모양을 문서에 놓는 일은
서버의 몫이라 모델이 구조를 지어낼 자리가 없다.

되묻기는 있으면 좋은 것이다: 읽지 못한 답도, 물러선 provider도 "물을 것이 없다"로 끝나고
초안을 막지 않는다.
"""

from __future__ import annotations

import json
from collections.abc import Callable
from dataclasses import dataclass

from agentcanvas_contracts.agent_spec import Node, Position
from agentcanvas_contracts.patterns import PatternDef
from agentcanvas_engine.model_call import ModelAsk, ModelCall, ModelSaid
from pydantic import BaseModel, ValidationError

PATTERN_ASKS_PROMPT_REF = "prompt://pattern-asks@1"
PATTERN_ASKS_SCHEMA_NAME = "pattern_asks"


class ProposedAsk(BaseModel):
    """모델이 물어보자고 내민 것 — 어느 모양을, 부탁의 어느 조각을 근거로."""

    pattern_id: str
    why: str


class ProposedAsks(BaseModel):
    """모델이 돌려주는 한 벌 — 물을 것이 없으면 빈 목록이다."""

    asks: list[ProposedAsk] = []


@dataclass(frozen=True)
class PatternAskRequest:
    request: str
    model_ref: str
    patterns: tuple[PatternDef, ...]
    prompt_ref: str = PATTERN_ASKS_PROMPT_REF


type PatternAskCall = Callable[[PatternAskRequest], tuple[ProposedAsk, ...]]


def _shapes_on_offer(patterns: tuple[PatternDef, ...]) -> str:
    return json.dumps(
        [
            {
                "id": pattern.id,
                "question": pattern.question.en,
                "applies_when": pattern.applies_when.en,
            }
            for pattern in patterns
        ],
        ensure_ascii=False,
        sort_keys=True,
    )


def _pattern_ask_prompt(asked: PatternAskRequest) -> str:
    return "\n".join(
        [
            "A person described the agent they want built.",
            "Decide which of the shapes below is worth asking them about.",
            'Return JSON only, shaped {"asks": [{"pattern_id": "...", "why": "..."}]}.',
            "Only propose a shape when the request itself shows a reason for it.",
            (
                "Quote the exact words from the request that show that reason as "
                '"why" — copy them, do not paraphrase.'
            ),
            (
                "Propose at most three, and propose none at all when nothing in "
                "the request points to one."
            ),
            f"The request is: {asked.request}",
            "Shapes you may ask about (JSON: id, question, applies_when):",
            _shapes_on_offer(asked.patterns),
        ]
    )


def _ask_for(asked: PatternAskRequest) -> ModelAsk:
    return ModelAsk(
        node=Node(
            id="pattern-asker",
            type="llm.agent",
            position=Position(x=0, y=0),
            config={"model_ref": asked.model_ref},
        ),
        state={},
        ways=(),
        model_ref=asked.model_ref,
        prompt_ref=asked.prompt_ref,
        instruction=_pattern_ask_prompt(asked),
        response_schema=ProposedAsks.model_json_schema(),
        response_name=PATTERN_ASKS_SCHEMA_NAME,
    )


def pattern_asker_from(model: ModelCall) -> PatternAskCall:
    """기존 ModelCall을 "무엇을 되물을까" 자리로 감싼다."""

    def proposes(asked: PatternAskRequest) -> tuple[ProposedAsk, ...]:
        said = model(_ask_for(asked))
        if not isinstance(said, ModelSaid) or not said.text:
            return ()
        try:
            return tuple(ProposedAsks.model_validate(json.loads(said.text)).asks)
        except (json.JSONDecodeError, TypeError, ValidationError):
            return ()

    return proposes


__all__ = [
    "PATTERN_ASKS_PROMPT_REF",
    "PATTERN_ASKS_SCHEMA_NAME",
    "PatternAskCall",
    "PatternAskRequest",
    "ProposedAsk",
    "ProposedAsks",
    "pattern_asker_from",
]
