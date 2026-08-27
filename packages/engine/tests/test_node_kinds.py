"""노드 타입의 성격은 표가 말한다 — 길을 고르는 타입인가, 사람을 기다리는 타입인가.

실행기는 타입 이름을 알아보지 않는다: 새 타입이 생기면 표에 한 줄을 더할 뿐이고,
표에 없는 타입은 길도 고르지 않고 사람도 기다리지 않는다.
"""

from __future__ import annotations

import pytest
from agentcanvas_contracts.agent_spec import AgentSpec
from agentcanvas_contracts.run_events import EventType
from agentcanvas_engine.routed_runtime import KIND_BY_NODE_TYPE
from test_routed_runtime import a_node, a_run, a_spec, an_edge, kinds

KNOWN_TYPES = sorted(KIND_BY_NODE_TYPE)


def a_fork_led_by(node_type: str) -> AgentSpec:
    """가운데 노드가 그 타입인 갈림 그래프 — 뒤의 두 연결이 길 이름을 묻는다."""
    return a_spec(
        nodes=[
            a_node("input", "core.input"),
            a_node("middle", node_type),
            a_node("a-way"),
            a_node("b-way"),
        ],
        edges=[
            an_edge("in-middle", "input", "middle"),
            an_edge(
                "to-a",
                "middle",
                "a-way",
                source_port="route",
                expression="route == 'a'",
            ),
            an_edge(
                "to-b",
                "middle",
                "b-way",
                source_port="route",
                expression="route == 'b'",
            ),
        ],
    )


class TestTheTableSaysWhoPicksAWay:
    @pytest.mark.parametrize("node_type", KNOWN_TYPES)
    def test_a_decision_is_recorded_exactly_when_the_table_says_so(self, node_type):
        happened = kinds(a_run(a_fork_led_by(node_type)))

        assert (EventType.DECISION_RECORDED in happened) is (
            KIND_BY_NODE_TYPE[node_type].picks_a_way
        )


class TestTheTableSaysWhoWaitsForAPerson:
    @pytest.mark.parametrize("node_type", KNOWN_TYPES)
    def test_the_run_stops_for_a_person_exactly_when_the_table_says_so(self, node_type):
        happened = kinds(a_run(a_fork_led_by(node_type)))

        assert (EventType.RUN_PAUSED in happened) is (
            KIND_BY_NODE_TYPE[node_type].waits_for_person
        )


class TestATypeTheTableDoesNotKnow:
    def test_it_neither_picks_a_way_nor_waits_for_a_person(self):
        happened = kinds(a_run(a_fork_led_by("core.output")))

        assert EventType.DECISION_RECORDED not in happened
        assert EventType.RUN_PAUSED not in happened
