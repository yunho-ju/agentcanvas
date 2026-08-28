// 되돌리기가 다루는 전부 — 캔버스 위의 그래프와, 빼 둔 블록을 담은 보관함, 그리고 문서 이름.
// 보관함은 이번 편집 시간 동안만 있는 것이라 AgentSpec에는 들어가지 않는다.
// 이름은 AgentSpec에 적히지만 캔버스 위에 있지 않다 — 되돌릴 수 있어야 하므로 여기 함께 온다.
import type { AgentSpec, ResourceBinding } from "../generated/agent_spec";
import type { FlowGraph, FlowNode } from "./serialize";

export interface Scene extends FlowGraph {
  tray: FlowNode[];
  name: string | null;
  /** 이 문서가 가진 연결들 — AgentSpec에 적히지만 캔버스 위에 있지 않다 (이름과 같은 자리) */
  resources: ResourceBinding[];
}

/** 되돌리기가 다루는 것들이 지금 화면 어디에 있는가 — 짓는 자리는 여기 하나뿐이다. */
export function sceneOf(state: {
  nodes: FlowNode[];
  edges: FlowGraph["edges"];
  tray: FlowNode[];
  spec: AgentSpec | null;
}): Scene {
  return {
    nodes: state.nodes,
    edges: state.edges,
    tray: state.tray,
    name: state.spec?.name ?? null,
    resources: state.spec?.resources ?? [],
  };
}
