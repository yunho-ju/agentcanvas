// 모양의 템플릿이 가리키는 앵커가 이 문서의 어느 단계가 되는가 (순수 함수, 설계 문서 D12).
// 규칙은 엔진의 fill_template과 하나다 — examples/pattern-anchors/cases.json이 둘을 맞춰 본다.
// 자리 정하기는 여기 없다: 뷰포트는 화면만 아는 것이라 graph/patternPlacement.ts의 일이다.
import type { AgentSpec, Node1 as SpecNode, Resources } from "../generated/agent_spec";
import type { PatchTemplate, TemplateOp } from "../generated/pattern_def";
import { ANCHOR_NODE_TYPES } from "../registry/patternCatalog";
import { bindingRefs, nodeTypes } from "../registry/registry";

// 엔진의 CannotFillReason과 같은 이름들이다. 도구 사정이 둘인 것은 사람이 할 일이 다르기
// 때문이다: 고르기(needs_tools)와 만들기(no_tools_anywhere)는 같은 말을 쓸 수 없다.
export type CannotPutReason =
  | "missing_node"
  | "ambiguous_anchor"
  | "needs_tools"
  | "no_tools_anywhere"
  | "unknown_port";

/** 채워진 앵커 → 이 문서의 노드 id. */
export type Anchors = Record<string, string>;

/** 놓을 수 없다는 답 — 어느 앵커에서 걸렸는지까지 말한다. */
export interface CannotPut {
  cannot: CannotPutReason;
  anchor: string;
}

/** 앵커를 읽는 데 필요한 문서 — 놓인 단계와 이 문서가 든 연결뿐이다. */
export interface AnchorDoc {
  nodes: AgentSpec["nodes"];
  resources?: Resources;
}

/** 이 노드가 실제로 손이 닿는 연결을 하나라도 들고 있는가 (엔진의 reaches_for_tools). */
function reachesForTools(node: SpecNode, doc: AnchorDoc): boolean {
  const nodeType = nodeTypes[node.type];
  if (!nodeType) return false;
  const wanted = bindingRefs(node, nodeType);
  return (doc.resources ?? []).some((resource) => wanted.includes(resource.id));
}

/** 템플릿에서 이 노드에게 값을 보내는 앵커들 — 읽는 순서로는 이 노드 **앞**에 선다. */
export function feedersOf(anchor: string, template: PatchTemplate): string[] {
  const drawn = template.filter((op) => op.op === "add_edge");
  return drawn.filter((op) => op.target.node === anchor).map((op) => op.source.node);
}

/** 템플릿이 이 새 노드를 무엇과 무엇 사이에 넣는지 — 들어오는 쪽 먼저, 나가는 쪽 다음. */
export function neighboursOf(anchor: string, template: PatchTemplate): string[] {
  const drawn = template.filter((op) => op.op === "add_edge");
  return [
    ...feedersOf(anchor, template),
    ...drawn.filter((op) => op.source.node === anchor).map((op) => op.target.node),
  ];
}

/** 한 작업이 문서에 묻는 것 — 어느 앵커를 어떤 차례로 읽고, 그 단계에 무엇이 갖춰져야 하는가. */
interface Reading<Op extends TemplateOp> {
  anchors: (op: Op, template: PatchTemplate) => string[];
  lacks?: (node: SpecNode, doc: AnchorDoc) => CannotPutReason | null;
}

type Readings = {
  [Kind in TemplateOp["op"]]: Reading<Extract<TemplateOp, { op: Kind }>>;
};

// 새 작업이 생기면 이 표에 한 줄을 더한다 — 아래 판정은 그대로다 (OCP).
const READINGS: Readings = {
  add_node: { anchors: (op, template) => neighboursOf(op.node, template) },
  replace_node_config: { anchors: (op) => [op.node] },
  requires_tools: {
    anchors: (op) => [op.node],
    lacks: (node, doc) => {
      if (reachesForTools(node, doc)) return null;
      const somethingToPick = (doc.resources ?? []).some(
        (resource) => (resource.tools ?? []).length > 0,
      );
      return somethingToPick ? "needs_tools" : "no_tools_anywhere";
    },
  },
  add_edge: { anchors: (op) => [op.source.node, op.target.node] },
  remove_edge: { anchors: (op) => [op.source, op.target] },
};

/** 이 앵커가 설 단계 — 고른 것, 아니면 그 종류의 단 하나. 여럿이면 지어내지 않는다. */
function stands(
  anchor: string,
  doc: AnchorDoc,
  selectedId: string | null,
): SpecNode | CannotPutReason {
  const wanted = ANCHOR_NODE_TYPES[anchor];
  const standing = doc.nodes.filter((node) => node.type === wanted);
  const picked = standing.find((node) => node.id === selectedId);
  if (picked) return picked;
  if (standing.length === 0) return "missing_node";
  if (standing.length > 1) return "ambiguous_anchor";
  return standing[0];
}

/**
 * 템플릿의 앵커를 이 문서의 단계로 바꾼다 — 못 바꾸면 예외가 아니라 그 까닭을 돌려준다.
 * `selectedId`는 사람이 고른 단계다: 종류가 맞는 앵커만 그 단계가 되고, 나머지는 문서에
 * 그 종류가 하나일 때만 선다. 템플릿이 새로 놓는 앵커(`{new:...}`)는 여기 오르지 않는다.
 */
export function resolveAnchors(
  template: PatchTemplate,
  doc: AnchorDoc,
  selectedId: string | null,
): Anchors | CannotPut {
  const found: Anchors = {};
  for (const op of template) {
    // 표에 **적어 둔** 작업만 문서에 무언가를 묻는다 — 물려받은 이름은 표의 것이 아니다.
    if (!Object.hasOwn(READINGS, op.op)) continue;
    const reading = READINGS[op.op] as Reading<TemplateOp>;
    for (const anchor of reading.anchors(op, template)) {
      // 표에 적어 둔 앵커만 문서의 단계를 가리킨다 (물려받은 이름은 표의 것이 아니다).
      if (!Object.hasOwn(ANCHOR_NODE_TYPES, anchor)) continue;
      const standing = stands(anchor, doc, selectedId);
      if (typeof standing === "string") return { cannot: standing, anchor };
      found[anchor] = standing.id;
      const lacking = reading.lacks?.(standing, doc);
      if (lacking) return { cannot: lacking, anchor };
    }
  }
  return found;
}

/** 이 답이 "놓을 수 없다"인가 — 답과 까닭을 가르는 자리는 하나뿐이다. */
export function cannotPut<Answer extends object>(
  answer: Answer | CannotPut,
): answer is CannotPut {
  return "cannot" in answer;
}
