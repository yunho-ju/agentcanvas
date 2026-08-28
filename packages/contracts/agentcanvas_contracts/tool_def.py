"""ToolDef — 도구 하나가 무엇을 받고 무엇을 돌려주는지 적은 계약.

인터페이스(모든 도구가 같다)와 부르는 방법(call — 어댑터만 읽는다)을 나눈다.
"""

from __future__ import annotations

from enum import Enum
from typing import Annotated, Literal

from pydantic import Field

from .base import ContractModel, JsonSchema, NonEmptyText
from .localized import LocalizedText
from .refs import ModelRef, SecretRef


class HttpMethod(str, Enum):
    GET = "GET"
    POST = "POST"
    PUT = "PUT"
    PATCH = "PATCH"
    DELETE = "DELETE"


class HttpCall(ContractModel):
    """우리가 감싼 HTTP API를 부르는 방법."""

    transport: Literal["http"]
    method: HttpMethod
    url_template: NonEmptyText
    auth: SecretRef | None = None


class McpCall(ContractModel):
    """MCP 서버가 아는 이름으로 도구를 부르는 방법."""

    transport: Literal["mcp"]
    remote_name: NonEmptyText


# 부르는 방법은 transport가 정한다 — 새 방법은 표에 한 줄이지 분기가 아니다.
ToolCall = Annotated[HttpCall | McpCall, Field(discriminator="transport")]


class FullResult(ContractModel):
    """받은 것을 그대로 싣는다 — 작은 응답의 기본값."""

    mode: Literal["full"]


class SectionsResult(ContractModel):
    """부르는 쪽이 필요한 섹션만 골라 받는다."""

    mode: Literal["sections"]
    section_param: NonEmptyText


class DigestResult(ContractModel):
    """받은 전체를 모델로 줄여 싣는다 — 요약 모델은 본 실행과 분리한다."""

    mode: Literal["digest"]
    model_ref: ModelRef
    max_chars: int = Field(gt=0)


class ChunkRule(ContractModel):
    """긴 글을 어떤 단위로 얼마씩 자를지."""

    by: Literal["section", "chars"]
    size: int = Field(gt=0)


class RetrieveResult(ContractModel):
    """질의로 관련 조각만 골라 싣는다."""

    mode: Literal["retrieve"]
    query_param: NonEmptyText
    top_k: int = Field(gt=0)
    chunk: ChunkRule


# 얼마나 실을지는 mode가 정한다 — 새 전략은 표에 한 줄이지 분기가 아니다.
ResultHandling = Annotated[
    FullResult | SectionsResult | DigestResult | RetrieveResult,
    Field(discriminator="mode"),
]


class ToolDef(ContractModel):
    """바인딩 하나가 들고 다니는 도구 한 개."""

    name: NonEmptyText
    plain_description: LocalizedText
    input_schema: JsonSchema
    output_schema: JsonSchema
    timeout_ms: int = Field(gt=0)
    call: ToolCall
    # 판별 필드는 언제나 적힌다 — 아무 말도 없을 때만 계약이 기본 전략을 대신 적어 준다.
    result_handling: ResultHandling = Field(
        default_factory=lambda: FullResult(mode="full")
    )


__all__ = [
    "ChunkRule",
    "DigestResult",
    "FullResult",
    "HttpCall",
    "HttpMethod",
    "McpCall",
    "ResultHandling",
    "RetrieveResult",
    "SectionsResult",
    "ToolCall",
    "ToolDef",
]
