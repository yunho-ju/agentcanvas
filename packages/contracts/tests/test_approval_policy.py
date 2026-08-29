"""승인 정책 — 연결이 도구를 부르기 전에 사람에게 물어보는가.

자유 문자열이던 자리를 두 값만 갖는 Enum으로 좁힌다. 좁혀도 기존 저장 spec의
`"read_only_auto"`는 그대로 유효해야 하고, 글자가 같으니 revision도 흔들리지 않는다.
"""

from __future__ import annotations

import pytest
from agentcanvas_contracts.agent_spec import (
    ApprovalPolicy,
    ResourceBinding,
    coerce_known_policies,
)
from agentcanvas_contracts.revision import compute_revision
from pydantic import ValidationError


def binding_dict(**overrides) -> dict:
    return {
        "id": "article-api",
        "kind": "http.api",
        "server_ref": "api://article-api",
        "allowed_tools": [],
        "approval_policy": "read_only_auto",
        **overrides,
    }


def test_the_two_values_are_the_only_ones_allowed():
    for value in ("read_only_auto", "ask_first"):
        binding = ResourceBinding.model_validate(binding_dict(approval_policy=value))
        assert binding.approval_policy == ApprovalPolicy(value)


def test_a_value_outside_the_domain_is_refused_on_save():
    with pytest.raises(ValidationError) as exc:
        ResourceBinding.model_validate(binding_dict(approval_policy="whenever"))
    assert exc.value.errors()[0]["loc"] == ("approval_policy",)


def test_the_old_only_value_stays_a_plain_string_in_the_canonical_dump():
    """계약이 좁아져도 canonical 직렬화가 같은 글자다 — revision을 흔들지 않는다."""
    binding = ResourceBinding.model_validate(
        binding_dict(approval_policy="read_only_auto")
    )
    dumped = binding.model_dump(mode="json")

    assert dumped["approval_policy"] == "read_only_auto"
    # 그 dump를 다시 읽어도 같은 canonical이 나온다 — Enum이 문자열 자리를 그대로 채운다.
    assert compute_revision(dumped) == compute_revision(
        ResourceBinding.model_validate(dumped).model_dump(mode="json")
    )


def test_a_binding_that_omits_the_policy_defaults_to_reading_only():
    raw = binding_dict()
    raw.pop("approval_policy")

    assert ResourceBinding.model_validate(raw).approval_policy == (
        ApprovalPolicy.READ_ONLY_AUTO
    )


def test_the_load_path_heals_an_unknown_policy_but_leaves_the_rest():
    """옛 저장 spec을 관대히 읽는다 — 낯선 정책만 기본값으로 되돌리고 나머지는 그대로."""
    raw = {
        "resources": [
            binding_dict(id="a", approval_policy="from_the_future"),
            binding_dict(id="b", approval_policy="ask_first"),
        ]
    }

    healed = coerce_known_policies(raw)

    assert healed["resources"][0]["approval_policy"] == "read_only_auto"
    assert healed["resources"][1]["approval_policy"] == "ask_first"


def test_the_load_path_leaves_an_omitted_policy_to_the_default():
    raw = {"resources": [{"id": "a", "kind": "http.api"}]}

    healed = coerce_known_policies(raw)

    assert "approval_policy" not in healed["resources"][0]
