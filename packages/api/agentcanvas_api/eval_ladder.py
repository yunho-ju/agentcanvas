"""서버가 세우는 판정 사다리 — 이 서버에 실제로 설 수 있는 층만, 싼 것부터 얹는다.

0층(글자 확인)은 언제나 선다. 그 위의 뜻 확인은 서버에 골라 설치하는 것이라, 함의를
물을 자리가 없으면 사다리는 0층까지만 선다 — 판정은 계속 돌고, 다만 조용히 지나가지
않는다: 무엇이 빠졌는지 서버 로그가 말한다.

맨 위의 심판 단은 값이 드는 층이라 사람이 켰을 때만 딛는다: 그래서 사다리는 차례를 둘
들고 있다 — 늘 딛는 차례(order)와, 사람이 심판까지 청했을 때의 차례(order_with_judge).
심판을 세울 수 없는 서버에서는 둘이 같다(청해도 싼 층까지만 딛는다, 조용하지는 않게).

층을 더 얹는 일은 여기에 한 줄 얹는 일이다(무엇을 얹을지 정하는 자리) — 사다리를 딛는
규칙(engine)도, 배치를 도는 규칙(EvalBatchService)도 고치지 않는다.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass

from agentcanvas_adapters.entailment import EntailmentCall
from agentcanvas_contracts.evaluator_catalog import DEFAULT_EVALUATOR_CATALOG
from agentcanvas_engine.evaluation.entailment import AsksEntailment
from agentcanvas_engine.evaluation.evaluator import Evaluator
from agentcanvas_engine.evaluation.expected_phrases import EVALUATOR_NAME
from agentcanvas_engine.evaluation.llm_judge import (
    LLM_JUDGE_EVALUATOR_NAME,
    llm_judge_evaluator,
)
from agentcanvas_engine.evaluation.nli_entailment import (
    NLI_EVALUATOR_NAME,
    nli_entailment_evaluator,
)
from agentcanvas_engine.evaluation.registry import DEFAULT_EVALUATORS

from .entailment_memory import JudgementMemory, remembers_what_was_judged

_logger = logging.getLogger(__name__)

#: 심판을 세울 수 없는 서버가 남기는 말 — 켜 달라고 해도 싼 층까지만 딛는다는 사실 하나.
NO_JUDGE_LAYER = (
    "no model is set up to judge here, so asking for the judge rung still runs"
    " only the cheaper checks"
)

#: 뜻 검사가 없는 서버가 남기는 말 — 사람이 읽을 사실 하나, 속엣말은 없다.
NO_MEANING_LAYER = (
    "the meaning check (NLI) is not installed, so only the wording check runs"
    " — install agentcanvas-adapters[nli] to add it"
)


@dataclass(frozen=True)
class JudgingLadder:
    """세워진 사다리 — 무엇이 있고(evaluators), 늘 딛는 차례와 심판까지 청했을 때의 차례."""

    evaluators: dict[str, Evaluator]
    order: list[str]
    order_with_judge: list[str]


def judging_ladder(
    asks: EntailmentCall | None,
    memory: JudgementMemory | None = None,
    judge: EntailmentCall | None = None,
) -> JudgingLadder:
    """실을 수 있는 것만 얹은 사다리 — 묻는 층은 같은 물음을 두 번 묻지 않게 감싸서 얹는다."""
    evaluators = dict(DEFAULT_EVALUATORS)
    order = [EVALUATOR_NAME]
    if asks is None:
        _logger.info(NO_MEANING_LAYER)
    else:
        evaluators[NLI_EVALUATOR_NAME] = nli_entailment_evaluator(
            _asked_once(asks, NLI_EVALUATOR_NAME, memory)
        )
        order.append(NLI_EVALUATOR_NAME)
    if judge is None:
        _logger.info(NO_JUDGE_LAYER)
        return JudgingLadder(
            evaluators=evaluators, order=order, order_with_judge=list(order)
        )
    evaluators[LLM_JUDGE_EVALUATOR_NAME] = llm_judge_evaluator(
        _asked_once(judge, LLM_JUDGE_EVALUATOR_NAME, memory)
    )
    return JudgingLadder(
        evaluators=evaluators,
        order=order,
        order_with_judge=[*order, LLM_JUDGE_EVALUATOR_NAME],
    )


def layers_standing(ladder: JudgingLadder) -> dict[str, bool]:
    """카탈로그의 층마다 '이 서버에서 서는가' — 세워 둔 사다리 하나가 그 판단의 원천이다.

    판단을 다시 하지 않는다: 심판을 세울 수 있는지·뜻 검사가 실렸는지는 사다리를 세울 때 이미
    한 번 정해졌고, 여기서 또 정하면 화면이 말하는 것과 배치가 딛는 것이 갈린다.
    """
    standing = set(ladder.order_with_judge)
    return {name: name in standing for name in DEFAULT_EVALUATOR_CATALOG}


def _asked_once(
    asks: EntailmentCall, evaluator_name: str, memory: JudgementMemory | None
) -> AsksEntailment:
    """같은 물음을 두 번 묻지 않게 감싼다 — 어느 층의 물음인지가 기억의 열쇠에 들어간다."""
    return remembers_what_was_judged(
        asks, DEFAULT_EVALUATOR_CATALOG[evaluator_name], memory
    )


__all__ = [
    "NO_JUDGE_LAYER",
    "NO_MEANING_LAYER",
    "JudgingLadder",
    "judging_ladder",
    "layers_standing",
]
