// 서버가 열어 준 실행을 한 번의 실행 기록으로 조립한다 (순수 함수).
// 이름과 시각은 서버가 매긴 것이다 — 여기서는 그 값을 우리 기록의 모양으로 옮겨 담을 뿐이다.
// 실행이 실제로 돈 그래프를 고르는 규칙도 이 자리에 있다: 저장된 판과 서버가 돌린 판이 같은지를 본다.
import type { AgentSpec } from "../generated/agent_spec";
import type { RunEvent } from "../generated/run_event";

/**
 * 한 번의 실행이 남긴 것 — 무슨 일이 있었는지와 그때의 그래프.
 * 이 자리에서 실험 루프가 자란다 (비교·택일은 다음 조각).
 */
export interface RunRecord {
  id: string;
  at: Date;
  /** 몇 번째 실행인가 — 화면은 이 순번으로 이름을 짓는다 */
  order: number;
  events: RunEvent[];
  /** 그때 돌린 그래프. 뒤에 캔버스를 고쳐도 기록은 그대로다 */
  specSnapshot: AgentSpec;
}

/** 서버가 실행을 열며 돌려준 것 가운데, 기록을 짓는 데 필요한 만큼만. */
export interface StartedRun {
  id: string;
  created_at: string;
}

/**
 * 서버가 매긴 이름과 시각으로 실행 기록 하나를 짓는다.
 * 이벤트는 아직 하나도 오지 않았다 — 서버가 흘려보내는 대로 쌓인다.
 */
export function buildRunRecord(
  run: StartedRun,
  order: number,
  specSnapshot: AgentSpec,
): RunRecord {
  return {
    id: run.id,
    at: new Date(run.created_at),
    order,
    events: [],
    specSnapshot,
  };
}

/**
 * 이 실행이 실제로 돈 그래프 — 서버가 돌린 판이다.
 * 저장하고 실행하는 사이에 화면에서 고친 것은 이 실행이 돌지 않았으므로 기록에 남기지 않는다.
 * 서버가 돌린 판이 우리가 저장해 둔 판과 다르면 그 판을 들고 있지 않다는 뜻이다 —
 * 그럴 때는 지금 화면의 그래프로 물러난다 (아무것도 남기지 않는 것보다 낫다).
 */
export function ranGraph(
  savedSpec: AgentSpec | null,
  specRevision: string,
  exportSpec: () => AgentSpec,
): AgentSpec {
  return savedSpec !== null && savedSpec.revision === specRevision
    ? savedSpec
    : exportSpec();
}

/** 실패 실행에서 시험 초안으로 가져올 입력만 복사한다. */
export function inputFromRunStarted(events: RunEvent[]): Record<string, unknown> {
  const started = events.find((event) => event.event_type === "run.started");
  const input = started?.payload.input;
  if (input === null || typeof input !== "object" || Array.isArray(input)) return {};

  const copy = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(copy);
    if (value !== null && typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>).map(([key, nested]) => [key, copy(nested)]),
      );
    }
    return value;
  };
  return copy(input) as Record<string, unknown>;
}
