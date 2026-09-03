"""지시문 하나를 표준 SKILL.md 초안으로 옮기는 문 (SK-5) — 모델은 주입한다.

부를 모델이 없거나 저쪽이 답하지 못하면 실패가 아니라 **틀 초안**이다: 모르는 것을
지어내지 않고, 무엇으로 지었는지(drafted_by)를 사실대로 말한다.
"""

from __future__ import annotations

import pytest
from agentcanvas_api import skill_draft_service
from agentcanvas_api.app import GUIDED_MODEL_REF, create_app
from agentcanvas_api.memory_run_store import InMemoryRunStore
from agentcanvas_api.memory_store import InMemorySpecStore
from agentcanvas_contracts.skill_markdown import parse_skill_markdown
from agentcanvas_contracts.skill_scaffold import scaffold_skill
from agentcanvas_engine.model_call import (
    ModelAsk,
    ModelBalked,
    ModelSaid,
    says_the_first_way,
)
from fastapi.testclient import TestClient

INSTRUCTION = "Answer in short sentences and leave out jargon."
NAME = "plain-answer"
DESCRIPTION = "Use when you answer a person and the answer must be easy to read."

MODEL_DRAFT = (
    "---\n"
    "name: whatever-the-model-liked\n"
    "description: whatever the model wrote\n"
    "---\n"
    "\n"
    "# plain-answer\n"
    "\n"
    "One sentence of gist.\n"
    "\n"
    "## How to do it\n"
    "\n"
    "Answer in short sentences.\n"
)


def a_reference(name: str, description: str, body: str) -> dict:
    return {
        "ref": f"skill://{name}@1",
        "name": name,
        "description": description,
        "body": body,
        "license": None,
        "compatibility": None,
        "metadata": {},
        "references": [],
        "source": None,
    }


def a_client(model) -> TestClient:
    return TestClient(
        create_app(store=InMemorySpecStore(), run_store=InMemoryRunStore(), model=model)
    )


def answers(text: str | None):
    def model(_ask: ModelAsk) -> ModelSaid:
        return ModelSaid(input_tokens=3, output_tokens=9, text=text)

    return model


def draft_body(references: list[dict] | None = None) -> dict:
    return {
        "model_ref": GUIDED_MODEL_REF,
        "instruction": INSTRUCTION,
        "name": NAME,
        "description": DESCRIPTION,
        "references": references or [],
    }


def test_a_model_draft_comes_back_as_a_standard_skill():
    client = a_client(answers(MODEL_DRAFT))

    answer = client.post("/skills/draft", json=draft_body())

    assert answer.status_code == 200
    body = answer.json()
    assert body["drafted_by"] == "model"
    assert body["issues"] == []
    parsed = parse_skill_markdown(body["text"])
    assert parsed.skill is not None
    assert "One sentence of gist." in parsed.skill.body


def test_the_name_and_the_description_stay_the_ones_the_person_wrote():
    client = a_client(answers(MODEL_DRAFT))

    body = client.post("/skills/draft", json=draft_body()).json()

    parsed = parse_skill_markdown(body["text"])
    assert parsed.skill is not None
    assert parsed.skill.name == NAME
    assert parsed.skill.description == DESCRIPTION
    assert "whatever-the-model-liked" not in body["text"]


def test_the_model_reads_the_person_the_shape_and_the_closest_references():
    seen: list[ModelAsk] = []

    def model(ask: ModelAsk) -> ModelSaid:
        seen.append(ask)
        return ModelSaid(input_tokens=1, output_tokens=1, text=MODEL_DRAFT)

    client = a_client(model)

    client.post(
        "/skills/draft",
        json=draft_body(
            [
                a_reference(
                    "count-invoices",
                    "Rechnungen summieren.",
                    "Zahlen addieren.\n",
                ),
                a_reference(
                    "answer-plainly",
                    "Use when you answer a person and it must be easy to read.",
                    "Write short sentences.\n",
                ),
            ]
        ),
    )

    assert len(seen) == 1
    written = seen[0].instruction or ""
    assert INSTRUCTION in written
    assert NAME in written and DESCRIPTION in written
    # 참고는 비슷한 것부터다 — 겹치는 말이 없는 글은 예시로 실리지 않는다.
    assert "Write short sentences." in written
    assert "Zahlen addieren." not in written
    # 어떤 모양을 지어야 하는지 말해 준다 — 우리 파서가 읽는 그 모양이다.
    assert "How to do it" in written
    assert seen[0].prompt_ref == "prompt://skill-drafter@1"


def test_with_nobody_to_ask_the_scaffold_comes_back_and_says_so():
    client = a_client(says_the_first_way)

    body = client.post("/skills/draft", json=draft_body()).json()

    assert body["drafted_by"] == "scaffold"
    assert body["text"] == scaffold_skill(NAME, DESCRIPTION, INSTRUCTION)
    assert body["issues"] == ["skill.draft.nobodyToAsk"]


def test_a_provider_that_cannot_answer_falls_back_to_the_scaffold():
    client = a_client(
        lambda _ask: ModelBalked(reason="provider_error", message="upstream is down")
    )

    answer = client.post("/skills/draft", json=draft_body())

    assert answer.status_code == 200
    body = answer.json()
    assert body["drafted_by"] == "scaffold"
    assert body["text"] == scaffold_skill(NAME, DESCRIPTION, INSTRUCTION)
    assert body["issues"] == ["skill.draft.providerTrouble"]
    # 저쪽이 보낸 말은 화면으로 나가지 않는다.
    assert "upstream is down" not in answer.text


def test_a_draft_we_cannot_read_falls_back_to_the_scaffold_and_records_why():
    client = a_client(answers("Just some prose, no front matter at all.\n"))

    body = client.post("/skills/draft", json=draft_body()).json()

    assert body["drafted_by"] == "scaffold"
    assert body["text"] == scaffold_skill(NAME, DESCRIPTION, INSTRUCTION)
    assert body["issues"] == ["skill.frontmatter"]


def test_what_we_answer_can_always_be_read_back_even_with_an_awkward_description():
    """사람이 '- '로 시작하는 쓰임새를 적어도 우리가 쓴 글을 우리가 읽는다 (SK-5 리뷰 2)."""
    awkward = "- answer plainly, and say why: briefly"

    for model in (answers(MODEL_DRAFT), says_the_first_way):
        client = a_client(model)

        body = client.post(
            "/skills/draft", json={**draft_body(), "description": awkward}
        ).json()

        parsed = parse_skill_markdown(body["text"])
        assert parsed.skill is not None, body
        assert parsed.skill.description == awkward
        assert parsed.issues == []


def test_a_scaffold_we_cannot_read_is_our_bug_and_does_not_pass_as_an_answer(
    monkeypatch,
):
    """틀 초안은 언제나 읽혀야 한다 — 읽히지 않으면 조용히 내보내지 않고 부서진다."""
    monkeypatch.setattr(
        skill_draft_service, "scaffold_skill", lambda *_args: "not a skill at all\n"
    )
    client = a_client(says_the_first_way)

    with pytest.raises(ValueError, match="scaffold"):
        client.post("/skills/draft", json=draft_body())


def test_a_name_that_breaks_the_standard_is_refused_before_anyone_is_asked():
    asked: list[ModelAsk] = []

    def model(ask: ModelAsk) -> ModelSaid:
        asked.append(ask)
        return ModelSaid(input_tokens=1, output_tokens=1, text=MODEL_DRAFT)

    client = a_client(model)

    answer = client.post("/skills/draft", json={**draft_body(), "name": "Plain Answer"})

    assert answer.status_code == 422
    assert asked == []
