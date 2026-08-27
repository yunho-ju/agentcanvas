// 시험을 위한 서버 대역 — 진짜 서버와 같은 약속으로 실행을 열고, 사람의 답을 받고, 이벤트를 흘린다.
// 실행기는 서버와 같은 규칙(fakeRun의 파이썬 미러)이므로 흘러오는 이벤트는 서버가 보낼 것과 같다.
// 진짜 SSE의 타이밍은 여기서 흉내 내지 않는다 (실서버 실증은 메인이 한다) — 약속만 같게 지킨다.
import type { RunAnswerOutcome, RunStartOutcome, StreamEnd } from "../src/api/runs";
import type { AgentSpec } from "../src/generated/agent_spec";
import type { ApprovalAnswer } from "../src/generated/approval_answer";
import type { RunEvent } from "../src/generated/run_event";
import { type FakeRunOptions, fakeRun, resumeFakeRun } from "../src/run/fakeRun";
import { useEditor } from "../src/store/editor";
import type { WatchRun } from "../src/store/runSlice";
import { asServerAnswer } from "./serverAnswer";

/** 실행이 닫히는 사건들 — 이것을 보내면 서버는 스트림을 닫는다. */
const RUN_CLOSED = ["run.completed", "run.failed"];

export interface RunServerDouble {
  /** 서버에 부탁한 횟수 — 실행 열기·답 보내기·이벤트 받기 */
  starts: number;
  answers: number;
  streams: number;
  /** 아직 열려 있는 스트림의 수 — 실행이 닫히면 0이 된다 */
  open: number;
  /** 받는 쪽이 그만 듣겠다고 한 횟수 — 스트림을 정말로 끊었는가를 여기서 본다 */
  cancelled: number;
  /** 지금 서버에 남아 있는 이벤트들 */
  stored: () => RunEvent[];
  /** 길이 끊긴다 — 열려 있는 스트림이 종결 없이 돌아온다 */
  cut: () => void;
  /** 이 실행을 서버가 물린다고 해 둔다 (다음 부탁부터) */
  refuse: (failure: RunStartOutcome) => void;
  /** 이벤트를 붙잡아 둔다 — 흘려보내라고 할 때까지 한 개도 나가지 않는다 */
  hold: () => void;
  /** 붙잡아 둔 이벤트를 몇 개(적지 않으면 전부) 흘려보낸다 */
  flow: (count?: number) => void;
}

/**
 * 서버 대역을 store에 꽂는다 — 실행은 이 대역이 돌린다.
 * 실행 이름과 시작 시각은 밖에서 받는다: 같은 그래프면 언제나 같은 이벤트가 나온다.
 */
export function serveRuns(options: FakeRunOptions): RunServerDouble {
  let events: RunEvent[] = [];
  let spec: AgentSpec | null = null;
  let broken = false;
  let refused: RunStartOutcome | null = null;
  //  흘려보낼 수 있는 이벤트의 수 — 붙잡아 두지 않으면 오는 대로 다 나간다.
  let budget = Number.POSITIVE_INFINITY;
  const waiting: (() => void)[] = [];
  const wake = () => {
    for (const resume of waiting.splice(0)) resume();
  };

  const double: RunServerDouble = {
    starts: 0,
    answers: 0,
    streams: 0,
    open: 0,
    cancelled: 0,
    stored: () => events,
    cut: () => {
      broken = true;
      wake();
    },
    refuse: (failure) => {
      refused = failure;
    },
    hold: () => {
      budget = 0;
    },
    flow: (count) => {
      budget = count === undefined ? Number.POSITIVE_INFINITY : budget + count;
      wake();
    },
  };

  const start = async (specId: string, specRevision: string): Promise<RunStartOutcome> => {
    double.starts += 1;
    if (refused) return refused;
    // 서버는 자기가 저장해 둔 판을 돌린다 — 대역은 지금 캔버스의 그래프를 그 판으로 삼는다.
    spec = { ...useEditor.getState().exportSpec(), id: specId, revision: specRevision };
    events = fakeRun(spec, options);
    return {
      run: {
        id: options.runId,
        spec_id: specId,
        spec_revision: specRevision,
        created_at: options.startedAt.toISOString(),
      },
      status: "paused",
    };
  };

  const answer = async (
    runId: string,
    given: ApprovalAnswer,
  ): Promise<RunAnswerOutcome> => {
    double.answers += 1;
    if (spec === null) return { failure: { key: "run.answer.gone" } };
    events = resumeFakeRun(spec, events, {
      approved: given.approved,
      ...(given.values ? { values: given.values } : {}),
    });
    wake();
    return {
      run: {
        id: runId,
        spec_id: spec.id,
        spec_revision: spec.revision,
        created_at: options.startedAt.toISOString(),
      },
      status: "running",
    };
  };

  const stream: WatchRun = async (_runId, watch): Promise<StreamEnd> => {
    double.streams += 1;
    double.open += 1;
    broken = false;
    let cursor = watch.after ?? null;
    // 받는 쪽이 그만 듣겠다고 하면 진짜 서버의 소켓처럼 이 스트림도 그 자리에서 끝난다.
    const stopped = () => watch.signal?.aborted === true;
    watch.signal?.addEventListener("abort", () => {
      double.cancelled += 1;
      wake();
    });
    try {
      while (true) {
        const fresh = events
          .filter((event) => cursor === null || event.seq > cursor)
          .slice(0, budget);
        for (const event of fresh) {
          if (stopped()) return { ended: false, lastSeq: cursor };
          watch.onEvent(event);
          cursor = event.seq;
          budget -= 1;
          if (RUN_CLOSED.includes(event.event_type)) return { ended: true, lastSeq: cursor };
        }
        if (broken || stopped()) return { ended: false, lastSeq: cursor };
        await new Promise<void>((resume) => waiting.push(resume));
      }
    } finally {
      double.open -= 1;
    }
  };

  useEditor.setState({
    sendRunStart: start,
    sendRunAnswer: answer,
    watchRunEvents: stream,
  });
  return double;
}

/**
 * 그래프를 그대로 받아 주는 저장 서버 — 판을 새로 매기지 않는다.
 * 실행은 저장이 성공해야 시작되므로, 실행을 보는 시험은 이 문도 함께 열어 둔다.
 */
export function serveSaves(): void {
  useEditor.setState({
    sendSpec: async (spec) => ({ saved: asServerAnswer(spec), issues: [] }),
  });
}

/**
 * 대역을 꽂고 실행을 하나 열어, 흘러온 이벤트가 화면에 닿을 때까지 기다린다.
 * 돌리는 판은 지금 캔버스의 판이다 — 저장을 거치지 않는 시험도 같은 이벤트를 보게 된다.
 */
export async function runOnServer(options: FakeRunOptions): Promise<RunServerDouble> {
  const server = serveRuns(options);
  await useEditor.getState().startRun(useEditor.getState().exportSpec().revision);
  await settle();
  return server;
}

/**
 * 대역이 흘려보낼 것을 다 흘려보내게 둔다 — 이벤트는 약속(promise)을 타고 오므로
 * 부른 쪽이 한 박자 기다려야 화면에 닿는다. 닿지 않았다면 뒤따르는 단언이 소리 내어 실패한다.
 */
export async function settle(): Promise<void> {
  for (let tick = 0; tick < 25; tick += 1) await Promise.resolve();
}
