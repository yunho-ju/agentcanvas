"""revision = "sha256:" + sha256(canonical_json) 규칙.

canonical 표현은 **검증된 Pydantic 모델의 `model_dump(mode="json")`** 이다.
즉 기본값이 주입되고 숫자 타입이 정규화된 형태(예: position `80` → `80.0`)가 기준이며,
`AgentSpec.computed_revision()`이 유일한 표준 경로다.
디스크의 raw JSON 문자열을 그대로 해싱하는 것은 비표준 경로이고 다른 값을 낼 수 있다.

canonical_json 자체는 revision 필드 제외 · key 정렬 · 공백 없음 · UTF-8이다.

TODO: TypeScript 클라이언트가 생기는 시점에 언어 중립 canonicalization(JCS / RFC 8785)으로
      교체할지 결정한다 — 지금은 Python 모델 dump가 유일한 생산 경로다.
"""

from __future__ import annotations

import hashlib
import json
from typing import Any

REVISION_PREFIX = "sha256:"
REVISION_PATTERN = r"^sha256:[0-9a-f]{64}$"


def canonical_json(content: dict[str, Any]) -> str:
    """revision 필드를 제외하고 key 정렬·공백 없이 직렬화한다."""
    without_revision = {
        key: value for key, value in content.items() if key != "revision"
    }
    return json.dumps(
        without_revision, sort_keys=True, separators=(",", ":"), ensure_ascii=False
    )


def compute_revision(content: dict[str, Any]) -> str:
    digest = hashlib.sha256(canonical_json(content).encode("utf-8")).hexdigest()
    return f"{REVISION_PREFIX}{digest}"


__all__ = ["REVISION_PATTERN", "REVISION_PREFIX", "canonical_json", "compute_revision"]
