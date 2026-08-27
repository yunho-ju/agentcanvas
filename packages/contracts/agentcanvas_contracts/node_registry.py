"""Node Registry — UI가 inspector를 생성하고 validator가 포트를 해석하는 근거 (설계 문서 §4.2)."""

from __future__ import annotations

from pydantic import Field

from .agent_spec import ContractModel, JsonSchema, Node
from .localized import LocalizedText


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


def config_issues(node: Node, node_type: NodeType) -> list[str]:
    """config가 포트 해석에 쓰이기에 부적합한 이유들을 사람이 읽을 문장으로 돌려준다."""
    if node_type.type != INPUT_NODE_TYPE:
        return []

    bindings = node.config.get("bindings")
    if not isinstance(bindings, dict):
        return [
            f"config.bindings must be an object of name -> path, got {type(bindings).__name__}"
        ]

    issues = []
    for key, value in bindings.items():
        if not isinstance(key, str) or not key.strip():
            issues.append(f"config.bindings has an empty port name ({key!r})")
        elif not isinstance(value, str):
            issues.append(
                f"config.bindings[{key!r}] must be a string path, got {type(value).__name__}"
            )
    return issues


def resolve_ports(
    node: Node, node_type: NodeType, input_schema: JsonSchema | None = None
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
                            "title": "Values to bring in",
                            "description": (
                                "Pick which values to take from what the agent was "
                                "given. Each name you write on the left becomes an "
                                "output of this node."
                            ),
                            "x-i18n": {
                                "ko": {
                                    "title": "가져올 입력 값",
                                    "description": (
                                        "에이전트가 받은 입력에서 어떤 값을 꺼내 쓸지 정한다. "
                                        "왼쪽에 적은 이름이 그대로 이 노드의 출력 포트가 된다."
                                    ),
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
                            "schema": {"type": "array"},
                            "plain_description": {
                                "ko": "모델에게 줄 대화 내용",
                                "en": "The conversation to hand the model",
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
    "NodeType",
    "PortSpec",
    "Ports",
    "ResolvedPorts",
    "config_issues",
    "resolve_ports",
]
