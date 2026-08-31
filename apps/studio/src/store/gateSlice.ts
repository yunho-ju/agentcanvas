// 밸브 앞의 카드가 지금 무엇을 묻고 있는가 — 열려 있는가, 한 번 더 묻는 중인가.
// 사람의 답이 실행에 이벤트로 이어지는 일은 runSlice가 한다: 여기 있는 것은 물음의 상태뿐이다.
import type { StateCreator } from "zustand";
import { type GateToolAsk, gateSchemaRefIn, gateToolAskIn } from "../run/gateAsk";
import type { EditorState } from "./editor";

export type { GateToolAsk } from "../run/gateAsk";
import { awaitingGate } from "./runSlice";

export interface GateSlice {
  /** 사람 확인을 청하는 카드가 열려 있는가 — 닫아 두고 그래프를 살펴볼 수 있다 */
  gateCardOpen: boolean;
  /** 거절하겠다는 뜻을 한 번 더 묻는 중인가 — 되돌릴 수 없는 답이라 다시 묻는다 */
  confirmingReject: boolean;
  /** 확인 카드를 열거나 닫는다 — 닫아도 실행은 멈춘 채로 남는다 */
  setGateCardOpen: (open: boolean) => void;
  /** 거절하겠다고 말했다 — 아직 아무 답도 하지 않았고, 카드가 한 번 더 묻는다 */
  askToReject: () => void;
  /** 다시 묻는 물음을 무른다 — 원래의 물음으로 돌아간다 */
  cancelReject: () => void;
}

/** 카드가 사람에게 무언가를 묻고 있는가 — 열려 있고, 기다리는 밸브가 있을 때다. */
export function gateIsAsking(state: EditorState): boolean {
  return state.gateCardOpen && awaitingGate(state) !== null;
}

/**
 * 기다리는 밸브가 요구한 입력 양식의 이름 — 확인을 청한 사건에 적혀 있다.
 * 읽는 규칙은 대화 화면과 같은 자리(run/gateAsk)에 있다 — 같은 밸브가 두 화면에서 다른 말을 하지 않는다.
 */
export function gateSchemaRef(state: EditorState): string {
  const nodeId = awaitingGate(state);
  return nodeId ? gateSchemaRefIn(state.runEvents, nodeId) : "";
}

/** 그 물음이 "정말 거절할까요"인가 — Esc가 가장 먼저 무르는 자리다 (DESIGN §1 ①). */
export function gateIsConfirmingReject(state: EditorState): boolean {
  return gateIsAsking(state) && state.confirmingReject;
}

/**
 * 도구를 부르기 전 사람 확인이라면, 무엇을 승인하는지 — 어느 도구이고 무엇을 하는지.
 * 무엇을 물을지는 화면이 아니라 RunEvent의 사실이다 (규칙은 run/gateAsk가 쥔다).
 */
export function gateToolAsk(state: EditorState): GateToolAsk | null {
  const nodeId = awaitingGate(state);
  if (!nodeId) return null;
  return gateToolAskIn(state.runEvents, nodeId, state.spec?.resources ?? []);
}

export const createGateSlice: StateCreator<EditorState, [], [], GateSlice> = (set, get) => ({
  gateCardOpen: false,
  confirmingReject: false,

  // 카드를 접으면 다시 묻던 물음도 함께 접힌다 — 다시 열었을 때 원래의 물음부터 시작한다.
  // 다른 실행을 보러 갈 때 카드를 처음으로 되돌리는 일도 이 한 가지 전이로 끝난다.
  setGateCardOpen: (open) => set({ gateCardOpen: open, confirmingReject: false }),

  askToReject: () => {
    if (!awaitingGate(get())) return;
    set({ confirmingReject: true });
  },

  cancelReject: () => set({ confirmingReject: false }),
});
