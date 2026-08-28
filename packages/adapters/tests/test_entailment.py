"""함의를 묻는 자리 — 진짜 모델이 설 곳과, 그 자리가 비었을 때의 정직한 강등.

이 시험은 모델을 내려받지 않는다: 무엇을 싣는 일은 밖에서 주입한 것이 하고, 여기서는
그 자리에 대역을 세운다. 진짜 경로는 "부를 수 있는가"까지만 본다.
"""

from __future__ import annotations

import logging

from agentcanvas_adapters.entailment import (
    MINICHECK_MODEL_REF,
    local_entailment,
)
from agentcanvas_adapters.scripted import ScriptedEntailment
from agentcanvas_engine.evaluation.entailment import Entailment


class TestScriptedEntailment:
    """C1 — 대역은 받은 (진술, 본문)을 기억하고 적어 둔 답을 차례로 한다."""

    def test_it_answers_in_order_and_remembers_what_it_was_asked(self):
        asks = ScriptedEntailment([True, False])

        first = asks("반갑습니다", "만나 뵈어 기뻐요")
        second = asks("감사합니다", "만나 뵈어 기뻐요")

        assert asks.asked == [
            ("반갑습니다", "만나 뵈어 기뻐요"),
            ("감사합니다", "만나 뵈어 기뻐요"),
        ]
        assert first == Entailment(entailed=True)
        assert second == Entailment(entailed=False)

    def test_the_stand_in_says_which_model_it_stands_in_for(self):
        """대역도 정체를 말한다 — 진짜와 같은 자리에 서려면 기억의 열쇠도 같은 모양이어야 한다."""
        assert ScriptedEntailment([]).model_ref == "scripted"
        assert ScriptedEntailment([], model_ref="some/model").model_ref == "some/model"


def breaking_predictor():
    """실린 뒤에 계속 어그러지는 모델 — 판정 한가운데서 예외를 던진다."""

    def breaks(statement: str, body: str) -> bool:
        raise RuntimeError("the model went away")

    return breaks


class TestLocalEntailment:
    """C2 — 실을 것이 없으면 예외가 아니라 '없음'이다."""

    def test_a_backend_that_cannot_be_imported_leaves_no_entailment_call(self):
        def cannot_import(model_ref: str):
            raise ImportError("no transformers here")

        assert local_entailment(loads=cannot_import) is None

    def test_a_backend_that_fails_to_load_for_any_reason_is_a_missing_one(self):
        """설치는 됐는데 가중치를 못 읽는 자리(캐시 없음·네트워크 없음)도 강등이다.

        고른 층이 본체를 죽이지 않는다 — 여기서 예외가 올라가면 서버가 아예 뜨지 않는다.
        """

        def cannot_read_the_weights(model_ref: str):
            raise OSError("we couldn't connect to huggingface.co")

        assert local_entailment(loads=cannot_read_the_weights) is None

    def test_a_backend_that_could_not_be_loaded_says_why_in_the_server_log(
        self, caplog
    ):
        def cannot_read_the_weights(model_ref: str):
            raise OSError("we couldn't connect to huggingface.co")

        with caplog.at_level(logging.WARNING, logger="agentcanvas_adapters.entailment"):
            local_entailment(loads=cannot_read_the_weights)

        assert MINICHECK_MODEL_REF in caplog.text
        assert "huggingface.co" in caplog.text

    def test_a_loaded_backend_answers_through_the_entailment_call(self):
        loaded: list[str] = []

        def loads(model_ref: str):
            loaded.append(model_ref)
            return lambda statement, body: statement in body

        asks = local_entailment(loads=loads)

        assert asks is not None
        assert loaded == [MINICHECK_MODEL_REF]
        assert asks("반갑습니다", "반갑습니다!") == Entailment(entailed=True)
        assert asks("감사합니다", "반갑습니다!") == Entailment(entailed=False)

    def test_a_backend_that_goes_wrong_answers_not_entailed_instead_of_raising(
        self, caplog
    ):
        """판정 한가운데서 배치를 무너뜨리지 않는다 — 못 건졌다는 답으로 돌아온다.

        다만 조용히 삼키지도 않는다: 사고를 말하지 않으면 뜻 층이 사실상 죽었는데도
        화면은 '뜻 검사가 봤는데 아니었다'로 읽는다.
        """
        with caplog.at_level(logging.WARNING, logger="agentcanvas_adapters.entailment"):
            asks = local_entailment(loads=lambda model_ref: breaking_predictor())

            assert asks is not None
            assert asks("반갑습니다", "반갑습니다!") == Entailment(entailed=False)

        assert "the model went away" in caplog.text

    def test_a_backend_that_keeps_going_wrong_does_not_flood_the_log(self, caplog):
        """되풀이되는 같은 사고는 한 번만 크게 말한다 — 로그를 밀어내지 않는다."""
        with caplog.at_level(logging.WARNING, logger="agentcanvas_adapters.entailment"):
            asks = local_entailment(loads=lambda model_ref: breaking_predictor())
            assert asks is not None
            asks("반갑습니다", "반갑습니다!")
            asks("감사합니다", "반갑습니다!")

        warnings = [
            record for record in caplog.records if record.levelno == logging.WARNING
        ]
        assert len(warnings) == 1

    def test_the_entailment_call_says_which_model_is_standing_in_it(self):
        """판정 기억의 열쇠가 모델 정체를 담으려면, 이 자리가 자기 정체를 말해야 한다."""
        asks = local_entailment(
            model_ref="some/other-model", loads=lambda model_ref: lambda s, b: True
        )

        assert asks is not None
        assert asks.model_ref == "some/other-model"


def test_the_real_backend_is_reachable_by_name_without_downloading_anything():
    """진짜 경로는 부를 수 있는 자리에 있다 — 여기서 모델을 내려받지는 않는다."""
    from agentcanvas_adapters import entailment

    assert callable(entailment.loads_a_minicheck_model)
