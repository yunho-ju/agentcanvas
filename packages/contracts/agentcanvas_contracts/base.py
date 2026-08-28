"""모든 계약 모델이 딛는 바닥 — 공통 기본형과 raw secret 금지 규칙.

AgentSpec뿐 아니라 LocalizedText·ToolDef처럼 spec에 실리는 조각들도 같은 바닥을
쓴다. 바닥이 여기 있어야 조각들이 AgentSpec을 거치지 않고 서로를 조립할 수 있다.
"""

from __future__ import annotations

from typing import Annotated, Any

from pydantic import AfterValidator, BaseModel, ConfigDict, Field, model_validator

from .refs import no_raw_secrets

JsonSchema = dict[str, Any]


def _must_not_be_blank(value: str) -> str:
    if not value.strip():
        raise ValueError("must not be blank")
    return value


# min_length는 JSON Schema에도 실린다 — 파이썬만 아는 규칙은 다른 언어에서 지켜지지 않는다.
NonEmptyText = Annotated[str, Field(min_length=1), AfterValidator(_must_not_be_blank)]


class ContractModel(BaseModel):
    model_config = ConfigDict(extra="forbid")

    @model_validator(mode="after")
    def _reject_raw_secrets(self):
        """자유 dict/list 필드에는 raw secret이 들어올 수 없다."""
        for name, value in self:
            if isinstance(value, (dict, list, tuple)):
                no_raw_secrets(value, name)
        return self


__all__ = ["ContractModel", "JsonSchema", "NonEmptyText"]
