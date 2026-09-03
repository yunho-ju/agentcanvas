// 실행 이벤트를 되감아 "그 순간의 그래프"를 만든다 (순수 함수).
// 재생 위치는 상태로 쌓지 않고 언제나 이벤트에서 다시 계산한다 — 앞으로 가나 뒤로 가나 그림이 같다.
import type { EventType, RunEvent } from "../generated/run_event";

export type NodeRunStatus =
  | "idle"
  | "queued"
  | "running"
  | "waiting"
  // 사람이 거절해 흐름이 여기서 끝났다 — 마친 것도 실패한 것도 아닌 세 번째 결말이다.
  | "rejected"
  // 노드는 제 일을 마쳤지만 그 노드가 부른 도구가 답을 가져오지 못했다 — 네 번째 결말이다.
  // 그래프가 그 어그러짐을 다루더라도(error 갈래) 사람에게 초록불로 보이면 안 된다.
  | "toolFailed"
  | "completed"
  | "failed";

/**
 * 어떤 이벤트가 노드를 어떤 상태로 옮기는가 — 새 이벤트는 여기 한 줄을 더한다.
 * 표에 없는 이벤트는 노드의 상태를 바꾸지 않는다 (모델과 주고받는 중에도 노드는 일하는 중이다).
 */
const STATUS_BY_EVENT: Partial<Record<EventType, NodeRunStatus>> = {
  "node.queued": "queued",
  "node.started": "running",
  // 사람의 확인을 청한 노드는 일하는 것이 아니라 기다린다 — 밸브가 잠긴 자리다.
  "human.approval_requested": "waiting",
  "node.completed": "completed",
  "node.failed": "failed",
};

/** 실행을 보는 동안 노드 하나가 카드 위에서 말할 수 있는 것 전부. */
export interface NodeRunFact {
  status: NodeRunStatus;
  /** 일을 시작해서 마치기까지 걸린 시간(ms) — 아직 일하는 중이면 없다 */
  elapsedMs?: number;
  /** 끝내지 못한 이유 한 줄 — 실패했고 이벤트가 이유를 들고 왔을 때만 있다 */
  error?: string;
}

/**
 * 사람이 아니오라고 답한 사건인가 — 답은 payload에 실린다.
 * (계약은 payload를 자유롭게 열어 두었다 — 거절을 위한 새 이벤트 종류는 만들지 않는다.)
 * 거절을 읽는 자리는 모두 이 술어 하나를 쓴다.
 */
export function turnedDown(event: RunEvent): boolean {
  return event.payload.approved === false;
}

/**
 * 도구가 답을 가져오지 못한 사건인가 — 성패는 payload에 실린다(거절을 읽는 방식과 같다).
 * 도구가 어그러진 것을 읽는 자리는 모두 이 술어 하나를 쓴다.
 */
export function toolFellShort(event: RunEvent): boolean {
  return event.event_type === "tool.completed" && event.payload.ok === false;
}

/** 이 실행에서 도구가 답을 가져오지 못한 자리가 있었는가 — 실행이 끝까지 갔더라도 남는 사실이다. */
export function toolFellShortIn(events: RunEvent[]): boolean {
  return events.some(toolFellShort);
}

function reasonOf(event: RunEvent): string | undefined {
  const reason = event.payload.error ?? event.payload.message;
  return typeof reason === "string" && reason.trim() !== "" ? reason : undefined;
}

/** 재생 위치(seq)까지 흘렀을 때 각 노드가 무엇을 하고 있고 무엇을 남겼는가. */
export function nodeRunFacts(
  events: RunEvent[],
  seq: number,
): Record<string, NodeRunFact> {
  const facts: Record<string, NodeRunFact> = {};
  const startedAtMs: Record<string, number> = {};
  // 도구가 답을 가져오지 못한 노드들 — 그 노드의 끝맺음은 초록불이 아니다.
  const cameUpShort = new Set<string>();
  for (const event of events) {
    if (event.seq > seq) continue;
    if (toolFellShort(event) && event.node_id) cameUpShort.add(event.node_id);
    // 끝맺음은 마쳤을 때와 같은 이벤트로 온다 — 그 안에 실린 것이 결말을 가른다.
    const ended = event.event_type === "node.completed";
    const status = ended && turnedDown(event)
      ? "rejected"
      : ended && event.node_id && cameUpShort.has(event.node_id)
        ? "toolFailed"
        : STATUS_BY_EVENT[event.event_type];
    if (!status || !event.node_id) continue;

    const at = Date.parse(event.timestamp);
    if (status === "running") startedAtMs[event.node_id] = at;
    const startedMs = startedAtMs[event.node_id];
    const finished =
      status === "completed" ||
      status === "failed" ||
      status === "rejected" ||
      status === "toolFailed";
    facts[event.node_id] = {
      status,
      ...(finished && startedMs !== undefined ? { elapsedMs: at - startedMs } : {}),
      ...(status === "failed" && reasonOf(event) ? { error: reasonOf(event) } : {}),
    };
  }
  return facts;
}

/** 재생 위치(seq)까지 흘렀을 때 각 노드가 무엇을 하고 있는가. 아직 등장하지 않은 노드는 없다. */
export function nodeStatesAt(
  events: RunEvent[],
  seq: number,
): Record<string, NodeRunStatus> {
  return Object.fromEntries(
    Object.entries(nodeRunFacts(events, seq)).map(([id, fact]) => [id, fact.status]),
  );
}

/** 연결 하나가 실행 중에 하는 일: 비어 있거나, 데이터를 나르는 중이거나, 데이터가 지나갔거나. */
export type EdgeFlowState = "idle" | "carrying" | "carried";

/** 어디서 어디로 가는 연결인가 — 흐름을 재는 데 필요한 것은 두 끝뿐이다. */
export interface EdgeEnds {
  id: string;
  source: string;
  target: string;
}

/** 앞 노드가 일을 마쳤는가 — 마쳐야만 뒤로 보낼 데이터가 생긴다. */
function handedOff(status: NodeRunStatus | undefined): boolean {
  return status === "completed";
}

/**
 * 뒤 노드가 데이터를 받아 일을 시작했는가.
 * 사람이 거절한 노드도 값을 받기는 받았다 — 관은 흐름을 멈추고 지나간 잔상으로 가라앉는다.
 */
function tookOver(status: NodeRunStatus | undefined): boolean {
  return (
    status === "running" ||
    status === "completed" ||
    status === "failed" ||
    status === "rejected"
  );
}

/**
 * 재생 위치(seq)까지 흘렀을 때 각 연결이 데이터를 나르고 있는가.
 * 앞 노드가 마친 순간부터 뒤 노드가 시작할 때까지가 나르는 구간이다 — 되감으면 함께 되감긴다.
 */
export function edgeFlowStates(
  edges: EdgeEnds[],
  events: RunEvent[],
  seq: number,
): Record<string, EdgeFlowState> {
  const states = nodeStatesAt(events, seq);
  return Object.fromEntries(
    edges.map((edge) => {
      const source = states[edge.source];
      const target = states[edge.target];
      if (!handedOff(source)) return [edge.id, "idle" as const];
      return [edge.id, tookOver(target) ? ("carried" as const) : ("carrying" as const)];
    }),
  );
}

function startedAt(events: RunEvent[]): number {
  return events.length > 0 ? Date.parse(events[0].timestamp) : 0;
}

/** 실행이 시작되고 얼마 만에 일어난 이벤트인가 (ms). */
export function offsetOf(events: RunEvent[], seq: number): number {
  const event = events.find((candidate) => candidate.seq === seq);
  return event ? Date.parse(event.timestamp) - startedAt(events) : 0;
}

/** 실행 전체의 길이 (ms) — 마지막 이벤트까지 걸린 시간. */
export function runLengthMs(events: RunEvent[]): number {
  const last = events.at(-1);
  return last ? Date.parse(last.timestamp) - startedAt(events) : 0;
}

/** 시작 후 그만큼의 시간이 흘렀을 때 화면이 보여줄 이벤트. 아직 이르면 첫 이벤트다. */
export function seqAt(events: RunEvent[], offsetMs: number): number {
  const start = startedAt(events);
  let reached = events[0]?.seq ?? 0;
  for (const event of events) {
    if (Date.parse(event.timestamp) - start > offsetMs) break;
    reached = event.seq;
  }
  return reached;
}

/**
 * 화면이 지금 보여주는 사건 — 두 손 중 나중 것이 정한다 (DESIGN §7 event-list).
 * 사람이 누른 줄이 이 실행에 있으면 그 줄이고, 없으면 재생 시각이 정한다.
 * 같은 시각의 사건이 여럿일 때 시각만으로는 누른 줄을 되찾을 수 없다.
 */
export function shownSeq(
  events: RunEvent[],
  offsetMs: number,
  pickedSeq: number | null,
): number {
  const picked = events.some((event) => event.seq === pickedSeq);
  return picked && pickedSeq !== null ? pickedSeq : seqAt(events, offsetMs);
}

/**
 * 아직 아무도 답하지 않은 멈춤 — 뒤에 다시 흐른 사건(run.resumed)이 없는 run.paused.
 * 답을 받은 밸브는 지나온 자리다: 되감아 다시 보더라도 거기서 다시 붙잡히지 않는다.
 */
export function unansweredPause(events: RunEvent[]): RunEvent | null {
  let held: RunEvent | null = null;
  for (const event of events) {
    if (event.event_type === "run.paused") held = event;
    if (event.event_type === "run.resumed") held = null;
  }
  return held;
}

/** 재생이 저절로 멈춰 서는 까닭 — 사람 확인 밸브가 잠겼거나, 사용자가 손으로 꽂아 둔 자리다. */
export type HaltReason = "gate" | "breakpoint";

/** 재생이 멈춰 서는 자리 하나. */
export interface Halt {
  seq: number;
  reason: HaltReason;
  /** 어느 노드 때문에 멈추는가 */
  nodeId?: string;
}

/** 이 실행에서 재생이 붙잡히는 자리 전부. */
function halts(events: RunEvent[], breakpoints: string[]): Halt[] {
  const held = unansweredPause(events);
  return events.flatMap((event, index): Halt[] => {
    const nodeId = event.node_id;
    if (event.event_type === "run.paused") {
      // 이미 답을 받은 밸브는 붙잡지 않는다 — 사람은 그 물음에 벌써 답했다.
      return event.seq === held?.seq
        ? [{ seq: event.seq, reason: "gate", ...(nodeId ? { nodeId } : {}) }]
        : [];
    }
    // 손 밸브는 노드가 일을 시작하기 직전에 잠긴다 — 시작하는 순간은 아직 오지 않았다.
    const marked =
      event.event_type === "node.started" &&
      typeof nodeId === "string" &&
      breakpoints.includes(nodeId);
    return marked && index > 0
      ? [{ seq: events[index - 1].seq, reason: "breakpoint", nodeId }]
      : [];
  });
}

/** 멈춰 서는 자리와, 실행이 시작되고 그 자리까지 걸린 시간. */
export interface HaltAt extends Halt {
  atMs: number;
}

/**
 * 이번 박자(fromMs → toMs) 동안 재생이 붙잡히는 첫 자리. 없으면 그냥 흐른다.
 * 이미 서 있는 자리(fromMs)에는 다시 붙잡히지 않는다 — 그래야 다시 재생할 수 있다.
 */
export function haltBetween(
  events: RunEvent[],
  breakpoints: string[],
  fromMs: number,
  toMs: number,
): HaltAt | null {
  return (
    halts(events, breakpoints)
      .map((halt) => ({ ...halt, atMs: offsetOf(events, halt.seq) }))
      .filter((halt) => halt.atMs > fromMs && halt.atMs <= toMs)
      .sort((one, other) => one.atMs - other.atMs)[0] ?? null
  );
}

/** 실행이 닫히는 사건들 — 사람이 거절한 실행도 여기로 닫힌다(다른 결말이지 미완이 아니다). */
const RUN_CLOSED: EventType[] = ["run.completed", "run.failed"];

/**
 * 재생 위치(seq)까지 흘렀을 때 이 실행이 끝까지 갔는가.
 * 밸브 앞에 멈춰 선 실행은 아직 닫히지 않았다 — 사람의 답을 기다리는 중이다.
 */
export function runFinished(events: RunEvent[], seq: number): boolean {
  return events.some(
    (event) => event.seq <= seq && RUN_CLOSED.includes(event.event_type),
  );
}

/** 이 실행이 실패로 닫혔는가 — 히스토리 카드의 실패 뱃지가 보는 사실이다 (따로 저장하지 않는다). */
export function endedInFailure(events: RunEvent[]): boolean {
  return events.at(-1)?.event_type === "run.failed";
}

/** 재생이 이번 박자에 그대로 흐른 결과 — 얼마나 나아갔고, 계속 흐를 것인가. */
export interface TickAdvance {
  kind: "advance";
  atMs: number;
  /** 실행이 닫히는 데까지 다 봤으면 재생도 여기서 그친다 (아직 닫히지 않았으면 기다리며 흐른다) */
  keepPlaying: boolean;
}

/** 재생이 이번 박자에 멈춰 선 결과 — 어느 밸브 때문에, 어디서 멈추는가. */
export interface TickHalt extends Halt {
  kind: "halt";
  atMs: number;
}

export type TickResult = TickAdvance | TickHalt;

/**
 * 재생 시계가 한 박자(elapsedMs) 흘렀을 때 무슨 일이 일어나는가.
 * 속도를 곱하고 실행 길이에서 clamp한 다음, 그 사이에 멈춰 설 자리가 있으면 거기서 서고
 * (사람 확인 밸브든 손으로 꽂은 멈춤이든), 없으면 그만큼 그대로 흐른다.
 */
export function advanceTick(
  events: RunEvent[],
  breakpoints: string[],
  fromMs: number,
  elapsedMs: number,
  speed: number,
): TickResult {
  const length = runLengthMs(events);
  const next = Math.min(fromMs + elapsedMs * speed, length);
  const halt = haltBetween(events, breakpoints, fromMs, next);
  if (halt) return { kind: "halt", ...halt };
  const sawItClose = next >= length && runFinished(events, seqAt(events, next));
  return { kind: "advance", atMs: next, keepPlaying: !sawItClose };
}

/** 이벤트 하나만큼 앞뒤로 옮긴 위치. 양 끝에서는 제자리에 머문다. */
export function steppedSeq(events: RunEvent[], seq: number, direction: number): number {
  const index = events.findIndex((event) => event.seq === seq);
  if (index === -1) return seq;
  const next = Math.min(Math.max(index + direction, 0), events.length - 1);
  return events[next].seq;
}
