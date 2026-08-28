"""이미 내린 함의 판정을 기억해 두는 자리 — 같은 물음을 두 번 묻지 않는다.

윗층 판정은 값이 싸지 않다(작은 모델이라도 한 번은 돌아간다). 같은 판정기의 같은 판이,
같은 모델을 세운 채로, 같은 (진술, 답)을 다시 만나면 답은 같으므로 기억해 둔 답을 그대로
쓴다. 판이 올라가거나 모델이 바뀌면 열쇠가 달라져 옛 판정이 새것을 오염시키지 않는다.

열쇠에 답 전문이 들어가므로 기억은 그냥 두면 끝없이 부푼다: 상한을 두고 오래된 것부터
잊는다(가장 오래 안 쓴 것이 아니라 가장 오래 들어온 것 — 규칙은 단순한 쪽으로).
기억은 밖에서 주입한다: v1의 기본은 이 프로세스 안의 사전 하나이고(서버가 다시 뜨면
잊는다 — 알려진 한계), 영속 기억이 필요해지면 같은 자리에 다른 것을 꽂는다.
"""

from __future__ import annotations

from collections.abc import MutableMapping

from agentcanvas_adapters.entailment import EntailmentCall
from agentcanvas_contracts.evaluator_catalog import EvaluatorDef
from agentcanvas_engine.evaluation.entailment import AsksEntailment, Entailment

#: 기억의 열쇠 — 어느 판정기의 어느 판이, 어느 모델을 세운 채로, 무슨 진술을, 어느 답에 대고 물었는가.
JudgementKey = tuple[str, str, str, str, str]

#: 기억 그 자체 — 사전이면 프로세스 안, 다른 것을 꽂으면 다른 곳에 남는다.
JudgementMemory = MutableMapping[JudgementKey, Entailment]

#: 기억해 둘 판정의 수 — 넘치면 가장 오래 들어온 것부터 잊는다.
REMEMBERS_AT_MOST = 5000


def remembers_what_was_judged(
    asks: EntailmentCall,
    evaluator: EvaluatorDef,
    memory: JudgementMemory | None = None,
    keeps: int = REMEMBERS_AT_MOST,
) -> AsksEntailment:
    """같은 물음이면 기억해 둔 답을, 처음 보는 물음이면 물어서 답하고 기억해 둔다."""
    remembered: JudgementMemory = {} if memory is None else memory

    def asks_once(statement: str, body: str) -> Entailment:
        key: JudgementKey = (
            evaluator.name,
            evaluator.version,
            asks.model_ref,
            statement,
            body,
        )
        answer = remembered.get(key)
        if answer is None:
            answer = asks(statement, body)
            _forgets_the_oldest_if_full(remembered, keeps)
            remembered[key] = answer
        return answer

    return asks_once


def _forgets_the_oldest_if_full(remembered: JudgementMemory, keeps: int) -> None:
    """자리를 하나 비운다 — 사전은 들어온 차례를 지키므로 맨 앞이 가장 오래된 것이다."""
    while len(remembered) >= keeps:
        del remembered[next(iter(remembered))]


__all__ = [
    "REMEMBERS_AT_MOST",
    "JudgementKey",
    "JudgementMemory",
    "remembers_what_was_judged",
]
