"""revision = "sha256:" + sha256(canonical_json) 규칙.

canonical 표현은 **검증된 Pydantic 모델의 `model_dump(mode="json")`** 이다.
즉 기본값이 주입되고 숫자 타입이 정규화된 형태(예: position `80` → `80.0`)가 기준이며,
`AgentSpec.computed_revision()`이 유일한 표준 경로다.
디스크의 raw JSON 문자열을 그대로 해싱하는 것은 비표준 경로이고 다른 값을 낼 수 있다.

canonical_json 자체는 revision 필드 제외 · key 정렬 · 공백 없음 · UTF-8이다.

나중에 더해진 목록 필드(`ADDITIVE_EMPTY_FIELDS`)는 **비어 있으면 생략한다**:
"빈 skills는 없는 것과 같다 — 필드가 나중에 생겨도 기존 문서의 revision은 그대로다."
기본값이 주입되는 canonical 표현에서 새 빈 목록이 생기면 저장된 모든 문서의 revision이
바뀌고, 그 revision을 가리키는 실행·시험 batch·게시·patch 검증이 전부 어긋난다.
하나라도 들어 있으면 그대로 실려 다른 revision이 된다.

TODO: TypeScript 클라이언트가 생기는 시점에 언어 중립 canonicalization(JCS / RFC 8785)으로
      교체할지 결정한다 — 지금은 Python 모델 dump가 유일한 생산 경로다.
"""

from __future__ import annotations

import hashlib
import json
from typing import Any

REVISION_PREFIX = "sha256:"
REVISION_PATTERN = r"^sha256:[0-9a-f]{64}$"

# 비어 있으면 없는 것과 같은 필드 — 뒤늦게 더해져도 옛 문서의 revision을 흔들지 않는다.
ADDITIVE_EMPTY_FIELDS = ("skills",)


def _is_omitted(key: str, value: Any) -> bool:
    return key == "revision" or (key in ADDITIVE_EMPTY_FIELDS and value == [])


def canonical_json(content: dict[str, Any]) -> str:
    """revision 필드와 비어 있는 추가 필드를 빼고 key 정렬·공백 없이 직렬화한다."""
    kept = {key: value for key, value in content.items() if not _is_omitted(key, value)}
    return json.dumps(kept, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def compute_revision(content: dict[str, Any]) -> str:
    digest = hashlib.sha256(canonical_json(content).encode("utf-8")).hexdigest()
    return f"{REVISION_PREFIX}{digest}"


__all__ = [
    "ADDITIVE_EMPTY_FIELDS",
    "REVISION_PATTERN",
    "REVISION_PREFIX",
    "canonical_json",
    "compute_revision",
]
