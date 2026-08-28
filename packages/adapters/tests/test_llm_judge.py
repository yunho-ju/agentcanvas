"""심판 모델에게 묻는 자리 — 무엇을 보내고, 무엇을 답으로 받아들이는가.

이 시험은 어떤 모델도 실제로 부르지 않는다: 진짜 클라이언트가 설 자리에 결정론 대역
(ScriptedLLM)을 세우고, 진짜 provider 어댑터를 그대로 거쳐 왕복시킨다.
"""

from __future__ import annotations

import json
import logging

from agentcanvas_adapters.anthropic_model import asks_anthropic
from agentcanvas_adapters.llm_judge import (
    COULD_NOT_ASK_THE_JUDGE,
    JUDGE_MODEL_REF,
    UNREADABLE_VERDICT,
    llm_judge_entailment,
)
from agentcanvas_adapters.scripted import ScriptedLLM, ScriptedReply
from agentcanvas_engine.model_call import ModelAsk, ModelBalked, ModelSaid

STATEMENT = "반갑습니다"
ANSWER = "만나 뵈어 기뻐요"

LOGGER = "agentcanvas_adapters.llm_judge"


def judge_over(*replies: str):
    """대역이 이 말들을 차례로 하는 심판 하나 — 대역과 함께 돌려준다."""
    llm = ScriptedLLM([ScriptedReply(text=said) for said in replies])
    return llm_judge_entailment(asks_anthropic(llm)), llm


class TestAskingTheJudge:
    """C1 — 심판에게 보낸 청에는 판정할 진술과 그 답이 들어 있다."""

    def test_the_statement_and_the_answer_both_reach_the_model(self):
        judge, llm = judge_over(json.dumps({"contained": True}))

        answer = judge(STATEMENT, ANSWER)

        sent = json.dumps(llm.requests[0], ensure_ascii=False)
        assert STATEMENT in sent
        assert ANSWER in sent
        assert answer.entailed is True

    def test_a_judge_that_says_no_leaves_the_phrase_unrescued(self):
        judge, _ = judge_over(json.dumps({"contained": False}))

        assert judge(STATEMENT, ANSWER).entailed is False

    def test_the_judge_says_which_model_is_standing_in_it(self):
        """판정 기억의 열쇠가 모델 정체를 담으려면 이 자리가 자기 정체를 말해야 한다."""
        judge, _ = judge_over(json.dumps({"contained": True}))

        assert judge.model_ref == JUDGE_MODEL_REF

    def test_without_a_model_there_is_no_judge_to_stand(self):
        """물을 곳이 없으면 심판은 서지 않는다 — 없음은 예외가 아니라 답이다."""
        assert llm_judge_entailment(None) is None


class TestAnAnswerThatCannotBeRead:
    """C2 — 예/아니오로 읽히지 않는 답은 배치를 죽이지 않는다: 못 건짐 + 경고 한 줄."""

    def test_an_answer_that_is_not_yes_or_no_counts_as_not_entailed(self, caplog):
        judge, _ = judge_over("아마도요?")

        with caplog.at_level(logging.WARNING, logger=LOGGER):
            answer = judge(STATEMENT, ANSWER)

        assert answer.entailed is False
        assert UNREADABLE_VERDICT in caplog.text
        warnings = [
            record for record in caplog.records if record.levelno == logging.WARNING
        ]
        assert len(warnings) == 1

    def test_an_answer_shaped_like_something_else_counts_as_not_entailed(self, caplog):
        judge, _ = judge_over(json.dumps({"verdict": "yes"}))

        with caplog.at_level(logging.WARNING, logger=LOGGER):
            assert judge(STATEMENT, ANSWER).entailed is False

        assert UNREADABLE_VERDICT in caplog.text

    def test_a_model_that_balked_counts_as_not_entailed(self, caplog):
        """저쪽 사정으로 못 물었어도 판정은 계속 돈다 — 남은 말이 근거로 남을 뿐이다."""

        def balks(_ask: ModelAsk) -> ModelBalked:
            return ModelBalked(reason="missing_secret", message="this step needs a key")

        judge = llm_judge_entailment(balks)
        assert judge is not None

        with caplog.at_level(logging.WARNING, logger=LOGGER):
            assert judge(STATEMENT, ANSWER).entailed is False

        # 부르지 못한 일을 "모양을 못 읽었다"로 적으면 운영자가 파싱을 고치러 간다.
        assert COULD_NOT_ASK_THE_JUDGE in caplog.text
        assert "this step needs a key" in caplog.text
        assert UNREADABLE_VERDICT not in caplog.text

    def test_an_answer_with_no_words_counts_as_not_entailed(self, caplog):
        def says_nothing(_ask: ModelAsk) -> ModelSaid:
            return ModelSaid(input_tokens=1, output_tokens=1, text="")

        judge = llm_judge_entailment(says_nothing)
        assert judge is not None

        with caplog.at_level(logging.WARNING, logger=LOGGER):
            assert judge(STATEMENT, ANSWER).entailed is False

        # 말은 왔으나 답이 아니었다 — 부르지 못한 일과는 다른 사건이다.
        assert UNREADABLE_VERDICT in caplog.text
        assert COULD_NOT_ASK_THE_JUDGE not in caplog.text
