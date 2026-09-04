"""패턴 카탈로그 — 화면과 Architect가 말할 수 있는 모양들의 목록.

여기서 고정하는 것은 세 가지다: 사람이 읽는 세 문장이 두 언어로 있는가, 이 서버가 할 수
있는지 판정할 `needs`가 아는 능력 안에 있는가, 그리고 템플릿이 문서의 노드를 **앵커로만**
가리키는가(패턴이 남의 문서의 노드 이름을 지어내지 못한다).
"""

from __future__ import annotations

from typing import get_args

import pytest
from agentcanvas_contracts.patterns import (
    ANY_PORT,
    DEFAULT_PATTERNS,
    Capability,
    PatternDef,
    resolve_pattern,
)
from pydantic import ValidationError


def a_pattern(**changed: object) -> dict[str, object]:
    made: dict[str, object] = {
        "id": "made-up",
        "short_name": {"ko": "짧은 이름", "en": "Short name"},
        "question": {"ko": "물음", "en": "A question"},
        "applies_when": {"ko": "이럴 때", "en": "When this"},
        "cost": {"ko": "이런 대가", "en": "This cost"},
        "needs": ["router"],
        "template": [
            {"op": "replace_node_config", "node": "{agent}", "config": {"max_turns": 3}}
        ],
        "detects": "one_path_only",
    }
    made.update(changed)
    return made


class TestTheCatalogItself:
    def test_it_holds_the_three_shapes_this_product_can_talk_about(self):
        assert sorted(DEFAULT_PATTERNS) == ["human_gate", "react", "router"]

    @pytest.mark.parametrize("pattern_id", sorted(DEFAULT_PATTERNS))
    def test_every_entry_is_filed_under_its_own_id(self, pattern_id: str):
        assert DEFAULT_PATTERNS[pattern_id].id == pattern_id

    @pytest.mark.parametrize("pattern_id", sorted(DEFAULT_PATTERNS))
    def test_the_three_sentences_a_person_reads_speak_both_languages(self, pattern_id):
        pattern = DEFAULT_PATTERNS[pattern_id]

        for said in (pattern.question, pattern.applies_when, pattern.cost):
            assert said.ko.strip() and said.en.strip()

    @pytest.mark.parametrize("pattern_id", sorted(DEFAULT_PATTERNS))
    def test_what_a_pattern_needs_is_a_capability_this_product_knows(self, pattern_id):
        assert set(DEFAULT_PATTERNS[pattern_id].needs) <= set(get_args(Capability))

    @pytest.mark.parametrize("pattern_id", sorted(DEFAULT_PATTERNS))
    def test_every_entry_names_the_rule_that_spots_it_missing(self, pattern_id: str):
        assert DEFAULT_PATTERNS[pattern_id].detects.strip()

    def test_a_capability_this_product_does_not_know_is_refused(self):
        with pytest.raises(ValidationError):
            PatternDef.model_validate(a_pattern(needs=["telepathy"]))


class TestTemplatesPointAtAnchorsNotAtNames:
    def test_a_template_cannot_name_a_node_of_somebody_else_s_document(self):
        with pytest.raises(ValidationError):
            PatternDef.model_validate(
                a_pattern(
                    template=[
                        {
                            "op": "replace_node_config",
                            "node": "clinical-agent",
                            "config": {},
                        }
                    ]
                )
            )

    def test_a_template_can_place_a_node_of_its_own(self):
        pattern = PatternDef.model_validate(
            a_pattern(
                template=[
                    {
                        "op": "add_node",
                        "node": "{new:gate}",
                        "type": "control.human_gate",
                        "config": {},
                    }
                ]
            )
        )

        assert pattern.template[0].node == "{new:gate}"


class TestWhatEachShapeDoesToADocument:
    def test_looking_things_up_only_raises_how_many_turns_the_agent_takes(self):
        """도구를 붙이는 것은 사람의 몫이다 — 템플릿이 연결을 지어내지 않는다."""
        template = DEFAULT_PATTERNS["react"].template

        assert [op.model_dump() for op in template] == [
            {"op": "requires_tools", "node": "{agent}"},
            {
                "op": "replace_node_config",
                "node": "{agent}",
                "config": {"max_turns": 3},
            },
        ]

    def test_raising_the_turns_asks_first_that_the_agent_has_tools_to_use(self):
        """도구가 없는 에이전트에게 턴만 늘리면 못 쓰는 칸을 켜 두는 셈이다."""
        first = DEFAULT_PATTERNS["react"].template[0]

        assert (first.op, first.node) == ("requires_tools", "{agent}")

    def test_a_person_checking_first_sits_between_the_agent_and_the_answer(self):
        template = DEFAULT_PATTERNS["human_gate"].template
        done = [op.model_dump() for op in template]

        assert {"op": "add_node", "node": "{new:gate}"}.items() <= done[0].items()
        assert done[0]["type"] == "control.human_gate"
        assert {
            "op": "remove_edge",
            "source": "{agent}",
            "target": "{output}",
        } in done
        assert {
            "op": "add_edge",
            "kind": "approval",
            "source": {"node": "{agent}", "port": "response"},
            "target": {"node": "{new:gate}", "port": "review"},
        } in done
        assert {
            "op": "add_edge",
            "kind": "control",
            "source": {"node": "{new:gate}", "port": "approved"},
            "target": {"node": "{output}", "port": "input"},
        } in done

    def test_several_different_jobs_puts_a_fork_in_front_of_the_agent(self):
        done = [op.model_dump() for op in DEFAULT_PATTERNS["router"].template]

        assert done[0]["type"] == "llm.router"
        assert {
            "op": "add_edge",
            "kind": "data",
            "source": {"node": "{input}", "port": ANY_PORT},
            "target": {"node": "{new:router}", "port": "input"},
        } in done
        assert {
            "op": "add_edge",
            "kind": "control",
            "source": {"node": "{new:router}", "port": "route"},
            "target": {"node": "{agent}", "port": "messages"},
        } in done


class TestFindingOneByName:
    def test_it_finds_a_pattern_the_catalog_holds(self):
        assert resolve_pattern("react") is DEFAULT_PATTERNS["react"]

    @pytest.mark.parametrize("pattern_id", ["", "React", "supervisor", "  react  "])
    def test_it_says_nothing_rather_than_raising(self, pattern_id: str):
        assert resolve_pattern(pattern_id) is None
