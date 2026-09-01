// 대화 한 마디를 시험 케이스 초안으로 옮기는 규칙 (순수 함수) — 실패 실행을 승격하던 길의 형제다.
// 옮기는 것은 사실뿐이다: 그 말이 열린 실행에 실렸던 값과, 그 말이 실제로 받은 답.
// 기대 문구는 여기서 짓지 않는다 — 담기 전에는 저장이 아니고, 무엇을 기대할지는 사람이 정한다.
import type { AgentSpec } from "../generated/agent_spec";
import { inputFromRunStarted } from "../run/runRecord";
import { type ChatTurnState, chatTurnEnd } from "./chatTurn";

/** 대화에서 가져온 시험 초안의 씨앗. */
export interface ChatCaseSeed {
  /** 그 실행이 열릴 때 실렸던 값 그대로 — 지난 대화(history)까지 함께 온다 */
  input: Record<string, unknown>;
  /** 그 말이 실제로 받은 답 — 답이 없던 말에는 후보를 지어내지 않는다(null) */
  answer: string | null;
}

export function chatCaseSeed(spec: AgentSpec, turn: ChatTurnState): ChatCaseSeed {
  const end = chatTurnEnd(spec, turn);
  return {
    input: inputFromRunStarted(turn.events),
    answer: end?.kind === "answer" ? end.text : null,
  };
}
