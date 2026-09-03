"""Node Registry — UI가 inspector를 생성하고 validator가 포트를 해석하는 근거 (설계 문서 §4.2)."""

from __future__ import annotations

from jsonschema import Draft7Validator
from jsonschema.exceptions import ValidationError
from pydantic import Field

from .agent_spec import ContractModel, JsonSchema, Node, ResourceBinding
from .localized import LocalizedText
from .tool_def import ToolDef


class PortSpec(ContractModel):
    id: str = Field(min_length=1)
    schema_: JsonSchema = Field(alias="schema")
    plain_description: LocalizedText | None = None

    model_config = ContractModel.model_config | {
        "populate_by_name": True,
        "serialize_by_alias": True,
    }


class Ports(ContractModel):
    inputs: list[PortSpec] = Field(default_factory=list)
    outputs: list[PortSpec] = Field(default_factory=list)


class NodeType(ContractModel):
    type: str = Field(min_length=1)
    version: str = Field(min_length=1)
    runtime: str = Field(min_length=1)
    display_name: LocalizedText
    plain_description: LocalizedText
    ports: Ports
    config_schema: JsonSchema


class ResolvedPorts(ContractModel):
    inputs: dict[str, PortSpec] = Field(default_factory=dict)
    outputs: dict[str, PortSpec] = Field(default_factory=dict)


INPUT_NODE_TYPE = "core.input"

# config_schema 확장 키워드 — 이 자리에 적는 값은 spec.resources 바인딩의 id다.
BINDING_REF_MARKER = "x-binding-ref"

# config_schema 확장 키워드 — 이 노드의 포트는 config가 고른 도구(ToolDef)를 입는다.
# 어느 자리에 도구 이름을 적고 어느 포트가 무엇을 입는지는 여기 적힌 대로다
# (노드 타입 이름으로 분기하지 않는다).
TOOL_PORTS_MARKER = "x-tool-ports"
TOOL_NAME_FIELD = "tool_name_field"
TOOL_INPUT_PORT = "input_port"
TOOL_OUTPUT_PORT = "output_port"


def _input_bindings(node: Node) -> dict[str, str]:
    """core.input의 유효한 binding만 골라낸다 — 잘못된 config는 여기서 조용히 걸러진다."""
    bindings = node.config.get("bindings")
    if not isinstance(bindings, dict):
        return {}
    return {
        key: value
        for key, value in bindings.items()
        if isinstance(key, str) and key.strip() and isinstance(value, str)
    }


def _where(error: ValidationError) -> str:
    """오류가 난 자리 — studio가 필드 옆에 붙이는 것과 같은 경로를 글로 적는다."""
    return ".".join(["config", *(str(part) for part in error.absolute_path)])


def _schema_issues(config: dict, config_schema: JsonSchema) -> list[str]:
    """registry의 config_schema(JSON Schema)가 말하는 어긋남 — 타입 이름으로 분기하지 않는다.

    studio의 ajv(draft-07)와 같은 판정을 내야 한다. 새 규칙을 config_schema에 더할 때는
    두 쪽 판정이 같은지 먼저 본다 — `pattern`은 정규식 방언이 갈려 아직 결정되지 않았다
    (guard: tests/test_node_registry.py::test_the_registry_asks_for_no_pattern).
    """
    try:
        Draft7Validator.check_schema(config_schema)
        errors = list(Draft7Validator(config_schema).iter_errors(config))
    except Exception:  # noqa: BLE001 — 검증기의 사정으로 사용자의 편집을 막지 않는다.
        # 우리가 읽을 수 없는 schema로 사용자의 편집을 막지는 않는다
        # (studio validatorFor와 같은 규칙). 형식이 틀린 schema든, 가리키는 곳이
        # 없는 $ref든, 이유를 가리지 않고 검사를 생략한다 — 여기서 예외는 나가지 않는다.
        return []
    return [
        f"{_where(error)}: {error.message}"
        for error in sorted(errors, key=lambda error: (_where(error), error.message))
    ]


def _input_binding_issues(node: Node) -> list[str]:
    """core.input만의, config_schema가 표현하지 못하는 규칙 — 이름 하나하나가 출력 포트가 된다.

    bindings의 존재와 타입은 schema가 이미 말한다 — 한 실수를 두 번 말하지 않는다.
    """
    bindings = node.config.get("bindings")
    if not isinstance(bindings, dict):
        return []
    return [
        f"config.bindings has an empty port name ({key!r})"
        for key in bindings
        if not isinstance(key, str) or not key.strip()
    ]


def config_issues(node: Node, node_type: NodeType) -> list[str]:
    """config가 노드에 쓰이기에 부적합한 이유들을 사람이 읽을 문장으로 돌려준다 (예외 없음)."""
    issues = _schema_issues(node.config, node_type.config_schema)
    if node_type.type == INPUT_NODE_TYPE:
        issues.extend(_input_binding_issues(node))
    return issues


def binding_refs(node: Node, node_type: NodeType) -> list[str]:
    """config_schema가 바인딩 id라고 표시한(x-binding-ref) 자리에 실제로 적힌 이름들.

    타입 이름으로 분기하지 않는다 — 마커를 붙인 노드 타입이면 무엇이든 대상이다.
    """
    properties = node_type.config_schema.get("properties")
    if not isinstance(properties, dict):
        return []

    refs: list[str] = []
    for name, field_schema in properties.items():
        if not isinstance(field_schema, dict):
            continue
        value = node.config.get(name)
        if field_schema.get(BINDING_REF_MARKER) is True and isinstance(value, str):
            refs.append(value)
        items = field_schema.get("items")
        if (
            isinstance(items, dict)
            and items.get(BINDING_REF_MARKER) is True
            and isinstance(value, list)
        ):
            refs.extend(item for item in value if isinstance(item, str))
    return refs


def _chosen_tool(
    node: Node,
    node_type: NodeType,
    plan: dict,
    resources: list[ResourceBinding],
) -> ToolDef | None:
    """이 노드가 고른 도구 — 가리킨 바인딩이 그 이름의 도구를 들고 있을 때만 있다."""
    field = plan.get(TOOL_NAME_FIELD)
    wanted = node.config.get(field) if isinstance(field, str) else None
    if not isinstance(wanted, str):
        return None
    bound = binding_refs(node, node_type)
    return next(
        (
            tool
            for resource in resources
            if resource.id in bound
            for tool in resource.tools
            if tool.name == wanted
        ),
        None,
    )


def _wearing(ports: dict[str, PortSpec], port_id: object, schema: JsonSchema) -> None:
    """registry에 있는 포트에만 schema를 입힌다 — 없는 자리를 새로 만들지 않는다."""
    port = ports.get(port_id) if isinstance(port_id, str) else None
    if port is not None:
        ports[port.id] = port.model_copy(update={"schema_": schema})


def _tool_ports(
    node: Node,
    node_type: NodeType,
    resources: list[ResourceBinding],
    resolved: ResolvedPorts,
) -> None:
    """도구를 입는 포트를 가진 노드라면, 고른 도구의 schema를 그 포트에 입힌다."""
    plan = node_type.config_schema.get(TOOL_PORTS_MARKER)
    if not isinstance(plan, dict):
        return
    tool = _chosen_tool(node, node_type, plan, resources)
    if tool is None:
        return
    _wearing(resolved.inputs, plan.get(TOOL_INPUT_PORT), tool.input_schema)
    _wearing(resolved.outputs, plan.get(TOOL_OUTPUT_PORT), tool.output_schema)


def resolve_ports(
    node: Node,
    node_type: NodeType,
    input_schema: JsonSchema | None = None,
    resources: list[ResourceBinding] | None = None,
) -> ResolvedPorts:
    """노드의 실제 포트 = registry static ports ∪ config에서 파생되는 dynamic ports.

    잘못된 config에서는 예외 대신 dynamic port를 만들지 않는다 (검증은 `config_issues`).
    """
    resolved = ResolvedPorts(
        inputs={port.id: port for port in node_type.ports.inputs},
        outputs={port.id: port for port in node_type.ports.outputs},
    )
    if node_type.type == INPUT_NODE_TYPE:
        properties = (input_schema or {}).get("properties")
        properties = properties if isinstance(properties, dict) else {}
        for name in _input_bindings(node):
            port_schema = properties.get(name)
            resolved.outputs[name] = PortSpec(
                id=name, schema=port_schema if isinstance(port_schema, dict) else {}
            )
    _tool_ports(node, node_type, resources or [], resolved)
    return resolved


DEFAULT_NODE_TYPES: dict[str, NodeType] = {
    node_type.type: node_type
    for node_type in [
        NodeType.model_validate(
            {
                "type": "core.input",
                "version": "1.0",
                "runtime": "core.input",
                "display_name": {"ko": "입력", "en": "Input"},
                "plain_description": {
                    "ko": "에이전트가 받은 입력값을 그래프 안으로 흘려보낸다.",
                    "en": "Brings the values the agent was given into the graph.",
                },
                "ports": {"inputs": [], "outputs": []},
                "config_schema": {
                    "type": "object",
                    "properties": {
                        "bindings": {
                            "type": "object",
                            # 이 자리의 편집기는 이름·값 표가 아니라 받는 줄 편집기다
                            # (DESIGN §7 input-rows). 화면은 노드 타입 이름을 보지 않는다.
                            "format": "input-rows",
                            "title": "Values it takes in",
                            "description": (
                                "These are the values a run asks a person for."
                            ),
                            "x-i18n": {
                                "ko": {
                                    "title": "받는 값",
                                    "description": "실행할 때 사람에게 물을 값이에요.",
                                }
                            },
                            "additionalProperties": {"type": "string"},
                        }
                    },
                    "required": ["bindings"],
                },
            }
        ),
        NodeType.model_validate(
            {
                "type": "core.output",
                "version": "1.0",
                "runtime": "core.output",
                "display_name": {"ko": "출력", "en": "Output"},
                "plain_description": {
                    "ko": "에이전트가 최종적으로 돌려줄 값을 정한다.",
                    "en": "Decides what the agent hands back when it is done.",
                },
                "ports": {
                    "inputs": [
                        {
                            "id": "input",
                            "schema": {},
                            "plain_description": {
                                "ko": "최종 결과로 내보낼 값",
                                "en": "The value to send out as the final answer",
                            },
                        }
                    ],
                    "outputs": [],
                },
                "config_schema": {
                    "type": "object",
                    "properties": {
                        "binding": {
                            "type": "string",
                            "title": "Where the value sits",
                            "description": (
                                "Write where to find the value the agent hands back "
                                "when it finishes. For example: state.answer"
                            ),
                            "x-i18n": {
                                "ko": {
                                    "title": "내보낼 값의 위치",
                                    "description": (
                                        "에이전트가 끝날 때 돌려줄 값이 어디에 있는지 적는다. "
                                        "예: state.answer"
                                    ),
                                }
                            },
                        }
                    },
                    "required": ["binding"],
                },
            }
        ),
        NodeType.model_validate(
            {
                "type": "llm.router",
                "version": "1.0",
                "runtime": "langgraph.llm",
                "display_name": {"ko": "갈림길 판단", "en": "Decision"},
                "plain_description": {
                    "ko": "입력을 보고 다음에 어느 길로 갈지 고른다.",
                    "en": "Looks at what came in and picks which way to go next.",
                },
                "ports": {
                    "inputs": [
                        {
                            "id": "input",
                            "schema": {},
                            "plain_description": {
                                "ko": "판단할 값",
                                "en": "The value to look at",
                            },
                        }
                    ],
                    "outputs": [
                        {
                            "id": "route",
                            "schema": {"type": "string"},
                            "plain_description": {
                                "ko": "고른 길의 이름",
                                "en": "The name of the way it picked",
                            },
                        },
                        {
                            "id": "passthrough",
                            "schema": {},
                            "plain_description": {
                                "ko": "들어온 값을 그대로 다음 노드로 전달",
                                "en": "Hands the value it got to the next node as is",
                            },
                        },
                    ],
                },
                "config_schema": {
                    "type": "object",
                    "properties": {
                        "model_ref": {
                            "type": "string",
                            # 카탈로그에서 고르게 하는 힌트일 뿐이다 — 이미 저장된 이름을
                            # 깨지 않으려고 pattern으로 조이지 않는다.
                            "format": "model-ref",
                            "title": "Model to use",
                            "description": (
                                "The name that points to the AI model making this "
                                "call. For example: model://default"
                            ),
                            "x-i18n": {
                                "ko": {
                                    "title": "사용할 모델",
                                    "description": (
                                        "판단을 맡길 AI 모델을 가리키는 이름이다. "
                                        "예: model://default"
                                    ),
                                }
                            },
                        },
                        "instruction": {
                            "type": "string",
                            # 골라 채우고 고쳐 쓰는 여러 줄 글 상자 힌트 —
                            # 적은 그대로 모델에게 전달된다.
                            "format": "instruction",
                            "title": "Instructions",
                            "description": (
                                "Write what this step should decide and how. "
                                "The model reads it exactly as you wrote it."
                            ),
                            "x-i18n": {
                                "ko": {
                                    "title": "지시문",
                                    "description": (
                                        "이 갈림길이 무엇을 어떻게 판단하면 되는지 적는다. "
                                        "적은 그대로 모델에게 전달된다."
                                    ),
                                }
                            },
                        },
                        "prompt_ref": {
                            "type": "string",
                            "title": "Instruction name (advanced)",
                            "description": (
                                "A name for sharing one instruction across documents "
                                "later. For now it is only a label. "
                                "For example: prompt://triage@2"
                            ),
                            "x-i18n": {
                                "ko": {
                                    "title": "지시문 이름 (고급)",
                                    "description": (
                                        "나중에 여러 문서가 같은 지시문을 함께 쓰게 될 이름 "
                                        "자리다. 지금은 이름표일 뿐이다. 예: prompt://triage@2"
                                    ),
                                }
                            },
                        },
                        "output_schema_ref": {
                            "type": "string",
                            # 카탈로그에서 고르게 하는 힌트일 뿐이다 — 이미 저장된 이름을
                            # 깨지 않으려고 pattern으로 조이지 않는다.
                            "format": "schema-ref",
                            "title": "Shape of the answer",
                            "description": (
                                "The name that points to the shape the model's answer "
                                "has to follow. Leave it empty to ask for no "
                                "particular shape."
                            ),
                            "x-i18n": {
                                "ko": {
                                    "title": "답의 형식",
                                    "description": (
                                        "모델의 답이 지켜야 할 형식을 가리키는 이름이다. "
                                        "비워 두면 형식을 강제하지 않는다."
                                    ),
                                }
                            },
                        },
                    },
                    "required": ["model_ref"],
                    # 화면이 그리는 차례 — 지시문(주 필드) → 모델(유일한 필수) →
                    # 나머지 → 고급 이름표는 맨 뒤.
                    "x-field-order": [
                        "instruction",
                        "model_ref",
                        "output_schema_ref",
                        "prompt_ref",
                    ],
                },
            }
        ),
        NodeType.model_validate(
            {
                "type": "llm.agent",
                "version": "1.0",
                "runtime": "langgraph.llm",
                "display_name": {"ko": "AI 에이전트", "en": "AI agent"},
                "plain_description": {
                    "ko": "모델이 도구를 써 가며 답을 만든다.",
                    "en": "The model works with tools to build an answer.",
                },
                "ports": {
                    "inputs": [
                        {
                            "id": "messages",
                            # 엔진은 state 전체를 모델에게 넘긴다 — 사람의 말 한 줄이든 앞
                            # 노드의 답이든 대화가 된다. 이름뿐인 종류를 적지 않는다.
                            "schema": {},
                            "plain_description": {
                                "ko": "모델에게 줄 대화 내용 — 무엇이든 받는다",
                                "en": "The conversation to hand the model — takes anything",
                            },
                        }
                    ],
                    "outputs": [
                        {
                            "id": "response",
                            "schema": {"type": "string"},
                            "plain_description": {
                                "ko": "모델이 만든 답",
                                "en": "The answer the model wrote",
                            },
                        },
                        {
                            "id": "tool_calls",
                            "schema": {"type": "array"},
                            "plain_description": {
                                "ko": "모델이 사용한 도구 호출 기록",
                                "en": "A record of the tools the model reached for",
                            },
                        },
                    ],
                },
                "config_schema": {
                    "type": "object",
                    "properties": {
                        "model_ref": {
                            "type": "string",
                            # 카탈로그에서 고르게 하는 힌트일 뿐이다 — 이미 저장된 이름을
                            # 깨지 않으려고 pattern으로 조이지 않는다.
                            "format": "model-ref",
                            "title": "Model to use",
                            "description": (
                                "The name that points to the AI model writing the "
                                "answer. For example: model://default"
                            ),
                            "x-i18n": {
                                "ko": {
                                    "title": "사용할 모델",
                                    "description": (
                                        "답을 만들 AI 모델을 가리키는 이름이다. "
                                        "예: model://default"
                                    ),
                                }
                            },
                        },
                        "instruction": {
                            "type": "string",
                            # 골라 채우고 고쳐 쓰는 여러 줄 글 상자 힌트 —
                            # 적은 그대로 모델에게 전달된다.
                            "format": "instruction",
                            "title": "Instructions",
                            "description": (
                                "Write what this step should do and how. "
                                "The model reads it exactly as you wrote it."
                            ),
                            "x-i18n": {
                                "ko": {
                                    "title": "지시문",
                                    "description": (
                                        "이 단계가 무엇을 어떻게 하면 되는지 적는다. "
                                        "적은 그대로 모델에게 전달된다."
                                    ),
                                }
                            },
                        },
                        "prompt_ref": {
                            "type": "string",
                            "title": "Instruction name (advanced)",
                            "description": (
                                "A name for sharing one instruction across documents "
                                "later. For now it is only a label. "
                                "For example: prompt://clinical@7"
                            ),
                            "x-i18n": {
                                "ko": {
                                    "title": "지시문 이름 (고급)",
                                    "description": (
                                        "나중에 여러 문서가 같은 지시문을 함께 쓰게 될 이름 "
                                        "자리다. 지금은 이름표일 뿐이다. 예: prompt://clinical@7"
                                    ),
                                }
                            },
                        },
                        "toolset_refs": {
                            "type": "array",
                            "title": "Connections it may use",
                            "description": (
                                "Write the name of each connection whose tools this "
                                "agent may use, one per line. Use the names from this "
                                "agent's list of connections, not server addresses."
                            ),
                            "x-i18n": {
                                "ko": {
                                    "title": "쓸 수 있는 연결",
                                    "description": (
                                        "이 에이전트가 도구를 쓸 수 있는 연결의 이름을 "
                                        "한 줄에 하나씩 적는다. 서버 주소가 아니라 이 "
                                        "에이전트의 연결 목록에 있는 이름을 적는다."
                                    ),
                                }
                            },
                            # 원소 하나하나가 spec.resources 바인딩의 id다.
                            "items": {"type": "string", BINDING_REF_MARKER: True},
                        },
                        "max_turns": {
                            "type": "integer",
                            "title": "How many turns at most",
                            "description": (
                                "The most times the model may go back and forth with "
                                "tools while working on its answer. A large number "
                                "takes a long time."
                            ),
                            "x-i18n": {
                                "ko": {
                                    "title": "최대 주고받기 횟수",
                                    "description": (
                                        "모델이 도구를 쓰며 답을 다듬을 수 있는 최대 횟수다. "
                                        "너무 크면 오래 걸린다."
                                    ),
                                }
                            },
                            "minimum": 1,
                        },
                    },
                    "required": ["model_ref"],
                    # 화면이 그리는 차례 — 지시문(주 필드) → 모델(유일한 필수) →
                    # 나머지 → 고급 이름표는 맨 뒤.
                    "x-field-order": [
                        "instruction",
                        "model_ref",
                        "max_turns",
                        "toolset_refs",
                        "prompt_ref",
                    ],
                },
            }
        ),
        NodeType.model_validate(
            {
                "type": "tool.mcp",
                "version": "1.0",
                "runtime": "mcp.gateway",
                "display_name": {"ko": "도구 실행", "en": "Run a tool"},
                "plain_description": {
                    "ko": "연결된 외부 도구를 한 번 실행한다.",
                    "en": "Runs one connected outside tool a single time.",
                },
                "ports": {
                    "inputs": [
                        {
                            "id": "input",
                            "schema": {"type": "object"},
                            "plain_description": {
                                "ko": "도구에 넘길 값",
                                "en": "The value to hand the tool",
                            },
                        }
                    ],
                    "outputs": [
                        {
                            "id": "result",
                            "schema": {},
                            "plain_description": {
                                "ko": "도구가 돌려준 값",
                                "en": "What the tool gave back",
                            },
                        },
                        {
                            "id": "error",
                            "schema": {"type": "object"},
                            "plain_description": {
                                "ko": "도구가 실패했을 때의 이유",
                                "en": "Why the tool could not finish",
                            },
                        },
                    ],
                },
                "config_schema": {
                    "type": "object",
                    "properties": {
                        "resource_ref": {
                            "type": "string",
                            "title": "Connection to use",
                            "description": (
                                "The name of the connection that holds the tool you "
                                "want to run. Use a name from this agent's list of "
                                "connections, not the server address. For example: "
                                "clinical-reference"
                            ),
                            "x-i18n": {
                                "ko": {
                                    "title": "사용할 연결",
                                    "description": (
                                        "실행할 도구가 있는 연결의 이름이다. 서버 주소가 "
                                        "아니라 이 에이전트의 연결 목록에 있는 이름을 "
                                        "적는다. 예: clinical-reference"
                                    ),
                                }
                            },
                            # 이 값은 spec.resources 바인딩의 id다.
                            BINDING_REF_MARKER: True,
                        },
                        "tool_name": {
                            "type": "string",
                            "title": "Name of the tool to run",
                            "description": (
                                "The name of the tool to actually run on that server."
                            ),
                            "x-i18n": {
                                "ko": {
                                    "title": "실행할 도구 이름",
                                    "description": (
                                        "그 서버에서 실제로 실행할 도구의 이름이다."
                                    ),
                                }
                            },
                        },
                    },
                    "required": ["resource_ref", "tool_name"],
                    # 이 노드의 포트는 고른 도구(ToolDef)를 입는다 — 어느 자리에 이름을
                    # 적고 어느 포트가 무엇을 입는지를 registry가 말한다.
                    TOOL_PORTS_MARKER: {
                        TOOL_NAME_FIELD: "tool_name",
                        TOOL_INPUT_PORT: "input",
                        TOOL_OUTPUT_PORT: "result",
                    },
                },
            }
        ),
        NodeType.model_validate(
            {
                "type": "control.human_gate",
                "version": "1.0",
                "runtime": "langgraph.interrupt",
                "display_name": {"ko": "사람 확인", "en": "Human check"},
                "plain_description": {
                    "ko": "사람이 확인하고 승인해야 다음으로 넘어간다.",
                    "en": "A person has to look and say yes before this goes on.",
                },
                "ports": {
                    "inputs": [
                        {
                            "id": "review",
                            "schema": {},
                            "plain_description": {
                                "ko": "사람이 확인할 내용",
                                "en": "What the person will look at",
                            },
                        }
                    ],
                    "outputs": [
                        {
                            "id": "approved",
                            "schema": {},
                            "plain_description": {
                                "ko": "승인했을 때 흘러가는 값",
                                "en": "The value that flows on after a yes",
                            },
                        },
                        {
                            "id": "rejected",
                            "schema": {},
                            "plain_description": {
                                "ko": "거절했을 때 흘러가는 값",
                                "en": "The value that flows on after a no",
                            },
                        },
                    ],
                },
                "config_schema": {
                    "type": "object",
                    "properties": {
                        "approval_schema_ref": {
                            "type": "string",
                            # 카탈로그에서 고르게 하는 힌트일 뿐이다 — 이미 저장된 이름을
                            # 깨지 않으려고 pattern으로 조이지 않는다.
                            "format": "schema-ref",
                            "title": "Shape of the review screen",
                            "description": (
                                "The name that points to the shape of what the person "
                                "sees while checking."
                            ),
                            "x-i18n": {
                                "ko": {
                                    "title": "확인 화면의 형식",
                                    "description": (
                                        "사람이 확인할 때 보여줄 항목의 형식을 "
                                        "가리키는 이름이다."
                                    ),
                                }
                            },
                        }
                    },
                    "required": ["approval_schema_ref"],
                },
            }
        ),
    ]
}


__all__ = [
    "BINDING_REF_MARKER",
    "DEFAULT_NODE_TYPES",
    "INPUT_NODE_TYPE",
    "TOOL_INPUT_PORT",
    "TOOL_NAME_FIELD",
    "TOOL_OUTPUT_PORT",
    "TOOL_PORTS_MARKER",
    "NodeType",
    "PortSpec",
    "Ports",
    "ResolvedPorts",
    "binding_refs",
    "config_issues",
    "resolve_ports",
]
