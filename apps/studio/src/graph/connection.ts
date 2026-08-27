// Python `agentcanvas_engine.validator`의 edge 규칙 미러 — 포트 존재 + schema 호환.
import type { AgentSpec, EdgeEndpoint } from "../generated/agent_spec";
import type { NodeType, PortSpec } from "../generated/node_type";
import { type Message, msg } from "../i18n/messages";
import { type JsonSchema, nodeTypes, resolvePorts } from "../registry/registry";
import { typeWord } from "./typeWords";

export interface ConnectionCheck {
  ok: boolean;
  reason?: Message;
}

function portOf(
  spec: AgentSpec,
  endpoint: EdgeEndpoint,
  direction: "inputs" | "outputs",
  registry: Record<string, NodeType>,
): PortSpec | { missing: Message } {
  const node = spec.nodes.find((candidate) => candidate.id === endpoint.node);
  if (!node) return { missing: msg("connection.unknownNode") };

  const nodeType = registry[node.type];
  if (!nodeType) return { missing: msg("connection.unknownType") };

  const port = resolvePorts(node, nodeType, spec.input_schema)[direction][endpoint.port];
  if (!port) {
    const key =
      direction === "inputs" ? "connection.missingInput" : "connection.missingOutput";
    // 포트는 사용자가 캔버스에서 읽는 그 라벨로 가리킨다 (DESIGN §7).
    return { missing: msg(key, { port: endpoint.port }) };
  }
  return port;
}

function schemaType(schema: JsonSchema): unknown {
  return schema.type;
}

/** Python의 `source_type == target_type`과 같은 의미 — union type도 값 그대로 비교한다. */
function sameType(source: unknown, target: unknown): boolean {
  return JSON.stringify(source) === JSON.stringify(target);
}

/**
 * 이 연결을 그으면 흐름이 제자리로 돌아오는가 — Python validator의 `graph.cycle` 미러.
 * 반복(iterative)으로 훑는다: 깊은 체인에서도 재귀 한도에 걸리지 않는다.
 */
function comesBackAround(spec: AgentSpec, source: string, target: string): boolean {
  const outgoing = new Map<string, string[]>();
  for (const edge of spec.edges) {
    outgoing.set(edge.source.node, [
      ...(outgoing.get(edge.source.node) ?? []),
      edge.target.node,
    ]);
  }

  const seen = new Set<string>();
  const stack = [target];
  while (stack.length > 0) {
    const node = stack.pop() as string;
    if (node === source) return true;
    if (seen.has(node)) continue;
    seen.add(node);
    stack.push(...(outgoing.get(node) ?? []));
  }
  return false;
}

/** 연결 가능 여부 — 불가하면 사람이 읽을 이유를 함께 돌려준다. */
export function checkConnection(
  spec: AgentSpec,
  source: EdgeEndpoint,
  target: EdgeEndpoint,
  registry: Record<string, NodeType> = nodeTypes,
): ConnectionCheck {
  const sourcePort = portOf(spec, source, "outputs", registry);
  if ("missing" in sourcePort) return { ok: false, reason: sourcePort.missing };

  const targetPort = portOf(spec, target, "inputs", registry);
  if ("missing" in targetPort) return { ok: false, reason: targetPort.missing };

  // TODO: 완전한 JSON Schema subsumption은 범위 밖 — 지금은 최상위 `type`만 비교한다.
  const sourceType = schemaType(sourcePort.schema);
  const targetType = schemaType(targetPort.schema);
  if (
    sourceType !== undefined &&
    targetType !== undefined &&
    !sameType(sourceType, targetType)
  ) {
    // 자료형 원문 대신 쉬운 말로 옮겨 말한다 — 옮길 말이 없으면 이름 없이 다르다고만 말한다.
    const sourceWord = typeWord(sourceType);
    const targetWord = typeWord(targetType);
    const ports = { source: source.port, target: target.port };
    return {
      ok: false,
      reason:
        sourceWord && targetWord
          ? msg("connection.typeMismatch", { ...ports, sourceWord, targetWord })
          : msg("connection.typeMismatch.unnamed", ports),
    };
  }

  // 서버가 저장할 때 거절할 것은 그릴 때 거절한다 (DESIGN §9).
  if (comesBackAround(spec, source.node, target.node)) {
    return { ok: false, reason: msg("connection.cycle") };
  }
  return { ok: true };
}
