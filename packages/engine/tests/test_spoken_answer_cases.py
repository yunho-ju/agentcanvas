"""실행이 낸 말 — studio(TS)의 `spokenTexts`와 같은 말을 골라내야 한다.

두 언어가 같은 케이스 파일(examples/spoken-answers/cases.json)을 읽어 같은 답을 낸다:
여기서는 `spoken_llm_texts`가, studio에서는 `spokenTexts`가 무엇을 고르는지 본다
(examples/spoken-answers/README.md).
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from agentcanvas_contracts.agent_spec import AgentSpec
from agentcanvas_contracts.run_events import RunEvent
from agentcanvas_engine.routed_runtime import spoken_llm_texts

CASES: list[dict] = json.loads(
    (
        Path(__file__).resolve().parents[3] / "examples/spoken-answers/cases.json"
    ).read_text(encoding="utf-8")
)


@pytest.mark.parametrize("case", CASES, ids=[case["name"] for case in CASES])
def test_the_shared_case_speaks_the_expected_words(case: dict):
    spec = AgentSpec.model_validate(case["spec"])
    events = [RunEvent.model_validate(one) for one in case["events"]]

    assert spoken_llm_texts(spec, events) == case["expected_spoken"]
