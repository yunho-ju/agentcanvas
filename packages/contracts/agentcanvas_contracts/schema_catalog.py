"""스키마 카탈로그 — `schema://` ref가 가리키는 값-스키마가 사는 곳.

gate가 사람에게 무엇을 물을지는 노드 config의 이름(ref) 하나로만 적힌다.
그 이름이 가리키는 실제 형식은 여기서 풀린다 (Control Plane이 서버로 옮겨 가도 리졸버의 모양은 그대로다).
"""

from __future__ import annotations

from pydantic import Field

from .agent_spec import ContractModel, JsonSchema
from .localized import LocalizedText
from .refs import SchemaRef


class SchemaDef(ContractModel):
    """ref 하나가 가리키는 값의 형식 — 폼은 이 `schema`를 그린다."""

    ref: SchemaRef
    title: LocalizedText
    schema_: JsonSchema = Field(alias="schema")

    model_config = ContractModel.model_config | {
        "populate_by_name": True,
        "serialize_by_alias": True,
    }


DEFAULT_SCHEMA_CATALOG: dict[str, SchemaDef] = {
    definition.ref: definition
    for definition in [
        SchemaDef.model_validate(
            {
                "ref": "schema://answer-review@1",
                "title": {"ko": "답 검토", "en": "Answer review"},
                "schema": {
                    "type": "object",
                    "properties": {
                        "comment": {
                            "type": "string",
                            "format": "textarea",
                            "title": "Review note",
                            "description": (
                                "What the person wants to say about what they checked."
                            ),
                            "x-i18n": {
                                "ko": {
                                    "title": "검토 의견",
                                    "description": (
                                        "확인한 내용에 대해 사람이 남기고 싶은 말이다."
                                    ),
                                }
                            },
                        }
                    },
                    "required": [],
                },
            }
        )
    ]
}


def resolve_schema(ref: str) -> SchemaDef | None:
    """ref가 가리키는 형식을 돌려준다 — 정확히 같은 이름만 찾고, 못 찾으면 없다고 말한다."""
    return DEFAULT_SCHEMA_CATALOG.get(ref)


__all__ = ["DEFAULT_SCHEMA_CATALOG", "SchemaDef", "resolve_schema"]
