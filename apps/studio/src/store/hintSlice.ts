// 연결이 왜 안 되는지 손이 있는 자리에서 말하는 채널 (DESIGN §7 connection-hint).
// 여기에는 한 번에 하나만 담긴다 — 새 안내가 오면 갈아탄다. 스스로 사라지는 일은 화면이 맡는다.
import type { StateCreator } from "zustand";
import type { PortAddress } from "../canvas/portLink";
import type { Tone } from "../canvas/toneMark";
import type { FlowEdge, FlowNode } from "../graph/serialize";
import type { Position } from "../history/graphCommands";
import { type Message, msg } from "../i18n/messages";
import type { EditorState } from "./editor";

/** 거절은 danger, 이대로는 이을 곳이 없다는 알림은 warn — 잘 됐다는 말은 이 카드가 하지 않는다. */
export type HintTone = Exclude<Tone, "ok">;

export interface ConnectionHint {
  message: Message;
  tone: HintTone;
  /** 손이 있던 자리 — 캔버스 표면 안의 화면 좌표 */
  at: Position;
  /**
   * 이 말이 가리키는 포트 (의미 앵커). 화면이 그 포트를 찾아내면 그 곁에 서고,
   * 아직 그려지지 않았으면 손이 있던 자리에서 말한다 — 좌표 계산은 화면의 몫이다.
   */
  port?: PortAddress;
}

/**
 * 갓 놓인 노드에게 건넬 초대 — 할 말이 없으면 null (DESIGN §7 첫 연결 초대).
 * 이미 이어 본 그래프에서는 말하지 않는다: 기억해 둔 상태가 아니라 그래프에서 나오는 사실이다.
 * 끌 점이 없는 노드에게 끌어 보라고 하지도 않는다.
 * 서는 자리는 **첫 출력 포트**로 가리킨다 — 그 포트가 화면 어디에 있는지는 화면이 잰다.
 */
export function firstLinkInvite(
  node: FlowNode,
  edges: FlowEdge[],
  at: Position,
): ConnectionHint | null {
  const firstOutput = Object.keys(node.data.ports.outputs)[0];
  if (edges.length > 0 || firstOutput === undefined) return null;
  return {
    message: msg("hint.firstLink"),
    tone: "warn",
    at,
    port: { nodeId: node.id, portId: firstOutput, side: "source" },
  };
}

export interface HintSlice {
  connectionHint: ConnectionHint | null;
  showConnectionHint: (hint: ConnectionHint) => void;
  clearConnectionHint: () => void;
  /**
   * 노드를 놓은 입구가 어디였든(팔레트·피커) 초대는 이 한 자리에서 선다 — 규칙도 여기 하나뿐이다.
   * `at`은 그 포트를 화면에서 찾지 못했을 때 설 자리다(손이 있던 자리).
   */
  inviteFirstLink: (node: FlowNode, at: Position) => void;
}

export const createHintSlice: StateCreator<EditorState, [], [], HintSlice> = (
  set,
  get,
) => ({
  connectionHint: null,

  showConnectionHint: (hint) => set({ connectionHint: hint }),

  clearConnectionHint: () => set({ connectionHint: null }),

  inviteFirstLink: (node, at) => {
    const invite = firstLinkInvite(node, get().edges, at);
    if (invite) set({ connectionHint: invite });
  },
});
