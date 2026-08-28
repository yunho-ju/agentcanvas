"""함의를 묻는 자리의 실제 백엔드 — 서버에 골라 설치하는 작은 판정 모델.

기본 모델: `lytang/MiniCheck-Flan-T5-Large` (MiniCheck, arXiv:2404.10774).
- 무엇: 문서(본문)가 어떤 진술을 뒷받침하는지 답하는 사실 확인용 소형 모델이다.
- 크기: Flan-T5-Large 계열 ~0.8B 파라미터 (가중치 약 3GB) — 첫 사용 때 내려받는다.
  torch 기본 인덱스는 CUDA 휠(수 GB)까지 끌고 온다. GPU가 없는 서버라면 CPU 전용 인덱스로
  받는다: `pip install --index-url https://download.pytorch.org/whl/cpu torch` 를 먼저 깔고
  `pip install 'agentcanvas-adapters[nli]'` 를 잇는다(uv라면 `--index-url` 같은 자리).
- 라이선스: 모델 가중치는 MIT, 바탕 Flan-T5는 Apache-2.0. 상용 사용에 걸림돌이 없다.
- 모델을 바꾸려면 아래 상수(또는 부르는 쪽의 인자) 하나만 바꾼다 — 부르는 쪽 코드는 그대로다.
  바뀐 정체는 이 자리(model_ref)가 말하므로, 옛 모델의 판정이 새 모델의 기억을 오염시키지 않는다.

설치는 선택이다(`agentcanvas-adapters[nli]`): 실을 수 없으면 — 꾸러미가 없든, 가중치를
읽지 못하든 — 여기서 예외를 내지 않고 "없음"으로 강등한다. 고른 층이 본체를 죽이지
않는다: 사다리는 0층까지만 서고 판정은 계속 돈다. 다만 조용히 지나가지 않는다(로그).
시험은 이 파일에서 모델을 내려받지 않는다: 무엇을 싣는 일은 주입한 것이 한다.
"""

from __future__ import annotations

import logging
from collections.abc import Callable
from typing import Protocol

from agentcanvas_engine.evaluation.entailment import Entailment

#: 기본으로 세우는 판정 모델 — 위 docstring에 크기·라이선스를 적어 둔 그 모델이다.
MINICHECK_MODEL_REF = "lytang/MiniCheck-Flan-T5-Large"

#: 실린 모델 한 벌 — (진술, 본문) → 본문이 그 진술을 뒷받침하는가.
Predicts = Callable[[str, str], bool]

#: 무엇을 싣는 일 — 실을 수 없으면 예외를 낸다(부르는 쪽이 예외 종류를 가리지 않고 강등으로 받는다).
Loads = Callable[[str], Predicts]

_logger = logging.getLogger(__name__)


class EntailmentCall(Protocol):
    """함의를 묻는 자리 — 진짜 백엔드도, 시험의 대역도 이 모양으로 선다."""

    #: 이 자리를 채운 것의 정체 — 판정을 기억해 두는 열쇠에 들어간다(모델이 바뀌면 기억도 갈린다).
    model_ref: str

    def __call__(self, statement: str, body: str) -> Entailment: ...


class _LoadedEntailment:
    """실린 모델에게 묻는 자리 — 사고는 답으로 바꾸되, 침묵으로 삼키지는 않는다.

    같은 사고가 되풀이되면 로그를 밀어내므로 크게 말하는 것은 처음 한 번이고,
    그 뒤는 자세히 보는 사람에게만(debug) 남긴다.
    """

    def __init__(self, model_ref: str, predicts: Predicts) -> None:
        self.model_ref = model_ref
        self._predicts = predicts
        self._already_said_it_went_wrong = False

    def __call__(self, statement: str, body: str) -> Entailment:
        try:
            return Entailment(entailed=self._predicts(statement, body))
        except Exception as went_wrong:  # noqa: BLE001 — 바깥 세상의 사고는 답으로 바꾼다.
            self._says_it_went_wrong(went_wrong)
            return Entailment(entailed=False)

    def _says_it_went_wrong(self, went_wrong: Exception) -> None:
        if self._already_said_it_went_wrong:
            _logger.debug(
                "the meaning check model %s went wrong again: %s",
                self.model_ref,
                went_wrong,
            )
            return
        self._already_said_it_went_wrong = True
        _logger.warning(
            "the meaning check model %s went wrong, so this round counts as"
            " not entailed: %s",
            self.model_ref,
            went_wrong,
        )


def loads_a_minicheck_model(model_ref: str) -> Predicts:
    """MiniCheck 한 벌을 싣는다 — transformers가 없으면 ImportError가 그대로 올라간다.

    이 함수는 시험에서 불리지 않는다(모델을 내려받는 자리다): 부를 수 있는 자리에
    있는지까지만 확인한다.
    """
    # 선택 설치라 모듈 맨 위가 아니라 부를 때 싣는다 — 없으면 ImportError가 강등의 신호다.
    from transformers import pipeline

    judge = pipeline("text2text-generation", model=model_ref)

    def predicts(statement: str, body: str) -> bool:
        said = judge(f"predict: {body}\nclaim: {statement}", max_new_tokens=4)
        return str(said[0]["generated_text"]).strip().startswith("1")

    return predicts


def local_entailment(
    model_ref: str = MINICHECK_MODEL_REF, loads: Loads = loads_a_minicheck_model
) -> EntailmentCall | None:
    """서버에 실을 수 있으면 함의를 묻는 자리를, 실을 수 없으면 없음을 돌려준다.

    실을 수 없는 까닭은 가리지 않는다: 꾸러미가 없어도(ImportError), 가중치를 읽지
    못해도(네트워크·캐시 없음 등) 똑같이 "없음"이다 — 고른 층 하나가 서버를 못 뜨게
    하지 않는다. 왜 없는지는 서버 로그가 말한다.
    실린 뒤에 그 모델이 어그러져도 예외를 판정 한가운데로 흘리지 않는다 — 못 건졌다는
    답으로 돌아온다(판정은 예외 대신 결과다).
    """
    try:
        predicts = loads(model_ref)
    except Exception as unavailable:  # noqa: BLE001 — 실을 수 없는 까닭은 가리지 않는다.
        _logger.warning(
            "the meaning check model %s could not be loaded, so only the wording"
            " check runs: %s",
            model_ref,
            unavailable,
        )
        return None

    return _LoadedEntailment(model_ref, predicts)


__all__ = [
    "MINICHECK_MODEL_REF",
    "EntailmentCall",
    "Loads",
    "Predicts",
    "loads_a_minicheck_model",
    "local_entailment",
]
