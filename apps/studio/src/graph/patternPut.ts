// 모양의 템플릿을 이 문서에 실제로 놓는다 (순수 함수) — 카드도 선도 설정도 한 번에.
// 앵커가 어느 단계인지는 patternAnchors가 이미 답했고, 새 카드의 자리는 patternPlacement가
// 정했다. 여기서는 그 답들을 장면 하나로 만든다 — 못 만들면 예외가 아니라 까닭을 돌려준다.
import type { PatchTemplate, TemplateOp } from "../generated/pattern_def";
import { ANY_PORT } from "../registry/patternCatalog";
import { nodeTypes } from "../registry/registry";
import { withNodeConfig } from "./config";
import { newNode } from "./draft";
import { uniqueId } from "./ids";
import { type Anchors, type CannotPut, cannotPut } from "./patternAnchors";
import type { PlacedCard } from "./placement";
import type { Scene } from "./scene";

/** 놓는 동안의 이름표 — 앵커가 어느 카드가 되었고, 새 카드는 어디에 앉는가. */
interface Naming {
  named: Anchors;
  spots: Record<string, PlacedCard["position"]>;
}

type Putting<Op extends TemplateOp> = (
  scene: Scene,
  op: Op,
  at: Naming,
) => Scene | CannotPut;

type Puttings = {
  [Kind in TemplateOp["op"]]: Putting<Extract<TemplateOp, { op: Kind }>>;
};

/** 이 포트로 이으라 — 이름을 적은 자리면 그 이름, `*`면 그 카드의 첫 포트다. */
function portOf(
  scene: Scene,
  nodeId: string,
  port: string,
  side: "inputs" | "outputs",
): string | null {
  if (port !== ANY_PORT) return port;
  const node = scene.nodes.find((candidate) => candidate.id === nodeId);
  return Object.keys(node?.data.ports[side] ?? {})[0] ?? null;
}

// 새 작업이 계약에 생기면 이 표에 한 줄을 더한다 — 아래 놓기는 그대로다 (OCP).
const PUTTINGS: Puttings = {
  add_node: (scene, op, at) => {
    const node = newNode(
      nodeTypes[op.type],
      at.spots[op.node],
      scene.nodes.map((card) => card.id),
      { ...op.config },
      scene.resources,
    );
    at.named[op.node] = node.id;
    return { ...scene, nodes: [...scene.nodes, node] };
  },

  replace_node_config: (scene, op, at) => {
    const id = at.named[op.node];
    const standing = scene.nodes.find((node) => node.id === id);
    // 템플릿의 값은 이 문서가 이미 적어 둔 설정 위에 얹는다 — 고른 모델을 잃지 않는다.
    const config = { ...standing?.data.spec.config, ...op.config };
    return {
      ...scene,
      ...withNodeConfig(scene, id, config, scene.input_schema, scene.resources).graph,
    };
  },

  requires_tools: (scene) => scene,

  add_edge: (scene, op, at) => {
    const source = at.named[op.source.node];
    const target = at.named[op.target.node];
    const sourceHandle = portOf(scene, source, op.source.port, "outputs");
    const targetHandle = portOf(scene, target, op.target.port, "inputs");
    if (sourceHandle === null) return { cannot: "unknown_port", anchor: op.source.node };
    if (targetHandle === null) return { cannot: "unknown_port", anchor: op.target.node };
    return {
      ...scene,
      edges: [
        ...scene.edges,
        {
          id: uniqueId(`${source}-${target}`, scene.edges.map((edge) => edge.id)),
          source,
          sourceHandle,
          target,
          targetHandle,
          data: { kind: op.kind },
        },
      ],
    };
  },

  remove_edge: (scene, op, at) => ({
    ...scene,
    edges: scene.edges.filter(
      (edge) =>
        !(edge.source === at.named[op.source] && edge.target === at.named[op.target]),
    ),
  }),
};

/**
 * 이 문서 위에 모양을 놓은 장면 — 놓을 수 없으면 그 까닭을 돌려준다(반만 놓지 않는다).
 * 앵커가 새로 놓는 카드는 놓이면서 이름을 얻고, 뒤따르는 작업들이 그 이름으로 잇는다.
 */
export function putTemplate(
  scene: Scene,
  template: PatchTemplate,
  anchors: Anchors,
  spots: Record<string, PlacedCard["position"]>,
): Scene | CannotPut {
  const at: Naming = { named: { ...anchors }, spots };
  let put = scene;
  for (const op of template) {
    const putting = PUTTINGS[op.op] as Putting<TemplateOp>;
    const next = putting(put, op, at);
    if (cannotPut(next)) return next;
    put = next;
  }
  return put;
}
