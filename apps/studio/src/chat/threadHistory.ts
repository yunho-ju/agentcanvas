// 지난 대화를 되짓는 규칙 (순수 함수) — 서버에 쌓인 이벤트에서 오간 말을 매번 다시 파생한다.
// 저장된 결론을 읽지 않는다(실행 기록과 같은 원칙): 사람이 한 말은 그 실행이 열릴 때 실린 값에서
// 오고, 답인지 실패인지 거절인지는 실시간 대화와 **같은** 순수 함수(chatTurnEnd)가 읽는다.
import type { SpecRevision } from "../api/specs";
import type { ThreadTurn } from "../api/threads";
import type { AgentSpec } from "../generated/agent_spec";
import type { RunEvent } from "../generated/run_event";
import { unansweredPause } from "../run/player";
import { inputFromRunStarted } from "../run/runRecord";
import { type ChatTurnState, chatTurnEnd } from "./chatTurn";

/**
 * 사람이 건넨 말이 있는가 — 없거나, 빈 칸뿐이면 없는 것이다.
 * 목록의 제목과 대화의 말풍선이 이 한 판정을 함께 쓴다(한 사실에 두 판정을 두지 않는다).
 */
export function nothingSaid(said: string | null): boolean {
  return said === null || said.trim() === "";
}

/** 이 실행을 연 사람의 말 — 사람이 건넨 것이 아니면 말인 척하지 않는다(빈 말이다). */
function saidIn(events: RunEvent[]): string {
  const said = inputFromRunStarted(events).message;
  return typeof said === "string" ? said : "";
}

/**
 * 대화에 쌓인 이벤트를 화면이 아는 말들로 되짓는다 — 실시간에 쌓이던 것과 같은 모양이다.
 * 그래서 복원된 대화는 실시간과 같은 말풍선 문법으로 서고, 이어 말하기도 그대로 된다.
 */
export function restoredTurns(turns: ThreadTurn[]): ChatTurnState[] {
  return turns.map((turn) => ({
    id: turn.run.id,
    said: saidIn(turn.events),
    runId: turn.run.id,
    events: turn.events,
    halted: null,
  }));
}

/**
 * 이 대화가 지금 다른 곳에서 돌고 있는가 — 끝나지도, 확인을 기다리지도 않은 마지막 말이다.
 * 멈춰 서서 사람을 기다리는 것(밸브)은 진행 중이 아니다: 그 자리에서는 승인 카드가 답을 받는다.
 */
export function runningElsewhere(spec: AgentSpec, turns: ChatTurnState[]): boolean {
  const last = turns.at(-1);
  if (!last) return false;
  return chatTurnEnd(spec, last) === null && unansweredPause(last.events) === null;
}

/** 그 판이 몇 번째 판이었는가 — 판 기록에 없으면 번호를 지어내지 않는다. */
export function versionOfRevision(
  revisions: SpecRevision[],
  revision: string,
): number | null {
  return revisions.find((one) => one.revision === revision)?.version ?? null;
}
