"""도구가 돌려준 것을 모델에게 넣기 전에 감싸는 규칙 (설계 AGENT_PATTERNS D9).

케이스 파일(examples/tool-result-fence/cases.json)이 규칙의 원본이다 — 화면·다른 언어가
같은 규칙을 쓰게 될 때 이 파일을 함께 읽는다 (examples/tool-result-fence/README.md).
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from agentcanvas_engine.tool_fence import MAX_TOOL_RESULT_CHARS, tool_result_fence

CASES: list[dict] = json.loads(
    (
        Path(__file__).resolve().parents[3] / "examples/tool-result-fence/cases.json"
    ).read_text(encoding="utf-8")
)


@pytest.mark.parametrize("case", CASES, ids=[case["name"] for case in CASES])
def test_the_shared_case_is_fenced_the_expected_way(case: dict):
    assert (
        tool_result_fence(
            case["text"],
            case["tool"],
            max_chars=case.get("max_chars", MAX_TOOL_RESULT_CHARS),
        )
        == case["expected"]
    )
