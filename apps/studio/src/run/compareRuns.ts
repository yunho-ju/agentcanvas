// 두 실행을 나란히 놓고 어디서부터 달라지는지 찾는다 (순수 함수 — 예외를 던지지 않는다).
// 실행 이름과 시각은 실행마다 다르므로 견주는 자리에 담지 않는다: 남는 것은 무슨 일이 있었는가뿐이다.
import type { EventType, RunEvent } from "../generated/run_event";
import { type NodeRunStatus, nodeStatesAt } from "./player";

/** 단계 안에서 일어난 일 하나 — 이것들이 같으면 두 실행은 그 단계까지 같은 실행이다. */
export interface StepMark {
  eventType: EventType;
  payload: Record<string, unknown>;
}

/** 노드 하나가 차례를 맡아 한 일 — 비교도 화면도 이 단위로 읽는다. */
export interface RunStep {
  nodeId: string;
  /** 그 차례가 어떻게 끝났는가 */
  status: NodeRunStatus;
  marks: StepMark[];
}

/**
 * 어느 노드의 것도 아닌, 실행 자체의 사건들.
 * 노드 이름을 달고 오면 그 노드의 단계에 속한다 (사람 확인 앞에서 멈춘 실행처럼).
 */
const RUN_LEVEL: EventType[] = [
  "run.started",
  "run.paused",
  "run.resumed",
  "run.completed",
  "run.failed",
];

/** 어느 노드의 일인가 — 계약은 "없음"을 비워 두기도 하고 비어 있다고 적기도 한다. */
function nodeOf(event: RunEvent): string | undefined {
  return event.node_id ?? undefined;
}

function belongsToTheRun(event: RunEvent): boolean {
  return nodeOf(event) === undefined && RUN_LEVEL.includes(event.event_type);
}

/**
 * 이벤트를 노드의 차례별로 묶는다.
 * 노드 이름이 없는 사건은 방금 일을 마친 노드가 남긴 것이다 (값이 연결을 건너간 일).
 */
function turns(events: RunEvent[]): RunEvent[][] {
  const groups: RunEvent[][] = [];
  let working: string | undefined;
  for (const event of events) {
    if (belongsToTheRun(event)) continue;
    const at = nodeOf(event);
    if (at !== undefined && at !== working) {
      working = at;
      groups.push([]);
    }
    groups.at(-1)?.push(event);
  }
  return groups;
}

function stepOf(nodeId: string, events: RunEvent[]): RunStep {
  return {
    nodeId,
    status: nodeStatesAt(events, events.at(-1)?.seq ?? 0)[nodeId] ?? "idle",
    marks: events.map((event) => ({
      eventType: event.event_type,
      payload: event.payload,
    })),
  };
}

/** 한 번의 실행을 노드 단계의 줄로 읽는다. */
export function runSteps(events: RunEvent[]): RunStep[] {
  return turns(events).flatMap((group) => {
    const first = group[0];
    const nodeId = first === undefined ? undefined : nodeOf(first);
    return nodeId === undefined ? [] : [stepOf(nodeId, group)];
  });
}

/** 아직 끝나지 않은 단계 — 그 실행은 여기까지 오고 멈춰 섰다. */
function unfinished(step: RunStep): boolean {
  return step.status !== "completed" && step.status !== "failed";
}

function sameMarks(one: StepMark[], other: StepMark[]): boolean {
  return JSON.stringify(one) === JSON.stringify(other);
}

/**
 * 두 실행의 같은 자리에 선 단계가 같은 단계인가.
 * 한쪽이 멈춰 서고 다른 쪽이 그 단계를 지나갔다면 거기서 두 실행은 이미 다른 실행이다 —
 * 앞부분이 같다는 것으로 "똑같다"고 말하지 않는다.
 */
function agree(one: RunStep, other: RunStep): boolean {
  return one.nodeId === other.nodeId && sameMarks(one.marks, other.marks);
}

/**
 * 두 실행이 갈라지는 첫 단계의 자리. 끝까지 같으면 없다(null).
 * 한쪽이 먼저 끝났다면 짧은 쪽이 끝난 자리가 갈라지는 자리다.
 */
export function firstDivergence(one: RunStep[], other: RunStep[]): number | null {
  const shared = Math.min(one.length, other.length);
  for (let at = 0; at < shared; at += 1) {
    if (!agree(one[at], other[at])) return at;
  }
  return one.length === other.length ? null : shared;
}

/**
 * 이 실행이 상대보다 먼저 끝났는가 — 마지막 단계에서 멈춰 섰고, 상대는 그 자리를 지나갔다.
 * 둘 다 같은 자리에 멈춰 섰다면 먼저 끝난 쪽은 없다.
 */
export function endedEarly(mine: RunStep[], theirs: RunStep[]): boolean {
  const last = mine.at(-1);
  if (last === undefined || !unfinished(last)) return false;
  if (theirs.length > mine.length) return true;
  const counterpart = theirs[mine.length - 1];
  return counterpart !== undefined && counterpart.marks.length > last.marks.length;
}
