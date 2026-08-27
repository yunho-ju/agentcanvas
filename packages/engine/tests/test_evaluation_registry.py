"""판정기 registry — 이름으로 돌릴 판정기를 고르는 일 하나.

여기서 고정하는 것은 고르기까지다: 고른 판정기가 실제로 배치를 도는지(OCP)는
packages/api/tests/test_eval_service.py가 서비스에 판정기를 넘겨 증명한다.
"""

from __future__ import annotations

from agentcanvas_contracts.evaluator_catalog import EvaluatorDef
from agentcanvas_engine.evaluation.evaluator import Evaluator, Judgement
from agentcanvas_engine.evaluation.expected_phrases import EVALUATOR_NAME
from agentcanvas_engine.evaluation.registry import DEFAULT_EVALUATORS, evaluator_named


def a_stand_in(name: str) -> Evaluator:
    """이 시험 파일에만 있는 판정기 — 새 판정기가 자기를 소개하는 모양이기도 하다."""
    return Evaluator(
        definition=EvaluatorDef.model_validate(
            {
                "name": name,
                "version": "v9",
                "plain_description": {
                    "ko": "언제나 틀렸다고 해요",
                    "en": "Always says no",
                },
                "example": {"ko": "무슨 답이든 불통과예요", "en": "Any answer fails"},
            }
        ),
        judge=lambda expected_phrases, output_text: Judgement(
            passed=False, missing_phrases=list(expected_phrases)
        ),
    )


class TestEvaluatorNamed:
    """C1 — 이름으로 고르고, 없는 이름은 예외 대신 '없다'로 답한다."""

    def test_expected_phrases_is_in_the_default_registry(self):
        evaluator = evaluator_named(EVALUATOR_NAME)

        assert evaluator is not None
        assert evaluator.definition.name == EVALUATOR_NAME

    def test_unknown_name_answers_none_instead_of_raising(self):
        assert evaluator_named("아직 없는 판정기") is None

    def test_the_handed_in_mapping_is_the_one_that_is_looked_in(self):
        """돌리는 쪽이 건넨 매핑에서 고른다 — 기본 매핑을 몰래 고쳐 쓰지 않는다."""
        name = "언제나_불통과"

        assert evaluator_named(name) is None
        assert evaluator_named(name, {name: a_stand_in(name)}) is not None
        assert evaluator_named(EVALUATOR_NAME, DEFAULT_EVALUATORS) is not None
