"""서버가 세우는 판정 사다리 — 이 서버에 실제로 설 수 있는 층만, 싼 것부터 얹는다.

0층(글자 확인)은 언제나 선다. 그 위의 뜻 확인은 서버에 골라 설치하는 것이라, 함의를
물을 자리가 없으면 사다리는 0층까지만 선다 — 판정은 계속 돌고, 다만 조용히 지나가지
않는다: 무엇이 빠졌는지 서버 로그가 말한다.

층을 더 얹는 일은 여기에 한 줄 얹는 일이다(무엇을 얹을지 정하는 자리) — 사다리를 딛는
규칙(engine)도, 배치를 도는 규칙(EvalBatchService)도 고치지 않는다.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass

from agentcanvas_adapters.entailment import EntailmentCall
from agentcanvas_contracts.evaluator_catalog import DEFAULT_EVALUATOR_CATALOG
from agentcanvas_engine.evaluation.evaluator import Evaluator
from agentcanvas_engine.evaluation.expected_phrases import EVALUATOR_NAME
from agentcanvas_engine.evaluation.nli_entailment import (
    NLI_EVALUATOR_NAME,
    nli_entailment_evaluator,
)
from agentcanvas_engine.evaluation.registry import DEFAULT_EVALUATORS

from .entailment_memory import JudgementMemory, remembers_what_was_judged

_logger = logging.getLogger(__name__)

#: 뜻 검사가 없는 서버가 남기는 말 — 사람이 읽을 사실 하나, 속엣말은 없다.
NO_MEANING_LAYER = (
    "the meaning check (NLI) is not installed, so only the wording check runs"
    " — install agentcanvas-adapters[nli] to add it"
)


@dataclass(frozen=True)
class JudgingLadder:
    """세워진 사다리 — 무엇이 있고(evaluators), 어느 차례로 딛는가(order)."""

    evaluators: dict[str, Evaluator]
    order: list[str]


def judging_ladder(
    asks: EntailmentCall | None, memory: JudgementMemory | None = None
) -> JudgingLadder:
    """실을 수 있는 것만 얹은 사다리 — 뜻 검사는 같은 물음을 두 번 묻지 않게 감싸서 얹는다."""
    evaluators = dict(DEFAULT_EVALUATORS)
    order = [EVALUATOR_NAME]
    if asks is None:
        _logger.info(NO_MEANING_LAYER)
        return JudgingLadder(evaluators=evaluators, order=order)
    definition = DEFAULT_EVALUATOR_CATALOG[NLI_EVALUATOR_NAME]
    evaluators[NLI_EVALUATOR_NAME] = nli_entailment_evaluator(
        remembers_what_was_judged(asks, definition, memory)
    )
    order.append(NLI_EVALUATOR_NAME)
    return JudgingLadder(evaluators=evaluators, order=order)


__all__ = ["NO_MEANING_LAYER", "JudgingLadder", "judging_ladder"]
