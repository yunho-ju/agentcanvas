// 고칠 자리를 파생하는 규칙 (순수 함수) — 쌓인 이벤트에서 매번 다시 읽는다.
// "점수가 아니라 고칠 자리": 여기서 나오는 것은 개수도 점수도 아니라 다음에 무엇을 볼지다.
// 새 판정 뿌리를 만들지 않는다 — 멈춤은 서버가 매긴 마지막 상태(run_status), 도구가 어그러진
// 자리는 toolFellShort, 말의 끝은 실시간 대화와 같은 chatTurnEnd가 읽는다.
import type { ThreadStatus, ThreadTurn } from "../api/threads";
import type { AgentSpec } from "../generated/agent_spec";
import type { RunEvent } from "../generated/run_event";
import { type ToolTrouble, toolTroubleIn } from "../run/eventWords";
import { toolFellShort } from "../run/player";
import { type ChatTurnEnd, chatTurnEnd } from "./chatTurn";
import { restoredTurns } from "./threadHistory";

/**
 * 한 대화에서 다음에 볼 자리 하나.
 * 갈래마다 무엇을 아는지가 달라 유니온으로 둔다 — 빈 칸을 지어내 채우지 않는다.
 */
export type FixSpot =
  | { kind: "heldForCheck" }
  | {
      kind: "toolFailed";
      /** 어느 연결에서 부른 도구인가 — 옛 사건이 적어 두지 않았으면 없다 */
      resource: string | null;
      tool: string | null;
      /** 무슨 갈래로 어그러졌는가 — 우리가 모르는 갈래면 없다(지어내지 않는다) */
      trouble: ToolTrouble | null;
    }
  | { kind: "unfinished" }
  | { kind: "abandoned" }
  | { kind: "askedAgain" };

export type FixSpotKind = FixSpot["kind"];

/**
 * 사람이 기다리기를 그만둬 끝난 실행이 남기는 까닭 (api/run_service RUN_WAS_CANCELLED).
 * 실패 갈래 사전(FAILURE_REASONS)에 없다 — 고장이 아니라 사람의 결정이기 때문이다.
 */
const STOPPED_BY_PERSON = "cancelled";

function textIn(payload: unknown, key: string): string | null {
  if (typeof payload !== "object" || payload === null) return null;
  const value = (payload as Record<string, unknown>)[key];
  return typeof value === "string" ? value : null;
}

/** 도구가 답을 못 가져온 사건 하나를 고칠 자리 하나로 — 갈래를 좁히는 일은 실행 화면과 한 자리다. */
function toolSpotOf(event: RunEvent): FixSpot {
  return {
    kind: "toolFailed",
    resource: textIn(event.payload, "resource_ref"),
    tool: textIn(event.payload, "tool_name"),
    trouble: toolTroubleIn(event),
  };
}

/**
 * 도구가 답을 못 가져온 자리들 — 같은 연결·같은 도구·같은 갈래는 한 번만 말한다.
 * 한 대화에서 열 번 어그러진 것을 열 줄로 세면 무엇을 고칠지가 오히려 묻힌다.
 */
function toolsThatFellShort(turns: ThreadTurn[]): FixSpot[] {
  const found = new Map<string, FixSpot>();
  for (const turn of turns) {
    for (const event of turn.events) {
      if (!toolFellShort(event)) continue;
      const spot = toolSpotOf(event);
      const same = JSON.stringify(spot);
      if (!found.has(same)) found.set(same, spot);
    }
  }
  return [...found.values()];
}

/** 사람이 기다리기를 그만둔 말인가 — 실패로 뭉뚱그리지 않기 위해 따로 읽는다. */
function stoppedByPerson(events: RunEvent[]): boolean {
  return events.some(
    (event) =>
      event.event_type === "run.failed" &&
      textIn(event.payload, "reason") === STOPPED_BY_PERSON,
  );
}

/**
 * 이 대화가 어떻게 끝났는가 — 답을 받지 못한 채 끝났거나, 사람이 그만뒀거나.
 * 아직 끝나지 않은 말은 아무 말도 하지 않는다(끝나지 않은 것은 아직 사실이 아니다).
 */
function howItEnded(events: RunEvent[], end: ChatTurnEnd | null | undefined): FixSpot[] {
  if (!end) return [];
  if (stoppedByPerson(events)) return [{ kind: "abandoned" }];
  return end.kind === "failed" || end.kind === "silent" ? [{ kind: "unfinished" }] : [];
}

/**
 * 답을 받지 못한 말 뒤에 사람이 또 말한 자리가 있는가 (브리프가 고정한 근사 정의).
 * 글자를 견주어 "같은 질문을 반복했다"고 판정하지 않는다 — 화면 문구도 이 정의대로 말한다.
 */
function saidAgainAfterNoAnswer(ends: (ChatTurnEnd | null)[]): boolean {
  return ends.slice(0, -1).some((end) => end !== null && end.kind !== "answer");
}

/**
 * 이 대화에서 다음에 볼 자리들 — 아무 데도 걸리지 않으면 빈 목록이다(조용한 성공).
 * 판은 이 대화가 붙잡은 판을 건네받는다: 어느 노드가 답하는지는 판이 정하기 때문이다.
 */
export function fixSpotsIn(
  spec: AgentSpec,
  status: ThreadStatus,
  turns: ThreadTurn[],
): FixSpot[] {
  const said = restoredTurns(turns);
  const ends = said.map((turn) => chatTurnEnd(spec, turn));
  const last = turns.at(-1);
  return [
    ...(status === "paused" ? [{ kind: "heldForCheck" as const }] : []),
    ...toolsThatFellShort(turns),
    ...(last ? howItEnded(last.events, ends.at(-1)) : []),
    ...(saidAgainAfterNoAnswer(ends) ? [{ kind: "askedAgain" as const }] : []),
  ];
}
