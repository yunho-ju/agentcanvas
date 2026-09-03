"""모델에게 물어보는 일의 계약 — 무엇을 묻고, 무엇을 들었고, 못 들었으면 왜인가.

이 층에는 모델이 없다. 진짜로 말을 거는 일은 adapters의 몫이고, 여기 있는 것은 그 자리에
무엇이 오갈 수 있는지에 대한 약속뿐이다: 실패는 예외가 아니라 값으로 돌아온다 — 실행은
남의 사정으로 터지지 않고, 무슨 일이 있었는지 사건으로 남기고 끝맺는다.
"""

from __future__ import annotations

from collections.abc import Callable, Mapping
from dataclasses import dataclass
from typing import Literal

from agentcanvas_contracts.agent_spec import Node

from .fake_runtime import FAKE_ANSWER_TOKENS, FAKE_PROMPT_TOKENS
from .skill_wear import SkillBrief


@dataclass(frozen=True)
class ModelAsk:
    """노드 하나가 모델에게 묻는 것 — 무엇을 보고, (갈림길이면) 어느 길들 중에 고르는가.

    어느 모델에게 어떤 지시로 묻는지는 노드가 적어 둔 이름으로 온다: 그 이름을 실제 모델과
    실제 프롬프트로 푸는 일은 묻는 쪽(adapter)의 몫이다.
    """

    node: Node
    state: Mapping[str, object]
    ways: tuple[str, ...]
    model_ref: str
    prompt_ref: str
    #: 사람이 노드에 직접 적어 둔 지시문 — 있으면 이것이 모델이 읽을 말이다.
    instruction: str | None = None
    #: 답을 JSON Schema로 고정할 때 쓰는 provider-neutral 모양.
    response_schema: Mapping[str, object] | None = None
    #: provider가 structured response를 기록할 때 사용할 이름.
    response_name: str | None = None
    #: 이 노드가 입은 skill — 문서에서 푸는 일은 엔진이 끝냈다 (묻는 쪽은 spec을 뒤지지 않는다).
    skills: tuple[SkillBrief, ...] = ()


@dataclass(frozen=True)
class ModelEvidence:
    """비밀값 없이 실제 model call을 식별하는 부가 증거."""

    provider: str
    model_id: str
    request_id: str | None = None
    latency_ms: int | None = None
    provider_processing_ms: int | None = None


@dataclass(frozen=True)
class ModelSaid:
    """모델이 답한 것 — 고른 길, 남길 말, 실제로 보낸 프롬프트, 실측 토큰.

    말과 프롬프트는 들은 그대로일 때만 적는다(설계 §8 — 모델이 본 것은 반드시 기록된다).
    지어낼 말이 없는 대역은 그 자리를 비워 두고, 기록도 그만큼만 남는다.
    """

    input_tokens: int
    output_tokens: int
    way: str | None = None
    text: str | None = None
    prompt: str | None = None
    evidence: ModelEvidence | None = None


#: 모델에게 물어보지 못했거나 답을 받지 못한 까닭 — 없는 모델인가, 열쇠가 없는가, 저쪽 사정인가.
ModelTrouble = Literal["unknown_model", "missing_secret", "provider_error"]


@dataclass(frozen=True)
class ModelBalked:
    """물어보지 못했다는 답 — 예외가 아니라 값이라, 실행은 이유를 사건으로 남기고 끝맺는다."""

    reason: ModelTrouble
    message: str


#: 물음 하나에 답하는 것 — 진짜 모델이 꽂히는 자리다.
ModelCall = Callable[[ModelAsk], ModelSaid | ModelBalked]

#: 길만 고를 줄 아는 판단 (P3-1의 이름) — 이제는 모델 호출의 한 갈래다.
RouteAsk = ModelAsk
Judge = Callable[[RouteAsk], str]


def first_way(ask: RouteAsk) -> str:
    """언제나 첫 번째 길을 고르는 판단 — 진짜 모델이 없을 때의 결정론 기본값.

    고를 길이 없으면 아무도 묻지 않는다 — 판단 주체는 언제나 길이 있을 때만 불린다.
    """
    return ask.ways[0]


def judged_by(judge: Judge) -> ModelCall:
    """길만 고를 줄 아는 판단을 모델 호출로 감싼다 — 고를 길이 없으면 아무에게도 묻지 않는다.

    감싼 판단은 진짜 모델을 부르지 않았으므로 토큰도 지어낸 값 그대로다 (가짜 실행과 같은 숫자).
    """

    def asks(ask: ModelAsk) -> ModelSaid:
        return ModelSaid(
            input_tokens=FAKE_PROMPT_TOKENS,
            output_tokens=FAKE_ANSWER_TOKENS,
            way=judge(ask) if ask.ways else None,
        )

    return asks


#: 아무도 진짜 모델을 주입하지 않았을 때 묻는 곳 — 언제나 같은 답을 하는 결정론 대역.
says_the_first_way: ModelCall = judged_by(first_way)


__all__ = [
    "Judge",
    "ModelAsk",
    "ModelBalked",
    "ModelCall",
    "ModelEvidence",
    "ModelSaid",
    "ModelTrouble",
    "RouteAsk",
    "first_way",
    "judged_by",
    "says_the_first_way",
]
