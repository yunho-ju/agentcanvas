"""Tool wrapper adapter — 사람이 붙여 넣은 API 설명을 연결+도구 patch로 옮긴다.

Architect와 같은 골격(같은 patch 계약·같은 물러섬)을 쓰고, 다른 것은 둘뿐이다:
이 서비스의 프롬프트와, 이 서비스가 쓸 수 있는 작업의 표.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from enum import Enum

from agentcanvas_contracts.agent_spec import AgentSpec, Node, Position
from agentcanvas_contracts.architect_patch import AgentSpecPatch
from agentcanvas_engine.model_call import ModelAsk, ModelCall

from .architect import (
    ARCHITECT_PATCH_SCHEMA_NAME,
    OPERATION_NOT_ALLOWED_MESSAGE,
    ArchitectBalked,
    ArchitectSaid,
    patch_said,
)

TOOL_WRAPPER_PROMPT_REF = "prompt://tool-wrapper@1"

#: 새 연결을 만들러 왔을 때 쓸 수 있는 작업 — 연결을 **더하는** 것 하나뿐이다.
#: 화면은 새로 들어올 연결만 보여 주므로, 고치기를 함께 허용하면 사람이 보지 못한 채
#: 기존 연결이 바뀐다.
TOOL_WRAPPER_ALLOWED_OPERATIONS = ("add_resource",)

#: 이미 있는 연결 하나를 다시 가져올 때 쓸 수 있는 작업 — 그 하나를 갈아 끼우는 것뿐이다.
#: 지우기는 서버가 할 일이 아니다(화면의 로컬 편집) — `remove_resource`는 열지 않는다.
TOOL_WRAPPER_REIMPORT_OPERATIONS = ("replace_resource",)

#: 무엇을 하러 왔는가 → 쓸 수 있는 작업 (모드 → 표, 분기 대신 표).
OPERATIONS_BY_MODE: dict[bool, tuple[str, ...]] = {
    False: TOOL_WRAPPER_ALLOWED_OPERATIONS,
    True: TOOL_WRAPPER_REIMPORT_OPERATIONS,
}


class ToolSource(str, Enum):
    """사람이 무엇을 붙여 넣었는가 — 새 입력 종류는 여기와 아래 표에 한 줄씩이다."""

    OPENAPI = "openapi"
    CURL = "curl"
    PROSE = "prose"


#: 붙여 넣은 것이 무엇인지 모델에게 말해 주는 표 (분기 금지).
SOURCE_WORDS: dict[ToolSource, str] = {
    ToolSource.OPENAPI: "an OpenAPI or Swagger document for an HTTP API",
    ToolSource.CURL: "one or more example requests written as curl commands",
    ToolSource.PROSE: "a person's own words describing what the HTTP API does",
}


ADD_ONLY = (
    "Add new connections only. Do not remove or replace a connection that is already "
    "there, and do not touch nodes, edges, schemas, or execution."
)


def _reimport_only(replacing: str) -> str:
    return (
        f"Replace the connection whose id is {replacing!r} and keep that exact id. "
        "Read the tools out of what the person pasted; tools that are no longer there "
        "must be left out. Touch no other connection, and do not touch nodes, edges, "
        "schemas, or execution."
    )


SHAPE_OF_A_CONNECTION = (
    'Each connection uses kind "http.api", an approval_policy, and a server_ref that '
    'is a name such as "api://article-search" — a name, never a web address. '
    "The web address belongs in each tool's url_template."
)

SHAPE_OF_A_TOOL = (
    "Every tool needs a name, a plain_description in both ko and en written in "
    "everyday words, an input_schema and an output_schema whose properties have "
    "titles a non-developer can read, a timeout_ms, and a call with "
    'transport "http", its method, and its url_template.'
)

KEYS_STAY_ON_THE_SERVER = (
    "Never write a key, token, or password. When a call needs one, put only a name "
    'like "secret://my-api-key" in the call\'s auth field; the value itself stays '
    "on the server."
)


@dataclass(frozen=True)
class ToolWrapRequest:
    base_spec: AgentSpec
    source_kind: ToolSource
    source: str
    model_ref: str
    #: 이미 있는 연결을 다시 가져오는 중이면 그 id — 없으면 새 연결을 만드는 것이다.
    replacing: str | None = None
    prompt_ref: str = TOOL_WRAPPER_PROMPT_REF


type ToolWrapCall = Callable[[ToolWrapRequest], ArchitectSaid | ArchitectBalked]


def _tool_wrapper_prompt(asked: ToolWrapRequest) -> str:
    """모델에게 보내는 입력 — 붙여 넣은 것을 연결 하나와 그 도구들로 옮기게 한다."""

    operations = ", ".join(operations_for(asked.replacing))
    taken = ", ".join(resource.id for resource in asked.base_spec.resources) or "none"
    return "\n".join(
        [
            "You turn what a person pasted into one connection and the tools it holds.",
            "Return JSON only. Do not return markdown, prose, or executable code.",
            f"The exact base revision is {asked.base_spec.revision}.",
            f"Use schema_version agent.patch/v1 and only this operation: {operations}.",
            ADD_ONLY if asked.replacing is None else _reimport_only(asked.replacing),
            SHAPE_OF_A_CONNECTION,
            f"Connection ids already used in this document: {taken}."
            + (" Pick a new id." if asked.replacing is None else ""),
            SHAPE_OF_A_TOOL,
            KEYS_STAY_ON_THE_SERVER,
            f"What the person pasted is {SOURCE_WORDS[asked.source_kind]}:",
            asked.source.strip(),
        ]
    )


def _ask_for(asked: ToolWrapRequest) -> ModelAsk:
    return ModelAsk(
        node=Node(
            id="tool-wrapper",
            type="llm.agent",
            position=Position(x=0, y=0),
            config={"model_ref": asked.model_ref},
        ),
        state={},
        ways=(),
        model_ref=asked.model_ref,
        prompt_ref=asked.prompt_ref,
        instruction=_tool_wrapper_prompt(asked),
        response_schema=AgentSpecPatch.model_json_schema(),
        response_name=ARCHITECT_PATCH_SCHEMA_NAME,
    )


def operations_for(replacing: str | None) -> tuple[str, ...]:
    """이 요청이 쓸 수 있는 작업 — 대상 연결을 들고 왔는가가 표를 고른다."""
    return OPERATIONS_BY_MODE[replacing is not None]


def _reaches_past(patch: AgentSpecPatch, replacing: str | None) -> bool:
    """제안이 대상 연결 밖을 만지는가 — 화면이 보여 주지 않는 것은 바뀌지 않는다."""
    if replacing is None:
        return False
    return any(
        getattr(operation, "resource", None) is not None
        and operation.resource.id != replacing
        for operation in patch.operations
    )


def tool_wrapper_from(model: ModelCall) -> ToolWrapCall:
    """기존 ModelCall을 연결 patch 반환 자리로 감싼다."""

    def asks(asked: ToolWrapRequest) -> ArchitectSaid | ArchitectBalked:
        said = patch_said(model(_ask_for(asked)), operations_for(asked.replacing))
        if isinstance(said, ArchitectSaid) and _reaches_past(
            said.patch, asked.replacing
        ):
            return ArchitectBalked(
                reason="invalid_patch", message=OPERATION_NOT_ALLOWED_MESSAGE
            )
        return said

    return asks


__all__ = [
    "OPERATIONS_BY_MODE",
    "SOURCE_WORDS",
    "TOOL_WRAPPER_ALLOWED_OPERATIONS",
    "TOOL_WRAPPER_PROMPT_REF",
    "TOOL_WRAPPER_REIMPORT_OPERATIONS",
    "ToolSource",
    "ToolWrapCall",
    "ToolWrapRequest",
    "operations_for",
    "tool_wrapper_from",
]
