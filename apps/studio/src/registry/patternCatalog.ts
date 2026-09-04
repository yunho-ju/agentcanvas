// 이 서버가 문서에 놓아 줄 수 있는 모양들을 화면이 읽는 모양으로 옮기는 규칙
// (registry/modelOptions.ts와 같은 문법 — 어긋난 답은 아는 척하지 않고 모른다고 한다).
import type { NodeType } from "../generated/node_type";
import type {
  AddEdgeTemplateOp,
  AddNodeTemplateOp,
  EdgeKind,
  LocalizedText,
  Needs,
  PatchTemplate,
  TemplateEndpoint,
  TemplateOp,
} from "../generated/pattern_def";
import { nodeTypes } from "./registry";

/** 앵커의 생김새 — 계약의 ANCHOR_PATTERN과 같은 규칙이다(생성 타입은 글자 모양을 싣지 않는다). */
const ANCHOR = /^\{(agent|input|output|new:[a-z][a-z0-9_]*)\}$/;

const EDGE_KINDS: EdgeKind[] = ["data", "control", "approval"];

/** 앵커가 찾는 단계의 종류 (계약의 ANCHOR_NODE_TYPES) — 이 표에 없는 앵커는 템플릿이 새로 놓는 자리다. */
export const ANCHOR_NODE_TYPES: Record<string, string> = {
  "{agent}": "llm.agent",
  "{input}": "core.input",
  "{output}": "core.output",
};

/** "그 단계의 첫 포트" — 받는 값의 이름을 문서가 정하는 단계를 가리킬 때 쓴다 (계약의 ANY_PORT). */
export const ANY_PORT = "*";

const CAPABILITIES: Needs = ["tool_calling", "human_gate", "router"];

/** 화면이 부르는 모양 하나 — 목록에 서는 이름과 대가, 그리고 문서에 놓는 방법. */
export interface PatternChoice {
  id: string;
  shortName: LocalizedText;
  /** 이 모양을 놓으면 무엇을 치르는가 — 목록의 한 줄이 그대로 읽는다 */
  cost: LocalizedText;
  /** 이 모양이 서려면 서버가 해낼 수 있어야 하는 것들 */
  needs: Needs;
  template: PatchTemplate;
}

/** 이 템플릿 안에서 이 앵커가 서는 단계의 종류 — 새로 놓는 자리는 그 작업이, 나머지는 앵커가 말한다. */
function nodeTypeOf(anchor: string, template: PatchTemplate): NodeType | undefined {
  const placed = template.find((op) => op.op === "add_node" && op.node === anchor);
  if (placed?.op === "add_node") return nodeTypes[placed.type];
  return Object.hasOwn(ANCHOR_NODE_TYPES, anchor)
    ? nodeTypes[ANCHOR_NODE_TYPES[anchor]]
    : undefined;
}

/** 이 화면이 그 손잡이를 그리는가 — `*`는 문서가 정하는 자리라 registry에게 묻지 않는다. */
function drawsThePort(
  endpoint: TemplateEndpoint,
  side: "inputs" | "outputs",
  template: PatchTemplate,
): boolean {
  if (endpoint.port === ANY_PORT) return true;
  const nodeType = nodeTypeOf(endpoint.node, template);
  return (nodeType?.ports[side] ?? []).some((port) => port.id === endpoint.port);
}

// 이 화면이 그 작업을 그릴 수 있는지 묻는 자리 — 표에 없는 작업은 그릴 수 없다 (OCP).
const DRAWABLE: Record<
  TemplateOp["op"],
  (op: never, template: PatchTemplate) => boolean
> = {
  add_node: (op: AddNodeTemplateOp) => op.type in nodeTypes,
  replace_node_config: () => true,
  requires_tools: () => true,
  add_edge: (op: AddEdgeTemplateOp, template) =>
    drawsThePort(op.source, "outputs", template) &&
    drawsThePort(op.target, "inputs", template),
  remove_edge: () => true,
};

/**
 * 이 화면이 그릴 줄 아는 모양인가 — 이 build의 registry에 없는 단계나 손잡이를 쓰는 모양은 아니다.
 * 반만 놓인 모양은 조용한 실패다: 놓을 수 없는 줄은 아예 세우지 않는다.
 */
export function thisScreenCanDraw(pattern: PatternChoice): boolean {
  return pattern.template.every((op) => {
    if (!Object.hasOwn(DRAWABLE, op.op)) return false;
    const draws = DRAWABLE[op.op] as (op: TemplateOp, template: PatchTemplate) => boolean;
    return draws(op, pattern.template);
  });
}

/**
 * 서버 답을 읽는다 — 목록 자체가 어긋나면 모른다고 한다(null).
 * 못 읽는 줄 하나는 건너뛴다: 이 서버가 이 화면보다 새로울 수 있고, 모르는 모양 하나 때문에
 * 아는 모양들까지 목록에서 사라지면 이미 서 있던 자리(고치기 패널의 이름)까지 잃는다.
 */
export function serverPatternsOf(body: unknown): PatternChoice[] | null {
  if (!body || typeof body !== "object") return null;
  const said = body as { patterns?: unknown };
  if (!Array.isArray(said.patterns)) return null;
  return said.patterns
    .map(asPatternChoice)
    .filter((pattern): pattern is PatternChoice => pattern !== null);
}

function asPatternChoice(item: unknown): PatternChoice | null {
  const said = asRecord(item);
  if (!said) return null;
  const shortName = asLocalizedText(said.short_name);
  const cost = asLocalizedText(said.cost);
  const needs = asNeeds(said.needs);
  const template = asTemplate(said.template);
  if (typeof said.id !== "string" || !shortName || !cost || !needs || !template) {
    return null;
  }
  return { id: said.id, shortName, cost, needs, template };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asLocalizedText(value: unknown): LocalizedText | null {
  const text = asRecord(value);
  if (!text || typeof text.ko !== "string" || typeof text.en !== "string") return null;
  return { ko: text.ko, en: text.en };
}

function asNeeds(value: unknown): Needs | null {
  if (!Array.isArray(value)) return null;
  const needs = value.filter((needed): needed is Needs[number] =>
    CAPABILITIES.includes(needed as Needs[number]),
  );
  return needs.length === value.length ? needs : null;
}

function isAnchor(value: unknown): boolean {
  return typeof value === "string" && ANCHOR.test(value);
}

function isEndpoint(value: unknown): value is TemplateEndpoint {
  const said = asRecord(value);
  return !!said && isAnchor(said.node) && typeof said.port === "string";
}

// 새 작업이 계약에 생기면 이 표에 한 줄을 더한다 — 아래 읽기는 그대로다 (OCP).
const OP_SHAPES: Record<TemplateOp["op"], (said: Record<string, unknown>) => boolean> = {
  add_node: (said) =>
    isAnchor(said.node) && typeof said.type === "string" && !!asRecord(said.config),
  replace_node_config: (said) => isAnchor(said.node) && !!asRecord(said.config),
  requires_tools: (said) => isAnchor(said.node),
  add_edge: (said) =>
    EDGE_KINDS.includes(said.kind as EdgeKind) &&
    isEndpoint(said.source) &&
    isEndpoint(said.target),
  remove_edge: (said) => isAnchor(said.source) && isAnchor(said.target),
};

/** 템플릿은 한 작업이라도 못 읽으면 통째로 모른다 — 반만 놓는 편집을 만들지 않는다. */
function asTemplate(value: unknown): PatchTemplate | null {
  if (!Array.isArray(value)) return null;
  const template: PatchTemplate = [];
  for (const item of value) {
    const said = asRecord(item);
    // 표에 **적어 둔** 이름만 작업이다 — 물려받은 이름(constructor 따위)은 표의 것이 아니다.
    if (!said || typeof said.op !== "string" || !Object.hasOwn(OP_SHAPES, said.op)) {
      return null;
    }
    if (!OP_SHAPES[said.op as TemplateOp["op"]](said)) return null;
    template.push(said as unknown as TemplateOp);
  }
  return template;
}
