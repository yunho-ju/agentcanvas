"""판정기 registry — 이름 하나로 돌릴 수 있는 판정기를 찾는 곳. 저비용 판정부터 얹는 사다리의 밑동.

층을 더하는 데 이 파일 밖의 코드를 고치지 않는다(OCP): 새 판정기는 자기 파일에서 Evaluator를
만들어 이름으로 얹히고, 돌리는 쪽(EvalBatchService)은 매핑을 받아 `evaluator_named`로 고른다.
아래 기본 매핑은 읽기만 하라고 Mapping으로 내놓는다 — 전역에 몰래 등록하는 뒷문을 두지 않는다.
"""

from __future__ import annotations

from collections.abc import Mapping

from .evaluator import Evaluator
from .expected_phrases import EXPECTED_PHRASES

#: 지금 서 있는 층 — 판정 비용이 0인 문구 확인 하나뿐이다.
DEFAULT_EVALUATORS: Mapping[str, Evaluator] = {
    evaluator.definition.name: evaluator for evaluator in [EXPECTED_PHRASES]
}


def evaluator_named(
    name: str, evaluators: Mapping[str, Evaluator] = DEFAULT_EVALUATORS
) -> Evaluator | None:
    """그 이름으로 돌릴 판정기를 골라 준다 — 못 찾으면 예외 대신 없다고 답한다.

    contracts의 resolve_evaluator는 사람에게 보여 줄 소개(EvaluatorDef)를 찾는 일이고,
    이쪽은 실제로 돌릴 판정 함수를 고르는 일이다 — 두 일을 같은 이름으로 부르지 않는다.
    """
    return evaluators.get(name)


__all__ = ["DEFAULT_EVALUATORS", "evaluator_named"]
