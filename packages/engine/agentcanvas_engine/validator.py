"""그래프 정적 검증 — 포트 존재·schema 호환·도달성·cycle·node type."""

from __future__ import annotations

from enum import Enum

from agentcanvas_contracts.agent_spec import AgentSpec, Edge, JsonSchema, Node
from agentcanvas_contracts.node_registry import (
    DEFAULT_NODE_TYPES,
    INPUT_NODE_TYPE,
    NodeType,
    ResolvedPorts,
    binding_refs,
    config_issues,
    resolve_ports,
    skill_refs,
)
from pydantic import BaseModel


class Severity(str, Enum):
    ERROR = "error"
    WARNING = "warning"
    # 잘못이 아니라 알아 두면 좋은 것 — 실행을 막지 않는다.
    INFO = "info"


class ValidationIssue(BaseModel):
    severity: Severity
    code: str
    message: str
    node_id: str | None = None
    edge_id: str | None = None


def validate_graph(
    spec: AgentSpec, registry: dict[str, NodeType] = DEFAULT_NODE_TYPES
) -> list[ValidationIssue]:
    duplicates = _duplicate_id_issues(spec)
    if duplicates:
        # 중복 id가 있으면 이후 규칙의 판정이 오염되므로 여기서 멈춘다.
        return duplicates

    nodes = {node.id: node for node in spec.nodes}
    ports = _resolve_all_ports(spec, registry)

    issues = _unknown_node_type_issues(spec.nodes, registry)
    issues.extend(_invalid_config_issues(spec.nodes, registry))
    issues.extend(_unknown_binding_issues(spec, registry))
    issues.extend(_skill_issues(spec, registry))
    for edge in spec.edges:
        issues.extend(_edge_issues(edge, nodes, ports))
    issues.extend(_unreachable_issues(spec, nodes))
    issues.extend(_cycle_issues(spec, nodes))
    return issues


def _duplicate_id_issues(spec: AgentSpec) -> list[ValidationIssue]:
    issues = [
        ValidationIssue(
            severity=Severity.ERROR,
            code="node.duplicate_id",
            message=f"node id {node_id!r} is used more than once",
            node_id=node_id,
        )
        for node_id in _duplicates([node.id for node in spec.nodes])
    ]
    issues.extend(
        ValidationIssue(
            severity=Severity.ERROR,
            code="edge.duplicate_id",
            message=f"edge id {edge_id!r} is used more than once",
            edge_id=edge_id,
        )
        for edge_id in _duplicates([edge.id for edge in spec.edges])
    )
    return issues


def _duplicates(ids: list[str]) -> list[str]:
    seen: set[str] = set()
    duplicated: list[str] = []
    for value in ids:
        if value in seen and value not in duplicated:
            duplicated.append(value)
        seen.add(value)
    return duplicated


def _resolve_all_ports(
    spec: AgentSpec, registry: dict[str, NodeType]
) -> dict[str, ResolvedPorts]:
    return {
        node.id: resolve_ports(
            node, registry[node.type], spec.input_schema, spec.resources
        )
        for node in spec.nodes
        if node.type in registry
    }


def _invalid_config_issues(
    nodes: list[Node], registry: dict[str, NodeType]
) -> list[ValidationIssue]:
    return [
        ValidationIssue(
            severity=Severity.ERROR,
            code="node.invalid_config",
            message=message,
            node_id=node.id,
        )
        for node in nodes
        if node.type in registry
        for message in config_issues(node, registry[node.type])
    ]


def _unknown_binding_issues(
    spec: AgentSpec, registry: dict[str, NodeType]
) -> list[ValidationIssue]:
    known = {resource.id for resource in spec.resources}
    return [
        ValidationIssue(
            severity=Severity.ERROR,
            code="node.unknown_binding",
            message=(
                f"node {node.id!r} points at connection {ref!r}, "
                "which this agent does not have"
            ),
            node_id=node.id,
        )
        for node in spec.nodes
        if node.type in registry
        for ref in binding_refs(node, registry[node.type])
        if ref not in known
    ]


def _worn_skill_refs(spec: AgentSpec, registry: dict[str, NodeType]) -> dict[str, str]:
    """어느 노드가 어떤 skill을 입었는가 — ref 하나당 처음 입은 노드 하나를 기억한다."""
    worn: dict[str, str] = {}
    for node in spec.nodes:
        if node.type not in registry:
            continue
        for ref in skill_refs(node, registry[node.type]):
            worn.setdefault(ref, node.id)
    return worn


def _skill_issues(
    spec: AgentSpec, registry: dict[str, NodeType]
) -> list[ValidationIssue]:
    """문서가 가진 skill과 노드가 입은 skill이 서로 맞는가."""
    held = [skill.ref for skill in spec.skills]
    worn = _worn_skill_refs(spec, registry)

    issues = [
        ValidationIssue(
            severity=Severity.ERROR,
            code="skill.duplicate",
            message=f"this agent holds the skill {ref!r} more than once",
        )
        for ref in _duplicates(held)
    ]
    issues.extend(
        ValidationIssue(
            severity=Severity.ERROR,
            code="skill.missing",
            message=(
                f"node {node_id!r} wears the skill {ref!r}, "
                "which this agent does not have"
            ),
            node_id=node_id,
        )
        for ref, node_id in worn.items()
        if ref not in held
    )
    issues.extend(
        ValidationIssue(
            severity=Severity.INFO,
            code="skill.unused",
            message=f"the skill {ref!r} is here, but no step wears it",
        )
        for ref in dict.fromkeys(held)
        if ref not in worn
    )
    return issues


def _unknown_node_type_issues(
    nodes: list[Node], registry: dict[str, NodeType]
) -> list[ValidationIssue]:
    return [
        ValidationIssue(
            severity=Severity.ERROR,
            code="node.unknown_type",
            message=f"node type {node.type!r} is not in the registry",
            node_id=node.id,
        )
        for node in nodes
        if node.type not in registry
    ]


def _edge_issues(
    edge: Edge, nodes: dict[str, Node], ports: dict[str, ResolvedPorts]
) -> list[ValidationIssue]:
    issues: list[ValidationIssue] = []
    for endpoint, direction in ((edge.source, "outputs"), (edge.target, "inputs")):
        if endpoint.node not in nodes:
            issues.append(
                ValidationIssue(
                    severity=Severity.ERROR,
                    code="edge.unknown_node",
                    message=f"edge points at unknown node {endpoint.node!r}",
                    edge_id=edge.id,
                )
            )
        elif endpoint.node in ports and endpoint.port not in getattr(
            ports[endpoint.node], direction
        ):
            issues.append(
                ValidationIssue(
                    severity=Severity.ERROR,
                    code="edge.unknown_port",
                    message=(
                        f"node {endpoint.node!r} has no {direction[:-1]} port {endpoint.port!r}"
                    ),
                    node_id=endpoint.node,
                    edge_id=edge.id,
                )
            )
    if issues:
        return issues

    source_ports = ports.get(edge.source.node)
    target_ports = ports.get(edge.target.node)
    if source_ports is None or target_ports is None:
        return issues

    source_schema = source_ports.outputs[edge.source.port].schema_
    target_schema = target_ports.inputs[edge.target.port].schema_
    if not _schemas_compatible(source_schema, target_schema):
        issues.append(
            ValidationIssue(
                severity=Severity.ERROR,
                code="port.schema_mismatch",
                message=(
                    f"port {edge.source.node}.{edge.source.port} produces "
                    f"{source_schema['type']!r} but {edge.target.node}.{edge.target.port} "
                    f"expects {target_schema['type']!r}"
                ),
                edge_id=edge.id,
            )
        )
    return issues


def _schemas_compatible(source: JsonSchema, target: JsonSchema) -> bool:
    # TODO: 완전한 JSON Schema subsumption은 범위 밖 — 지금은 최상위 `type`만 비교한다.
    source_type = source.get("type")
    target_type = target.get("type")
    return source_type is None or target_type is None or source_type == target_type


def _adjacency(spec: AgentSpec, nodes: dict[str, Node]) -> dict[str, list[str]]:
    outgoing: dict[str, list[str]] = {node_id: [] for node_id in nodes}
    for edge in spec.edges:
        if edge.source.node in outgoing and edge.target.node in nodes:
            outgoing[edge.source.node].append(edge.target.node)
    return outgoing


def _unreachable_issues(
    spec: AgentSpec, nodes: dict[str, Node]
) -> list[ValidationIssue]:
    outgoing = _adjacency(spec, nodes)

    reached: set[str] = set()
    stack = [node.id for node in spec.nodes if node.type == INPUT_NODE_TYPE]
    while stack:
        current = stack.pop()
        if current in reached:
            continue
        reached.add(current)
        stack.extend(outgoing[current])

    return [
        ValidationIssue(
            severity=Severity.WARNING,
            code="graph.unreachable_node",
            message=f"node {node.id!r} cannot be reached from any {INPUT_NODE_TYPE} node",
            node_id=node.id,
        )
        for node in spec.nodes
        if node.id not in reached
    ]


def _cycle_issues(spec: AgentSpec, nodes: dict[str, Node]) -> list[ValidationIssue]:
    """반복(iterative) DFS — 깊은 체인에서도 재귀 한도에 걸리지 않는다."""
    outgoing = _adjacency(spec, nodes)
    issues: list[ValidationIssue] = []
    unvisited, on_path, done = 0, 1, 2
    state: dict[str, int] = {}

    for start in nodes:
        if state.get(start, unvisited) != unvisited:
            continue
        state[start] = on_path
        path = [start]
        stack = [(start, iter(outgoing[start]))]
        while stack:
            node_id, successors = stack[-1]
            next_id = next(successors, None)
            if next_id is None:
                stack.pop()
                path.pop()
                state[node_id] = done
                continue
            if state.get(next_id, unvisited) == on_path:
                cycle = path[path.index(next_id) :] + [next_id]
                issues.append(
                    ValidationIssue(
                        severity=Severity.ERROR,
                        code="graph.cycle",
                        message="cycle detected: " + " -> ".join(cycle),
                        node_id=next_id,
                    )
                )
            elif state.get(next_id, unvisited) == unvisited:
                state[next_id] = on_path
                path.append(next_id)
                stack.append((next_id, iter(outgoing[next_id])))
    return issues


__all__ = ["Severity", "ValidationIssue", "validate_graph"]
