"""게시 — 이 문서가 어느 판을 대화 상대로 내놓았는가.

게시는 판 하나를 가리키는 가벼운 행위다: 모델·도구·eval을 동결하는 release manifest와
다르다. 여기 담기는 것은 어느 그래프의 어느 판이, 언제 게시됐는가뿐이다.
"""

from __future__ import annotations

from datetime import UTC, datetime

import pytest
from agentcanvas_contracts.publication import SpecPublication
from pydantic import ValidationError

REVISION = "sha256:" + "0" * 64
PUBLISHED_AT = datetime(2026, 8, 29, 9, 0, tzinfo=UTC)


def a_publication(**changes) -> SpecPublication:
    return SpecPublication(
        **{
            "spec_id": "clinical-assistant",
            "revision": REVISION,
            "published_at": PUBLISHED_AT,
            **changes,
        }
    )


def test_a_publication_points_at_one_revision_of_one_graph():
    published = a_publication()

    assert published.spec_id == "clinical-assistant"
    assert published.revision == REVISION


def test_a_publication_without_a_graph_is_not_a_publication():
    with pytest.raises(ValidationError):
        a_publication(spec_id="")


def test_a_publication_points_at_a_revision_that_looks_like_one():
    with pytest.raises(ValidationError):
        a_publication(revision="whatever")


def test_a_publication_remembers_when_it_went_out():
    assert a_publication().published_at == PUBLISHED_AT
