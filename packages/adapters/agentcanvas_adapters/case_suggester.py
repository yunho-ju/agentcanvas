"""Provider-neutral 시험 케이스 제안 adapter — 그래프를 읽어 묻고, 답을 계약으로 옮긴다.

architect.py와 같은 결이다: 모델이 무엇을 읽을지는 여기서 짓고, 돌아온 말은 계약(EvalCase)으로
검증해서만 통과시킨다. 계약에 닿지 못한 것은 조용히 고쳐 쓰지 않고 그 자리에서 버린다.
"""

from __future__ import annotations

import json
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any, Literal

from agentcanvas_contracts.agent_spec import AgentSpec, Node, Position
from agentcanvas_contracts.eval_case import EvalCase
from agentcanvas_contracts.node_registry import (
    DEFAULT_NODE_TYPES,
    INPUT_NODE_TYPE,
    NodeType,
)
from agentcanvas_engine.model_call import (
    ModelAsk,
    ModelBalked,
    ModelCall,
    ModelEvidence,
    ModelSaid,
)
from pydantic import BaseModel, ConfigDict, Field, ValidationError

CASE_SUGGESTION_SCHEMA_NAME = "eval_case_suggestions"
CASE_SUGGESTION_PROMPT_REF = "prompt://case-suggester@1"
INVALID_CASES_MESSAGE = "the model returned no test case that matches eval.case/v1"

#: 계약(EvalCase)이 요구하는 이름 자리를 채우는 임시 값 — 검증 안에서만 살고 밖으로 나가지 않는다.
_NAME_FOR_VALIDATION = "suggested"

type CaseSuggestionTrouble = Literal[
    "unknown_model", "missing_secret", "provider_error", "invalid_cases"
]


class SuggestedCase(BaseModel):
    """모델이 지어 온 케이스 한 벌 — 무엇을 넣고, 무슨 말이 들어있어야 하는가.

    id도 횟수도 모델의 것이 아니다: 이름은 담는 사람이, 횟수는 케이스 폼이 정한다.
    """

    model_config = ConfigDict(extra="forbid")

    title: str
    input: dict[str, Any] = Field(default_factory=dict)
    expected_phrases: list[str] = Field(default_factory=list)


class SuggestedCases(BaseModel):
    """모델이 한 번에 지어 오는 것 — 케이스 목록 하나."""

    model_config = ConfigDict(extra="forbid")

    cases: list[SuggestedCase] = Field(default_factory=list)


@dataclass(frozen=True)
class CaseSuggestionRequest:
    spec: AgentSpec
    how_many: int
    include_edge_cases: bool
    existing_titles: tuple[str, ...]
    model_ref: str
    prompt_ref: str = CASE_SUGGESTION_PROMPT_REF


@dataclass(frozen=True)
class CaseSuggestionsSaid:
    """계약에 닿은 제안들 — 몇 개를 청했는지도 함께 들고 있다(화면이 사실대로 말한다)."""

    cases: tuple[SuggestedCase, ...]
    asked_for: int
    input_tokens: int
    output_tokens: int
    prompt: str | None = None
    evidence: ModelEvidence | None = None


@dataclass(frozen=True)
class CaseSuggestionsBalked:
    reason: CaseSuggestionTrouble
    message: str


type CaseSuggesterCall = Callable[
    [CaseSuggestionRequest], CaseSuggestionsSaid | CaseSuggestionsBalked
]


def _as_json(value: object) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True)


def _schema_takes_an_instruction(node_type: NodeType) -> bool:
    """이 노드 타입이 지시문을 가질 수 있는가 — registry의 config_schema가 답한다(타입 이름이 아니라)."""
    properties = node_type.config_schema.get("properties")
    return isinstance(properties, dict) and "instruction" in properties


def written_instruction(node: Node) -> str | None:
    """이 노드에 적힌 지시문 — 공백 한 칸은 적은 것이 아니다 (실행기와 같은 판정).

    지시문을 가질 수 있는 자리인지는 registry가 답하고(타입 이름이 아니라), 적혔는지는 여기서 본다.
    """
    node_type = DEFAULT_NODE_TYPES.get(node.type)
    if node_type is None or not _schema_takes_an_instruction(node_type):
        return None
    told = node.config.get("instruction")
    return told if isinstance(told, str) and told.strip() else None


def _instructions_under_test(spec: AgentSpec) -> list[dict[str, str]]:
    """지금 시험받는 지시문들 — 아직 아무 말도 적지 않은 자리는 보내지 않는다(빈 말은 소음이다)."""
    return [
        {"step": node.id, "instruction": told}
        for node in spec.nodes
        if (told := written_instruction(node)) is not None
    ]


def _bound_names(node: Node) -> list[str]:
    bindings = node.config.get("bindings")
    if not isinstance(bindings, dict):
        return []
    return [name for name in bindings if isinstance(name, str) and name.strip()]


def _values_a_run_is_given(spec: AgentSpec) -> dict[str, object]:
    """실행이 받는 값들 — 입력 노드가 받기로 한 이름과 문서가 적어 둔 형식 (run-input-card와 같은 원천)."""
    properties = spec.input_schema.get("properties")
    properties = properties if isinstance(properties, dict) else {}
    values: dict[str, object] = {}
    for node in spec.nodes:
        if node.type != INPUT_NODE_TYPE:
            continue
        for name in _bound_names(node):
            written = properties.get(name)
            values[name] = written if isinstance(written, dict) else {"type": "string"}
    return values


def _suggestion_prompt(asked: CaseSuggestionRequest) -> str:
    """모델에게 보내는 입력 — 그래프가 무엇을 하기로 했는지 읽고 시험을 짓게 한다."""
    lines = [
        "You write test cases for an agent graph.",
        "Return JSON only. Do not return markdown, prose, or executable code.",
        (
            f"Write {asked.how_many} test cases as "
            '{"cases": [{"title": ..., "input": ..., "expected_phrases": [...]}]}.'
        ),
        "A title is a short plain sentence saying what the case checks.",
        "An input only uses the value names listed below, with values a person could type.",
        (
            "Expected phrases are short words the answer must contain, taken from what "
            "the instructions promise. Do not ask for words the instructions never "
            "mention."
        ),
        (
            "Vary the difficulty and the situation: mix easy, ordinary, and demanding "
            "cases, and do not write the same case twice."
        ),
    ]
    if asked.include_edge_cases:
        lines.append(
            "Include cases that push the edges: missing or odd values, and requests the "
            "instructions do not cover."
        )
    lines.extend(
        [
            "Write every case differently from the titles already written.",
            "The instructions being tested (JSON):",
            _as_json(_instructions_under_test(asked.spec)),
            "The values a run is given (JSON):",
            _as_json(_values_a_run_is_given(asked.spec)),
            "Titles already written (JSON):",
            _as_json(list(asked.existing_titles)),
        ]
    )
    return "\n".join(lines)


def _ask_for(asked: CaseSuggestionRequest) -> ModelAsk:
    return ModelAsk(
        node=Node(
            id="case-suggester",
            type="llm.agent",
            position=Position(x=0, y=0),
            config={"model_ref": asked.model_ref},
        ),
        state={},
        ways=(),
        model_ref=asked.model_ref,
        prompt_ref=asked.prompt_ref,
        instruction=_suggestion_prompt(asked),
        response_schema=SuggestedCases.model_json_schema(),
        response_name=CASE_SUGGESTION_SCHEMA_NAME,
    )


def _invalid_cases() -> CaseSuggestionsBalked:
    return CaseSuggestionsBalked(reason="invalid_cases", message=INVALID_CASES_MESSAGE)


def _holds_up_as_a_case(suggested: SuggestedCase) -> bool:
    """이 제안이 계약(EvalCase)이 될 수 있는가 — 이름만 빼고 계약이 직접 판정한다.

    이름은 담는 사람이 붙이므로 판정할 때만 자리를 채운다: 그 이름은 이 함수 밖으로 나가지 않는다.
    """
    try:
        EvalCase.model_validate(
            {"id": _NAME_FOR_VALIDATION, **suggested.model_dump()},
        )
    except ValidationError:
        return False
    return True


def _cases_that_hold_up(written: str) -> list[SuggestedCase]:
    """계약에 닿은 케이스만 골라 낸다 — 닿지 못한 것은 고쳐 쓰지 않고 버린다."""
    try:
        envelope = json.loads(written)
    except (json.JSONDecodeError, TypeError):
        return []
    if not isinstance(envelope, dict) or not isinstance(envelope.get("cases"), list):
        return []
    kept: list[SuggestedCase] = []
    for offered in envelope["cases"]:
        try:
            suggested = SuggestedCase.model_validate(offered)
        except ValidationError:
            continue
        if _holds_up_as_a_case(suggested):
            kept.append(suggested)
    return kept


def case_suggester_from(model: ModelCall) -> CaseSuggesterCall:
    """기존 ModelCall을 시험 케이스 제안 자리로 감싼다."""

    def asks(
        asked: CaseSuggestionRequest,
    ) -> CaseSuggestionsSaid | CaseSuggestionsBalked:
        said = model(_ask_for(asked))
        if isinstance(said, ModelBalked):
            return CaseSuggestionsBalked(reason=said.reason, message=said.message)
        if not isinstance(said, ModelSaid) or not said.text:
            return _invalid_cases()
        kept = _cases_that_hold_up(said.text)
        if not kept:
            return _invalid_cases()
        return CaseSuggestionsSaid(
            cases=tuple(kept),
            asked_for=asked.how_many,
            input_tokens=said.input_tokens,
            output_tokens=said.output_tokens,
            prompt=said.prompt,
            evidence=said.evidence,
        )

    return asks


__all__ = [
    "CASE_SUGGESTION_PROMPT_REF",
    "CASE_SUGGESTION_SCHEMA_NAME",
    "CaseSuggesterCall",
    "CaseSuggestionRequest",
    "CaseSuggestionTrouble",
    "CaseSuggestionsBalked",
    "CaseSuggestionsSaid",
    "SuggestedCase",
    "SuggestedCases",
    "case_suggester_from",
]
