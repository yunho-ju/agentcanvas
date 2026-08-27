// 이 노드는 아직 손볼 곳이 있는가 — 카드의 "설정 필요" 뱃지와 실행 전 검증이 함께 보는 판정.
// Python `agentcanvas_contracts.node_registry.config_issues`의 broken bindings 규칙을 품고,
// config_schema가 요구하는(required) 값이 비었는지까지 함께 본다. 순수 함수다.
import type { Node1 as SpecNode } from "../generated/agent_spec";
import type { NodeType } from "../generated/node_type";
import { type Message, msg } from "../i18n/messages";
import { fieldTitle } from "../inspector/schemaForm";
import { INPUT_NODE_TYPE } from "../registry/registry";
import type { FlowNode } from "./serialize";

export interface SetupIssue {
  /** 어느 설정 항목의 이야기인가 — inspector의 그 자리로 데려가는 데 쓴다 */
  field: string | null;
  /** 사람이 읽을 한 줄 */
  message: Message;
}

function isBlank(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === "string") return value.trim() === "";
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === "object") return Object.keys(value).length === 0;
  return false;
}

/** 설정 항목의 사람 이름 — 폼이 라벨을 고르는 규칙(schemaForm)을 그대로 쓴다. */
function titleOf(nodeType: NodeType, field: string) {
  const properties = (nodeType.config_schema as { properties?: unknown }).properties;
  const property =
    typeof properties === "object" && properties !== null
      ? (properties as Record<string, unknown>)[field]
      : undefined;
  return typeof property === "object" && property !== null
    ? fieldTitle(property as Record<string, unknown>, field)
    : { ko: field, en: field };
}

function requiredFields(nodeType: NodeType): string[] {
  const required = (nodeType.config_schema as { required?: unknown }).required;
  return Array.isArray(required) ? required.filter((name) => typeof name === "string") : [];
}

/** core.input의 bindings가 포트를 만들 수 있는 모양인가 (Python config_issues 미러). */
function bindingIssues(value: unknown): SetupIssue[] {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return [{ field: "bindings", message: msg("setup.bindings.shape") }];
  }
  return Object.entries(value).flatMap(([key, path]) => {
    if (key.trim() === "") {
      return [{ field: "bindings", message: msg("setup.bindings.emptyName") }];
    }
    if (typeof path !== "string") {
      return [{ field: "bindings", message: msg("setup.bindings.path", { name: key }) }];
    }
    return [];
  });
}

/** 이 노드가 아직 설정을 기다리는 이유들. 비어 있으면 준비가 끝난 노드다. */
export function nodeSetupIssues(node: SpecNode, nodeType?: NodeType): SetupIssue[] {
  if (!nodeType) {
    return [{ field: null, message: msg("setup.unknownType", { type: node.type }) }];
  }
  const config = (node.config ?? {}) as Record<string, unknown>;

  return requiredFields(nodeType).flatMap((field) => {
    const value = config[field];
    if (isBlank(value)) {
      return [{ field, message: msg("setup.empty", { title: titleOf(nodeType, field) }) }];
    }
    if (nodeType.type === INPUT_NODE_TYPE && field === "bindings") {
      return bindingIssues(value);
    }
    return [];
  });
}

/** 캔버스에서 확인이 필요한 노드들 — 집계 pill과 실행 전 검증이 세는 대상. */
export function nodesNeedingSetup(nodes: FlowNode[]): FlowNode[] {
  return nodes.filter(
    (node) => nodeSetupIssues(node.data.spec, node.data.nodeType).length > 0,
  );
}
