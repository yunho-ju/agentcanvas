"""입은 skill이 실제 모델 물음과 실행 기록에 닿는가 — 장식이 아니라는 증거.

문서가 가진 skill을 노드가 입은 순서대로 풀어 물음에 싣고, 그 걸음이 무엇을 따랐는지
사건에 남긴다. 없는 이름표는 건너뛰고, 본문이 예산을 넘으면 설명만 싣는다 —
어느 쪽도 실행을 세우지 않는다.
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime

from agentcanvas_contracts.agent_spec import AgentSpec, AgentStatus, Node, Position
from agentcanvas_contracts.run_events import EventType, RunEvent
from agentcanvas_engine.fake_runtime import fake_run
from agentcanvas_engine.model_call import ModelAsk, ModelSaid
from agentcanvas_engine.routed_runtime import routed_run
from agentcanvas_engine.skill_wear import (
    SKILL_BODY_BUDGET_CHARS,
    SkillBrief,
    skills_worn_by,
)

RUN_ID = "run_skills"
STARTED_AT = datetime(2026, 9, 3, 9, 0, tzinfo=UTC)
REVISION = "sha256:" + "0" * 64


def a_skill(name: str, body: str | None = None) -> dict[str, object]:
    return {
        "ref": f"skill://{name}@1",
        "name": name,
        "description": f"Use when {name} is what the answer needs.",
        "body": body if body is not None else f"Do what {name} asks.\n",
    }


def a_spec(skills: list[dict[str, object]], wears: list[str]) -> AgentSpec:
    return AgentSpec.model_validate(
        {
            "schema_version": "agent.spec/v1",
            "id": "wearing",
            "version": 1,
            "revision": REVISION,
            "status": AgentStatus.DRAFT,
            "input_schema": {"type": "object", "properties": {}},
            "state_schema": {"type": "object", "properties": {}},
            "nodes": [
                {
                    "id": "agent",
                    "type": "llm.agent",
                    "position": {"x": 0, "y": 0},
                    "config": {"model_ref": "model://default", "skill_refs": wears},
                }
            ],
            "edges": [],
            "skills": skills,
        }
    )


def the_agent(spec: AgentSpec) -> Node:
    return next(node for node in spec.nodes if node.id == "agent")


def a_node_of_no_type() -> Node:
    return Node(id="odd", type="core.output", position=Position(x=0, y=0), config={})


def refs_asked_for(events: list[RunEvent]) -> list[object]:
    return [
        event.payload.get("skill_refs")
        for event in events
        if event.event_type is EventType.LLM_REQUESTED
    ]


class TestWhatAStepWears:
    def test_it_wears_the_skills_it_names_in_the_order_it_named_them(self):
        spec = a_spec(
            [a_skill("cite-sources"), a_skill("plain-answer")],
            ["skill://plain-answer@1", "skill://cite-sources@1"],
        )

        worn = skills_worn_by(spec, the_agent(spec))

        assert worn.briefs == (
            SkillBrief(
                ref="skill://plain-answer@1",
                name="plain-answer",
                description="Use when plain-answer is what the answer needs.",
                body="Do what plain-answer asks.\n",
            ),
            SkillBrief(
                ref="skill://cite-sources@1",
                name="cite-sources",
                description="Use when cite-sources is what the answer needs.",
                body="Do what cite-sources asks.\n",
            ),
        )
        assert worn.missing == ()

    def test_a_name_the_document_does_not_have_is_missing_not_worn(self):
        spec = a_spec([a_skill("plain-answer")], ["skill://nowhere@1"])

        worn = skills_worn_by(spec, the_agent(spec))

        assert worn.briefs == ()
        assert worn.missing == ("skill://nowhere@1",)

    def test_a_step_that_cannot_wear_skills_wears_none(self):
        spec = a_spec([a_skill("plain-answer")], [])

        assert skills_worn_by(spec, a_node_of_no_type()).briefs == ()

    def test_bodies_past_the_budget_come_with_the_description_alone(self):
        big = "x" * (SKILL_BODY_BUDGET_CHARS - 10)
        spec = a_spec(
            [a_skill("first", big), a_skill("second")],
            ["skill://first@1", "skill://second@1"],
        )

        worn = skills_worn_by(spec, the_agent(spec))

        assert [brief.name for brief in worn.briefs] == ["first", "second"]
        assert worn.briefs[0].body == big
        assert worn.briefs[1].body is None

    def test_a_body_that_did_not_fit_is_named_so_somebody_can_say_it_out_loud(self):
        """설명만 실린 skill은 조용히 사라지지 않는다 — 누가 반쪽만 갔는지 이름이 남는다."""
        big = "x" * (SKILL_BODY_BUDGET_CHARS - 10)
        spec = a_spec(
            [a_skill("first", big), a_skill("second")],
            ["skill://first@1", "skill://second@1"],
        )

        worn = skills_worn_by(spec, the_agent(spec))

        assert worn.over_budget == ("skill://second@1",)

    def test_a_run_that_fits_its_budget_has_nothing_to_complain_about(self):
        spec = a_spec([a_skill("plain-answer")], ["skill://plain-answer@1"])

        assert skills_worn_by(spec, the_agent(spec)).over_budget == ()

    def test_the_same_skill_named_twice_is_worn_once(self):
        """같은 skill을 두 번 적어도 한 벌이다 — 본문도 예산도 기록도 한 번씩만 센다."""
        spec = a_spec(
            [a_skill("plain-answer")],
            ["skill://plain-answer@1", "skill://plain-answer@1"],
        )

        worn = skills_worn_by(spec, the_agent(spec))

        assert [brief.ref for brief in worn.briefs] == ["skill://plain-answer@1"]

    def test_a_missing_name_written_twice_is_only_one_complaint(self):
        spec = a_spec([], ["skill://nowhere@1", "skill://nowhere@1"])

        assert skills_worn_by(spec, the_agent(spec)).missing == ("skill://nowhere@1",)


class TestWhatTheModelIsAsked:
    def test_the_skills_a_step_wears_ride_along_with_the_question(self):
        spec = a_spec([a_skill("plain-answer")], ["skill://plain-answer@1"])
        asked: list[ModelAsk] = []

        def remembers(ask: ModelAsk) -> ModelSaid:
            asked.append(ask)
            return ModelSaid(input_tokens=1, output_tokens=1)

        routed_run(spec, run_id=RUN_ID, started_at=STARTED_AT, model=remembers)

        assert [brief.name for brief in asked[0].skills] == ["plain-answer"]

    def test_a_step_wearing_nothing_asks_with_no_skills(self):
        spec = a_spec([], [])
        asked: list[ModelAsk] = []

        def remembers(ask: ModelAsk) -> ModelSaid:
            asked.append(ask)
            return ModelSaid(input_tokens=1, output_tokens=1)

        routed_run(spec, run_id=RUN_ID, started_at=STARTED_AT, model=remembers)

        assert asked[0].skills == ()


class TestWhatTheRunRemembers:
    def test_the_run_says_which_skills_the_step_followed(self):
        spec = a_spec([a_skill("plain-answer")], ["skill://plain-answer@1"])

        assert refs_asked_for(
            routed_run(spec, run_id=RUN_ID, started_at=STARTED_AT)
        ) == [["skill://plain-answer@1"]]

    def test_a_pretend_run_says_the_very_same_thing(self):
        spec = a_spec([a_skill("plain-answer")], ["skill://plain-answer@1"])

        assert refs_asked_for(
            fake_run(spec, run_id=RUN_ID, started_at=STARTED_AT)
        ) == refs_asked_for(routed_run(spec, run_id=RUN_ID, started_at=STARTED_AT))

    def test_a_run_with_no_skills_keeps_the_record_it_always_kept(self):
        spec = a_spec([], [])

        assert refs_asked_for(
            routed_run(spec, run_id=RUN_ID, started_at=STARTED_AT)
        ) == [None]

    def test_the_same_skill_named_twice_is_written_down_once(self):
        spec = a_spec(
            [a_skill("plain-answer")],
            ["skill://plain-answer@1", "skill://plain-answer@1"],
        )

        assert refs_asked_for(
            routed_run(spec, run_id=RUN_ID, started_at=STARTED_AT)
        ) == [["skill://plain-answer@1"]]

    def test_a_body_that_did_not_fit_the_question_is_said_out_loud(self, caplog):
        """반쪽만 실린 skill도 사람이 알아야 한다 — 없는 이름표와 같은 자리에서 말한다."""
        big = "x" * (SKILL_BODY_BUDGET_CHARS - 10)
        spec = a_spec(
            [a_skill("first", big), a_skill("second")],
            ["skill://first@1", "skill://second@1"],
        )

        with caplog.at_level(logging.WARNING):
            events = routed_run(spec, run_id=RUN_ID, started_at=STARTED_AT)

        assert refs_asked_for(events) == [["skill://first@1", "skill://second@1"]]
        assert "skill://second@1" in caplog.text
        assert "skill://first@1" not in caplog.text

    def test_a_name_the_document_does_not_have_is_skipped_and_said_out_loud(
        self, caplog
    ):
        spec = a_spec([a_skill("plain-answer")], ["skill://nowhere@1"])

        with caplog.at_level(logging.WARNING):
            events = routed_run(spec, run_id=RUN_ID, started_at=STARTED_AT)

        assert refs_asked_for(events) == [None]
        assert kinds_of(events).count(EventType.RUN_COMPLETED) == 1
        assert "skill://nowhere@1" in caplog.text


def kinds_of(events: list[RunEvent]) -> list[EventType]:
    return [event.event_type for event in events]
