// 밸브 앞의 카드가 지금 무엇을 묻고 있는가 — 열려 있는가, 한 번 더 묻는 중인가.
// 사람의 답이 실행에 이벤트로 이어지는 일은 runSlice가 한다: 여기 있는 것은 물음의 상태뿐이다.
import type { StateCreator } from "zustand";
import type { LocalizedText } from "../generated/agent_spec";
import type { EditorState } from "./editor";
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
 * 무엇을 물을지도 화면의 사정이 아니라 RunEvent의 사실이다. 아무도 기다리지 않으면 빈 이름이다.
 */
export function gateSchemaRef(state: EditorState): string {
  const nodeId = awaitingGate(state);
  if (!nodeId) return "";
  const asked = state.runEvents
    .filter(
      (event) =>
        event.event_type === "human.approval_requested" && event.node_id === nodeId,
    )
    .at(-1);
  const ref = asked?.payload.approval_schema_ref;
  return typeof ref === "string" ? ref : "";
}

/** 그 물음이 "정말 거절할까요"인가 — Esc가 가장 먼저 무르는 자리다 (DESIGN §1 ①). */
export function gateIsConfirmingReject(state: EditorState): boolean {
  return gateIsAsking(state) && state.confirmingReject;
}

/** 지금 기다리는 확인이 어느 도구 호출을 위한 것인가 — 도구 승인이 아니면 없다. */
export interface GateToolAsk {
  toolName: string;
  plainDescription?: LocalizedText;
}

/**
 * 도구를 부르기 전 사람 확인이라면, 무엇을 승인하는지 — 어느 도구이고 무엇을 하는지.
 * 무엇을 물을지는 화면이 아니라 RunEvent의 사실이다: 승인 요청 payload가 도구를 가리킨다.
 * 밸브(control.human_gate) 승인이면 도구가 없으므로 없음을 답한다.
 */
export function gateToolAsk(state: EditorState): GateToolAsk | null {
  const nodeId = awaitingGate(state);
  if (!nodeId) return null;
  const asked = state.runEvents
    .filter(
      (event) =>
        event.event_type === "human.approval_requested" && event.node_id === nodeId,
    )
    .at(-1);
  const toolName = asked?.payload.tool_name;
  const resourceRef = asked?.payload.resource_ref;
  if (typeof toolName !== "string" || typeof resourceRef !== "string") return null;
  const tool = (state.spec?.resources ?? [])
    .find((binding) => binding.id === resourceRef)
    ?.tools?.find((one) => one.name === toolName);
  return {
    toolName,
    ...(tool?.plain_description ? { plainDescription: tool.plain_description } : {}),
  };
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
