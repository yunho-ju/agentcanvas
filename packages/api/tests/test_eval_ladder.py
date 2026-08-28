"""서버가 세우는 판정 사다리 — 무엇이 설 수 있는지 보고, 설 수 있는 것만 얹는다.

뜻 검사를 실을 수 없는 서버에서는 사다리가 0층까지만 선다(조용히 짧아지되, 무엇이
빠졌는지는 사다리 자신이 말한다). 같은 물음을 두 번 묻지 않는 기억도 이 자리에서 얹힌다.
"""

from __future__ import annotations

import logging

from agentcanvas_adapters.scripted import ScriptedEntailment
from agentcanvas_api.entailment_memory import remembers_what_was_judged
from agentcanvas_api.eval_ladder import judging_ladder
from agentcanvas_contracts.evaluator_catalog import DEFAULT_EVALUATOR_CATALOG
from agentcanvas_engine.evaluation.entailment import Entailment
from agentcanvas_engine.evaluation.expected_phrases import EVALUATOR_NAME
from agentcanvas_engine.evaluation.llm_judge import LLM_JUDGE_EVALUATOR_NAME
from agentcanvas_engine.evaluation.nli_entailment import NLI_EVALUATOR_NAME

JUDGE_DEFINITION = DEFAULT_EVALUATOR_CATALOG[LLM_JUDGE_EVALUATOR_NAME]
NLI_DEFINITION = DEFAULT_EVALUATOR_CATALOG[NLI_EVALUATOR_NAME]


class TestJudgingLadder:
    """C6 — 있는 것만 얹는다: 함의를 물을 자리가 없으면 0층 사다리다."""

    def test_without_anything_to_ask_the_ladder_is_the_ground_floor_alone(self):
        ladder = judging_ladder(None)

        assert ladder.order == [EVALUATOR_NAME]
        assert NLI_EVALUATOR_NAME not in ladder.evaluators

    def test_a_ladder_that_stops_at_the_ground_floor_says_so_in_the_server_log(
        self, caplog
    ):
        """없음의 정직성 — 뜻 검사가 없는 서버는 조용하지 않다."""
        with caplog.at_level(logging.INFO, logger="agentcanvas_api.eval_ladder"):
            judging_ladder(None)

        assert "meaning check" in caplog.text

    def test_with_something_to_ask_the_meaning_layer_stands_above_the_ground_floor(
        self,
    ):
        ladder = judging_ladder(ScriptedEntailment([True]))

        assert ladder.order == [EVALUATOR_NAME, NLI_EVALUATOR_NAME]
        assert ladder.evaluators[NLI_EVALUATOR_NAME].definition == NLI_DEFINITION

    def test_the_meaning_layer_it_builds_does_not_ask_the_same_thing_twice(self):
        asks = ScriptedEntailment([True])
        ladder = judging_ladder(asks)
        judge = ladder.evaluators[NLI_EVALUATOR_NAME].judge

        assert judge(["반갑습니다"], "만나 뵈어 기뻐요").passed is True
        assert judge(["반갑습니다"], "만나 뵈어 기뻐요").passed is True
        assert asks.asked == [("반갑습니다", "만나 뵈어 기뻐요")]


class TestTheJudgingRung:
    """C8·C9 — 심판 단은 사다리 맨 위에 얹히고, 사람이 켰을 때의 차례에만 선다."""

    def test_the_judge_stands_above_every_cheaper_rung(self):
        ladder = judging_ladder(
            ScriptedEntailment([True]), judge=ScriptedEntailment([])
        )

        assert ladder.order == [EVALUATOR_NAME, NLI_EVALUATOR_NAME]
        assert ladder.order_with_judge == [
            EVALUATOR_NAME,
            NLI_EVALUATOR_NAME,
            LLM_JUDGE_EVALUATOR_NAME,
        ]
        assert ladder.evaluators[LLM_JUDGE_EVALUATOR_NAME].definition == (
            JUDGE_DEFINITION
        )

    def test_without_a_meaning_layer_the_judge_stands_straight_on_the_ground_floor(
        self,
    ):
        """사다리는 주입 목록 순서 그대로다 — 설치 안 된 층 자리를 비워 두지 않는다."""
        ladder = judging_ladder(None, judge=ScriptedEntailment([]))

        assert ladder.order_with_judge == [EVALUATOR_NAME, LLM_JUDGE_EVALUATOR_NAME]

    def test_a_server_with_no_judge_offers_the_same_ladder_either_way(self):
        ladder = judging_ladder(ScriptedEntailment([True]))

        assert ladder.order_with_judge == ladder.order
        assert LLM_JUDGE_EVALUATOR_NAME not in ladder.evaluators

    def test_a_ladder_with_no_judge_says_so_in_the_server_log(self, caplog):
        with caplog.at_level(logging.INFO, logger="agentcanvas_api.eval_ladder"):
            judging_ladder(None)

        assert "judge" in caplog.text

    def test_the_judge_it_builds_does_not_ask_the_same_thing_twice(self):
        """같은 (모델, 진술, 답)은 다시 묻지 않는다 — 값이 드는 층이라 더욱."""
        judge = ScriptedEntailment([True])
        ladder = judging_ladder(None, judge=judge)
        judging = ladder.evaluators[LLM_JUDGE_EVALUATOR_NAME].judge

        assert judging(["반갑습니다"], "만나 뵈어 기뻐요").passed is True
        assert judging(["반갑습니다"], "만나 뵈어 기뻐요").passed is True
        assert judge.asked == [("반갑습니다", "만나 뵈어 기뻐요")]


class TestRemembersWhatWasJudged:
    """C7·C8 — 기억의 열쇠는 (판정기 이름, 판, 진술, 답)이다."""

    def test_the_same_question_is_only_asked_once(self):
        asks = ScriptedEntailment([True])
        remembering = remembers_what_was_judged(asks, NLI_DEFINITION)

        assert remembering("반갑습니다", "기뻐요") == Entailment(entailed=True)
        assert remembering("반갑습니다", "기뻐요") == Entailment(entailed=True)
        assert asks.asked == [("반갑습니다", "기뻐요")]

    def test_a_different_answer_is_asked_about_again(self):
        asks = ScriptedEntailment([True, False])
        remembering = remembers_what_was_judged(asks, NLI_DEFINITION)

        assert remembering("반갑습니다", "기뻐요").entailed is True
        assert remembering("반갑습니다", "날씨가 좋네요").entailed is False
        assert len(asks.asked) == 2

    def test_the_memory_it_was_handed_is_the_one_it_writes_in(self):
        """기억은 밖에서 주입한다 — 무엇이 남았는지 시험이 직접 읽는다."""
        memory: dict = {}
        asks = ScriptedEntailment([True], model_ref="some/model")
        remembers_what_was_judged(asks, NLI_DEFINITION, memory)("반갑습니다", "기뻐요")

        assert memory == {
            (
                NLI_EVALUATOR_NAME,
                NLI_DEFINITION.version,
                "some/model",
                "반갑습니다",
                "기뻐요",
            ): Entailment(entailed=True)
        }

    def test_another_model_in_that_seat_does_not_inherit_the_old_answers(self):
        """모델 교체는 상수 하나로 된다 — 옛 모델의 판정이 새 모델의 것으로 읽히면 안 된다."""
        memory: dict = {}
        old = ScriptedEntailment([True], model_ref="old/model")
        new = ScriptedEntailment([False], model_ref="new/model")

        remembers_what_was_judged(old, NLI_DEFINITION, memory)("반갑습니다", "기뻐요")
        answer = remembers_what_was_judged(new, NLI_DEFINITION, memory)(
            "반갑습니다", "기뻐요"
        )

        assert answer.entailed is False
        assert new.asked == [("반갑습니다", "기뻐요")]

    def test_the_memory_does_not_grow_without_end(self):
        """열쇠에 답 전문이 들어가므로 상한이 없으면 서버가 계속 부푼다 — 오래된 것부터 잊는다."""
        asks = ScriptedEntailment([True, True, True, False])
        memory: dict = {}
        remembering = remembers_what_was_judged(asks, NLI_DEFINITION, memory, keeps=2)

        remembering("반갑습니다", "첫 답")
        remembering("반갑습니다", "둘째 답")
        remembering("반갑습니다", "셋째 답")

        assert len(memory) == 2
        # 가장 오래된 것(첫 답)은 잊혔으므로 다시 묻는다.
        assert remembering("반갑습니다", "첫 답").entailed is False
        assert len(asks.asked) == 4

    def test_a_new_version_of_the_evaluator_does_not_reuse_the_old_answers(self):
        memory: dict = {}
        old = NLI_DEFINITION
        new = NLI_DEFINITION.model_copy(update={"version": "v2"})
        asks = ScriptedEntailment([True, False])

        remembers_what_was_judged(asks, old, memory)("반갑습니다", "기뻐요")
        answer = remembers_what_was_judged(asks, new, memory)("반갑습니다", "기뻐요")

        assert answer.entailed is False
        assert len(asks.asked) == 2
