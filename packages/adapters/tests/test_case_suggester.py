"""시험 케이스를 지어 주는 이 — 무엇을 읽고 물었는지, 무엇을 계약으로 받아들이는지."""

from __future__ import annotations

import json

from agentcanvas_adapters.anthropic_model import asks_anthropic
from agentcanvas_adapters.case_suggester import (
    CaseSuggestionRequest,
    CaseSuggestionsBalked,
    CaseSuggestionsSaid,
    case_suggester_from,
)
from agentcanvas_adapters.scripted import ScriptedLLM, ScriptedReply
from agentcanvas_contracts.agent_spec import AgentSpec, AgentStatus, Node, Position
from agentcanvas_contracts.model_catalog import ModelDef
from agentcanvas_engine.model_call import ModelAsk, ModelBalked, ModelSaid

INSTRUCTION_LABEL = "The instructions being tested (JSON):"
INPUT_LABEL = "The values a run is given (JSON):"
TITLE_LABEL = "Titles already written (JSON):"
EDGE_DEMAND = "push the edges"


def a_spec() -> AgentSpec:
    draft = AgentSpec(
        schema_version="agent.spec/v1",
        id="demo",
        name="Clinic helper",
        version=1,
        revision="sha256:" + "0" * 64,
        status=AgentStatus.DRAFT,
        input_schema={
            "type": "object",
            "properties": {"question": {"type": "string"}},
        },
        state_schema={"type": "object"},
        nodes=[
            Node(
                id="input",
                type="core.input",
                position=Position(x=0, y=0),
                config={"bindings": {"question": "input.question"}},
            ),
            Node(
                id="writer",
                type="llm.agent",
                position=Position(x=160, y=0),
                config={
                    "model_ref": "model://default",
                    "instruction": "환자에게 쉬운 말로 답해요",
                },
            ),
        ],
        edges=[],
        resources=[],
        execution=None,
    )
    return draft.model_copy(update={"revision": draft.computed_revision()})


def a_request(
    how_many: int = 3,
    include_edge_cases: bool = True,
    existing_titles: tuple[str, ...] = ("이미 지은 시험",),
) -> CaseSuggestionRequest:
    return CaseSuggestionRequest(
        spec=a_spec(),
        how_many=how_many,
        include_edge_cases=include_edge_cases,
        existing_titles=existing_titles,
        model_ref="model://suggester",
    )


def suggestion(title: str = "쉬운 질문에 답한다") -> dict:
    return {
        "title": title,
        "input": {"question": "머리가 아파요"},
        "expected_phrases": ["병원"],
    }


def answer_with(*cases: dict) -> str:
    return json.dumps({"cases": list(cases)})


def prompt_for(asked: CaseSuggestionRequest) -> str:
    """모델이 실제로 읽는 지시문 한 벌을 꺼낸다."""
    seen: list[ModelAsk] = []

    def model(ask: ModelAsk) -> ModelSaid:
        seen.append(ask)
        return ModelSaid(
            input_tokens=1, output_tokens=1, text=answer_with(suggestion())
        )

    case_suggester_from(model)(asked)
    return seen[0].instruction or ""


def json_block_after(prompt: str, label: str) -> dict | list:
    lines = prompt.splitlines()
    return json.loads(lines[lines.index(label) + 1])


def said_for(text: str, asked: CaseSuggestionRequest | None = None):
    def model(_ask: ModelAsk) -> ModelSaid:
        return ModelSaid(input_tokens=7, output_tokens=9, text=text)

    return case_suggester_from(model)(asked or a_request())


def test_valid_cases_come_back_as_contract_cases():
    said = said_for(answer_with(suggestion("첫 시험"), suggestion("둘째 시험")))

    assert isinstance(said, CaseSuggestionsSaid)
    assert [case.title for case in said.cases] == ["첫 시험", "둘째 시험"]
    assert said.cases[0].input == {"question": "머리가 아파요"}
    assert said.cases[0].expected_phrases == ["병원"]
    assert said.asked_for == 3


def test_a_suggestion_has_no_name_of_its_own():
    """이름(id)은 담는 사람이 붙인다 — 지어 온 것은 이름 없이 선다."""
    said = said_for(answer_with(suggestion("첫 시험")))

    assert isinstance(said, CaseSuggestionsSaid)
    assert not hasattr(said.cases[0], "id")


def test_only_the_cases_that_hold_up_come_back():
    said = said_for(
        answer_with(
            suggestion("멀쩡한 시험"),
            {"title": "", "input": {}, "expected_phrases": ["병원"]},
            {"title": "말이 없는 시험", "input": {}, "expected_phrases": []},
        )
    )

    assert isinstance(said, CaseSuggestionsSaid)
    assert [case.title for case in said.cases] == ["멀쩡한 시험"]
    assert said.asked_for == 3


def test_an_answer_that_is_not_json_balks():
    said = said_for("여기 시험 세 개를 지어 봤어요")

    assert isinstance(said, CaseSuggestionsBalked)
    assert said.reason == "invalid_cases"


def test_an_answer_with_no_usable_case_balks():
    said = said_for(answer_with({"title": "", "input": {}, "expected_phrases": []}))

    assert isinstance(said, CaseSuggestionsBalked)
    assert said.reason == "invalid_cases"


def test_a_provider_that_balks_is_carried_through_as_it_is():
    def model(_ask: ModelAsk) -> ModelBalked:
        return ModelBalked(reason="missing_secret", message="no key here")

    said = case_suggester_from(model)(a_request())

    assert isinstance(said, CaseSuggestionsBalked)
    assert said.reason == "missing_secret"


def test_the_prompt_carries_the_instructions_under_test():
    written = json_block_after(prompt_for(a_request()), INSTRUCTION_LABEL)

    assert written == [{"step": "writer", "instruction": "환자에게 쉬운 말로 답해요"}]


def spec_with_instructions(*written: str) -> AgentSpec:
    """지시문을 가질 수 있는 노드 여럿 — 적힌 말이 그대로 그 노드의 지시문이다."""
    base = a_spec()
    steps = [
        Node(
            id=f"writer-{at}",
            type="llm.agent",
            position=Position(x=160 * (at + 1), y=0),
            config={"model_ref": "model://default", "instruction": told},
        )
        for at, told in enumerate(written)
    ]
    draft = base.model_copy(update={"nodes": [base.nodes[0], *steps]})
    return draft.model_copy(update={"revision": draft.computed_revision()})


def test_a_step_with_nothing_written_is_left_out_of_the_prompt():
    """공백 한 칸은 적은 것이 아니다 — 빈 지시문을 모델에게 보내지 않는다(실행기와 같은 판정)."""
    asked = a_request()
    written = json_block_after(
        prompt_for(
            CaseSuggestionRequest(
                spec=spec_with_instructions("   ", "환자에게 쉬운 말로 답해요"),
                how_many=asked.how_many,
                include_edge_cases=asked.include_edge_cases,
                existing_titles=asked.existing_titles,
                model_ref=asked.model_ref,
            )
        ),
        INSTRUCTION_LABEL,
    )

    assert written == [{"step": "writer-1", "instruction": "환자에게 쉬운 말로 답해요"}]


def test_only_the_step_that_has_something_written_reaches_the_provider():
    client = ScriptedLLM([ScriptedReply(answer_with(suggestion()))])
    model = asks_anthropic(client, {"model://suggester": a_model("model://suggester")})

    case_suggester_from(model)(
        CaseSuggestionRequest(
            spec=spec_with_instructions("", "먼저 급한지 가려요"),
            how_many=3,
            include_edge_cases=True,
            existing_titles=(),
            model_ref="model://suggester",
        )
    )

    asked = str(client.requests[0])
    assert "먼저 급한지 가려요" in asked
    assert "writer-0" not in asked


def test_the_prompt_carries_the_values_a_run_is_given():
    values = json_block_after(prompt_for(a_request()), INPUT_LABEL)

    assert values == {"question": {"type": "string"}}


def test_the_prompt_carries_the_titles_already_written():
    titles = json_block_after(prompt_for(a_request()), TITLE_LABEL)

    assert titles == ["이미 지은 시험"]


def test_the_prompt_asks_for_the_number_the_person_chose_and_for_variety():
    prompt = prompt_for(a_request(how_many=5)).lower()

    assert "write 5 test cases" in prompt
    assert "vary" in prompt


def test_the_step_the_model_reads_is_the_suggester_itself():
    """묻는 자리는 그래프의 어느 노드도 아니다 — 노드가 하나도 없는 문서도 시험을 청할 수 있다."""
    seen: list[ModelAsk] = []

    def model(ask: ModelAsk) -> ModelSaid:
        seen.append(ask)
        return ModelSaid(
            input_tokens=1, output_tokens=1, text=answer_with(suggestion())
        )

    empty = a_spec().model_copy(update={"nodes": [], "edges": []})
    case_suggester_from(model)(
        CaseSuggestionRequest(
            spec=empty,
            how_many=1,
            include_edge_cases=True,
            existing_titles=(),
            model_ref="model://suggester",
        )
    )

    assert seen[0].node.id == "case-suggester"


def a_model(ref: str) -> ModelDef:
    return ModelDef(
        ref=ref,
        title={"ko": "시험 모델", "en": "Test model"},
        provider="anthropic",
        model_id="test-model",
    )


def what_the_provider_was_asked(include_edge_cases: bool) -> str:
    client = ScriptedLLM([ScriptedReply(answer_with(suggestion()))])
    model = asks_anthropic(client, {"model://suggester": a_model("model://suggester")})

    case_suggester_from(model)(a_request(include_edge_cases=include_edge_cases))

    return str(client.requests[0])


def test_asking_for_hard_cases_reaches_the_provider():
    assert EDGE_DEMAND in what_the_provider_was_asked(True)


def test_turning_hard_cases_off_takes_the_demand_out_of_what_the_provider_reads():
    assert EDGE_DEMAND not in what_the_provider_was_asked(False)
