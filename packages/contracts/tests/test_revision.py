import pytest
from agentcanvas_contracts.revision import canonical_json, compute_revision


def test_canonical_json_sorts_keys_and_drops_whitespace():
    assert (
        canonical_json({"b": 1, "a": {"d": 2, "c": 3}}) == '{"a":{"c":3,"d":2},"b":1}'
    )


def test_canonical_json_excludes_revision_field():
    assert canonical_json({"id": "x", "revision": "sha256:whatever"}) == '{"id":"x"}'


def test_canonical_json_is_utf8_literal():
    assert canonical_json({"name": "환자"}) == '{"name":"환자"}'


def test_canonical_json_omits_an_empty_additive_field():
    """빈 skills는 없는 것과 같다 — 필드가 나중에 생겨도 저장된 문서의 revision은 그대로다."""
    assert canonical_json({"id": "agent", "skills": []}) == '{"id":"agent"}'


def test_canonical_json_keeps_an_additive_field_that_holds_something():
    """skill을 하나라도 입으면 다른 문서다 — 생략은 비어 있을 때만이다."""
    assert canonical_json({"id": "agent", "skills": [{"name": "plain-answer"}]}) == (
        '{"id":"agent","skills":[{"name":"plain-answer"}]}'
    )


def test_canonical_json_keeps_other_empty_lists():
    """생략 규칙은 나중에 생긴 필드에만 있다 — 처음부터 있던 빈 목록은 문서의 일부다."""
    assert canonical_json({"id": "agent", "nodes": []}) == '{"id":"agent","nodes":[]}'


def test_compute_revision_is_deterministic():
    content = {"id": "agent", "nodes": [{"id": "input"}]}
    assert compute_revision(content) == compute_revision(
        dict(reversed(list(content.items())))
    )


def test_compute_revision_changes_when_content_changes():
    base = {"id": "agent", "version": 1}
    assert compute_revision(base) != compute_revision({"id": "agent", "version": 2})


def test_compute_revision_ignores_existing_revision_value():
    base = {"id": "agent", "version": 1}
    assert compute_revision(base) == compute_revision(
        {**base, "revision": "sha256:stale"}
    )


def test_compute_revision_has_sha256_prefix_and_hex_digest():
    revision = compute_revision({"id": "agent"})
    prefix, _, digest = revision.partition(":")
    assert prefix == "sha256"
    assert len(digest) == 64
    assert set(digest) <= set("0123456789abcdef")


def test_compute_revision_rejects_non_serializable_content():
    with pytest.raises(TypeError):
        compute_revision({"id": object()})
