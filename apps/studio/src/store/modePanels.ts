// 우측 기둥의 자리는 하나다 — 시험·고치기·대화 가운데 무엇이 서 있는가 (DESIGN §1 배치표).
// 이 사실을 세 곳에서 따로 세지 않도록 술어 하나로 모은다.
// (모드 버튼의 '눌린 자리' 판정(shell/modePressed)과는 물음이 다르다 — 그쪽은 '보이는 모드가 무엇인가'다.
//  둘이 같은 사실을 두 번 말하는 것으로 드러나면 그때 한 자리로 합친다.)
import type { EditorState } from "./editor";

/** 지금 우측 기둥에 모드 패널이 서 있는가. */
export function modePanelOpen(state: EditorState): boolean {
  return state.evalPanelOpen || state.chatOpen || state.optimizeMode !== "closed";
}
