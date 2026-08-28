"""심판 모델에게 함의를 묻는 자리 — 기존 ModelCall 하나를 판정 사다리의 마지막 단으로 세운다.

무엇을 읽고 답할지(프롬프트·답의 모양)는 여기서 짓는다(architect·case_suggester와 같은 결).
어느 provider인지는 여기서도 모른다: ModelCall이 그 갈림을 이미 삼켰다.

답은 엄격하게 읽는다: {"contained": true|false} 한 모양만 답으로 친다. 그 모양이 아니면
고쳐 읽지 않고 "담기지 않았다"로 센다 — 판정 층은 배치를 죽이지 않는다(EVAL-4와 같은 규율).
다만 조용히 삼키지도 않는다: 무슨 일이 있었는지 서버 로그가 말한다. 그리고 두 일을 한 말로
덮지 않는다 — 부르지 못한 일(열쇠·그물)과 답을 못 읽은 일(모양)은 고칠 곳이 서로 다르다.
"""

from __future__ import annotations

import logging

from agentcanvas_contracts.agent_spec import Node, Position
from agentcanvas_engine.evaluation.entailment import Entailment
from agentcanvas_engine.model_call import ModelAsk, ModelBalked, ModelCall, ModelSaid
from pydantic import BaseModel, ConfigDict, ValidationError

from .entailment import EntailmentCall

#: 심판을 세울 때 부르는 모델 — 사람이 고르는 이름(ref)이고, 누가 답하는지는 카탈로그가 안다.
JUDGE_MODEL_REF = "model://default"

#: 심판이 읽는 글의 이름표 — 이 판단을 나중에 다시 읽을 때 무엇으로 물었는지 가리킨다.
JUDGE_PROMPT_REF = "prompt://llm-judge@1"

#: 답의 모양에 붙이는 이름 — provider가 모양을 조일 때 쓴다.
JUDGE_SCHEMA_NAME = "llm_judge_verdict"

#: 답을 읽지 못했을 때 남기는 말 — 물어서 말은 들었으나 그것이 답이 아니었던 일.
UNREADABLE_VERDICT = (
    "the judge model did not answer in the shape this check asked for, so this"
    " phrase counts as not found"
)

#: 물어보지도 못했을 때 남기는 말 — 답의 모양이 아니라 그 자리를 여는 일이 어긋난 것이다.
COULD_NOT_ASK_THE_JUDGE = (
    "the judge model could not be asked at all, so this phrase counts as not"
    " found — check that this server can reach it"
)

_logger = logging.getLogger(__name__)


class JudgeVerdict(BaseModel):
    """심판의 답 한 벌 — 이 진술이 답에 담겼는가, 예 또는 아니오."""

    model_config = ConfigDict(extra="forbid")

    contained: bool


def judging_prompt(statement: str, body: str) -> str:
    """심판이 읽는 글 — 무엇을 판정하는지, 무엇을 답으로 쳐야 하는지, 그리고 진술과 답."""
    lines = [
        "You judge whether an answer already says a statement.",
        'Return JSON only: {"contained": true} or {"contained": false}.',
        "Say true when the answer says this statement, even in other words.",
        "Say false when the answer leaves it out, denies it, or only hints at it.",
        "The statement:",
        statement,
        "The answer:",
        body,
    ]
    return "\n".join(lines)


def _ask_for(statement: str, body: str, model_ref: str) -> ModelAsk:
    return ModelAsk(
        node=Node(
            id="llm-judge",
            type="llm.agent",
            position=Position(x=0, y=0),
            config={"model_ref": model_ref},
        ),
        state={},
        ways=(),
        model_ref=model_ref,
        prompt_ref=JUDGE_PROMPT_REF,
        instruction=judging_prompt(statement, body),
        response_schema=JudgeVerdict.model_json_schema(),
        response_name=JUDGE_SCHEMA_NAME,
    )


class _AskedJudge:
    """심판에게 묻는 자리 — 진짜 백엔드와 같은 모양(EntailmentCall)으로 선다."""

    def __init__(self, model: ModelCall, model_ref: str) -> None:
        #: 이 자리를 채운 것의 정체 — 판정을 기억해 두는 열쇠에 들어간다.
        self.model_ref = model_ref
        self._model = model

    def __call__(self, statement: str, body: str) -> Entailment:
        said = self._model(_ask_for(statement, body, self.model_ref))
        if isinstance(said, ModelBalked):
            return self._could_not_ask(said)
        if not isinstance(said, ModelSaid) or not said.text:
            return self._could_not_read(said)
        try:
            verdict = JudgeVerdict.model_validate_json(said.text)
        except ValidationError:
            return self._could_not_read(said)
        return Entailment(entailed=verdict.contained)

    def _could_not_ask(self, balked: ModelBalked) -> Entailment:
        """물어보지도 못한 일 — 고칠 곳은 답의 모양이 아니라 그 자리를 여는 일이다."""
        _logger.warning(
            "%s (judge %s, %s: %s)",
            COULD_NOT_ASK_THE_JUDGE,
            self.model_ref,
            balked.reason,
            balked.message,
        )
        return Entailment(entailed=False)

    def _could_not_read(self, said: object) -> Entailment:
        """물어서 말은 들었으나 답이 아니었던 일 — 고칠 곳은 답의 모양이다."""
        _logger.warning(
            "%s (judge %s said: %s)", UNREADABLE_VERDICT, self.model_ref, said
        )
        return Entailment(entailed=False)


def llm_judge_entailment(
    model: ModelCall | None, model_ref: str = JUDGE_MODEL_REF
) -> EntailmentCall | None:
    """물을 곳이 있으면 심판 자리를, 없으면 없음을 돌려준다 — 없음은 예외가 아니라 답이다."""
    return None if model is None else _AskedJudge(model, model_ref)


__all__ = [
    "COULD_NOT_ASK_THE_JUDGE",
    "JUDGE_MODEL_REF",
    "JUDGE_PROMPT_REF",
    "JUDGE_SCHEMA_NAME",
    "UNREADABLE_VERDICT",
    "JudgeVerdict",
    "judging_prompt",
    "llm_judge_entailment",
]
