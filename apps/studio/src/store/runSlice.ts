// 실행을 보는 시간 — 어떤 이벤트들을 어디까지 재생했는가만 담는다.
// 무엇이 어떤 상태인지 계산하는 일은 run/player의 순수 함수가 하고, 시간은 밖에서 tickRun으로 들어온다.
// 실행 자체는 서버의 것이다: 이 슬라이스는 서버에 부탁하고, 서버가 흘려보내는 이벤트를 받아 쌓는다.
import type { StateCreator } from "zustand";
import {
  type RunStartOutcome,
  answerGateOnServer,
  startRunOnServer,
  streamRunEvents,
} from "../api/runs";
import { mergedEvents } from "../run/eventLog";
import { type SendRunAnswer, answerGate as submitGateAnswer } from "../run/gateAnswer";
import {
  type NodeRunStatus,
  advanceTick,
  nodeStatesAt,
  offsetOf,
  runFinished,
  runLengthMs,
  endedInFailure,
  seqAt,
  steppedSeq,
  unansweredPause,
} from "../run/player";
import type { RunEvent } from "../generated/run_event";
import { nodesNeedingSetup } from "../graph/nodeSetupIssues";
import { sceneOf } from "../graph/scene";
import { adoptSpec } from "../history/graphCommands";
import { type Message, msg, translate } from "../i18n/messages";
import { getLocale } from "../i18n/localeStore";
import {
  type RunRecord,
  buildRunRecord,
  inputFromRunStarted,
  ranGraph,
} from "../run/runRecord";
import { RunStream, type WatchRun } from "../run/runStream";
import type { EditorState } from "./editor";

export type { RunRecord } from "../run/runRecord";
export type { WatchRun } from "../run/runStream";
export type { SendRunAnswer } from "../run/gateAnswer";

/** 고를 수 있는 재생 속도 (설계 §4.3). */
export const RUN_SPEEDS = [0.5, 1, 2, 4, 8];

/** 나란히 놓고 볼 수 있는 실행의 수 — 두 개를 견주는 일이다. */
export const COMPARE_SEATS = 2;

/** 서버에 실행을 열어 달라고 부탁하는 길. 시험은 이 자리에 가짜를 꽂는다. */
export type SendRunStart = (
  specId: string,
  specRevision: string,
  /** 사람이 실행에 넣어 준 값 — 넣은 것이 없으면 없다 */
  input?: Record<string, unknown>,
) => Promise<RunStartOutcome>;

export interface RunSlice {
  /** 지금 화면에서 재생 중인 실행의 이벤트들. 비어 있으면 편집 시간이다 */
  runEvents: RunEvent[];
  /** 실행이 시작되고 흐른 시간(ms) — 재생 위치는 여기서 나온다 */
  runOffsetMs: number;
  isPlaying: boolean;
  runSpeed: number;
  /** 이 자리에서 해 본 실행들 — 새 실행이 뒤에 쌓인다 (세션 동안만 남는다) */
  runHistory: RunRecord[];
  /** 지금 화면에서 다시 보고 있는 기록 */
  activeRunId: string | null;
  /** 재생을 여기서 멈춰 달라고 손으로 꽂아 둔 노드들 (세션 동안만 남는다 — spec에는 없다) */
  breakpoints: string[];
  /** 나란히 견주려고 고른 기록들 — 고른 순서대로, 많아야 둘이다 */
  compareSelection: string[];
  /** 어느 실행의 설정으로 이어 가기로 했는가 */
  adoptedRunId: string | null;
  /**
   * 서버에 실행을 부탁해 둔 채 대답을 기다리는 중인가 — 이 사이에 다시 눌러도 실행은 하나다.
   * 아직 이벤트가 하나도 없으므로 `isRunning`으로는 알 수 없는 시간이다.
   */
  startingRun: boolean;
  /**
   * 사람의 답을 서버에 보내 두고 대답을 기다리는 중인가 — 이 사이에 다시 눌러도 답은 한 번만 간다.
   * `startingRun`과 같은 짝이다: 이벤트가 오기 전까지는 화면만 보고 알 수 없는 시간이다.
   */
  answeringGate: boolean;
  sendRunStart: SendRunStart;
  sendRunAnswer: SendRunAnswer;
  watchRunEvents: WatchRun;
  /** 저장된 그래프의 이 판을, 사람이 넣어 준 값과 함께 서버에서 돌려 달라고 부탁한다 */
  startRun: (specRevision: string, input?: Record<string, unknown>) => Promise<void>;
  /** 서버가 흘려보낸 이벤트를 그 실행에 쌓는다 — 이미 들은 순번은 다시 세지 않는다 */
  appendRunEvents: (runId: string, events: RunEvent[]) => void;
  /**
   * 이 자리의 실행들을 놓는다 — 듣고 있던 스트림을 끊고, 부탁해 둔 실행도 잊는다.
   * 다른 문서를 열 때 부른다: 새 문서는 옛 문서의 실행을 이어받지 않는다.
   */
  abandonRuns: () => void;
  /** 남은 기록 하나를 골라 처음부터 다시 본다 */
  replayRun: (id: string) => void;
  /** 실행 보기를 끝내고 편집으로 돌아간다 */
  stopRun: () => void;
  playRun: () => void;
  pauseRun: () => void;
  setRunSpeed: (speed: number) => void;
  /** 밖에서 흐른 시간을 알려 준다 — 시계는 store 안에 없다 */
  tickRun: (elapsedMs: number) => void;
  scrubToSeq: (seq: number) => void;
  stepRun: (direction: number) => void;
  restartRun: () => void;
  /** 이벤트 하나를 골랐다 — 그 시점으로 가고 그 일을 한 노드를 함께 고른다 */
  goToEvent: (seq: number) => void;
  /**
   * 밸브 앞에 멈춰 선 실행을 사람이 승인한다 — 이벤트가 이어지고 흐름이 다시 열린다.
   * 확인하며 적어 넣은 값이 있으면 그 답에 함께 실린다.
   */
  approveGate: (values?: Record<string, unknown>) => Promise<void>;
  /** 사람이 거절한다 — 기다리던 노드가 일을 마치고 실행이 그 자리에서 끝난다 */
  rejectGate: () => Promise<void>;
  /** 이 노드 앞에서 멈추기를 켜고 끈다 */
  toggleBreakpoint: (nodeId: string) => void;
  /** 이 기록을 견주기로 고르거나 놓는다 — 셋째를 고르면 가장 먼저 고른 것이 물러난다 */
  toggleCompare: (id: string) => void;
  /** 견주기를 그만둔다 */
  clearCompare: () => void;
  /** 이 기록이 돌던 그래프로 이어 간다 — 되돌릴 수 있는 한 걸음의 편집이다 */
  adoptRun: (id: string) => void;
  promoteFailedRun: (id: string) => void;
}

/** 두 실행을 나란히 놓고 보는 중인가 — 둘을 다 골랐을 때만이다. */
export function isComparing(state: EditorState): boolean {
  return state.compareSelection.length === COMPARE_SEATS;
}

/** 실행을 보는 중인가 — 이 동안에는 그래프를 고칠 수 없다. */
export function isRunning(state: EditorState): boolean {
  return state.runEvents.length > 0;
}

/** 지금 화면이 보여주고 있는 이벤트의 순번. */
export function currentSeq(state: EditorState): number {
  return seqAt(state.runEvents, state.runOffsetMs);
}

/**
 * 흐름이 사람 확인 밸브 앞에 멈춰 서 있는가 — 그렇다면 어느 노드에서인가.
 * 사람이 이미 답한 밸브는 지나온 자리다: 되감아 보는 중에는 아무도 기다리지 않는다.
 */
export function awaitingGate(state: EditorState): string | null {
  const held = unansweredPause(state.runEvents);
  if (!held) return null;
  return currentSeq(state) >= held.seq ? (held.node_id ?? null) : null;
}

/** 지금 보고 있는 실행이 끝까지 갔는가. */
export function runReachedEnd(state: EditorState): boolean {
  return runFinished(state.runEvents, currentSeq(state));
}

/**
 * 이 자리에서 끝까지 간 실행을 한 번이라도 봤는가 — 첫 걸음 안내의 마지막 걸음이 이것을 본다.
 * 사실은 실행 이력에 남는다: 실행 보기를 닫아도(만들기로 돌아가도) 걸은 걸음은 지워지지 않는다.
 */
export function sawRunToTheEnd(state: EditorState): boolean {
  if (runReachedEnd(state)) return true;
  // 실행 보기가 열려 있는 동안 화면에서 재생 중인 그 실행만 재생 머리가 답한다(위 한 줄) —
  // 도착만 한 이벤트를 본 것으로 세지 않기 위해서다. 실행 보기를 닫으면 이력이 답한다.
  const onScreen = isRunning(state) ? state.activeRunId : null;
  return state.runHistory.some(
    (record) =>
      record.id !== onScreen &&
      runFinished(record.events, record.events.at(-1)?.seq ?? 0),
  );
}

/** 지금 이 순간 각 노드가 무엇을 하고 있는가. */
export function runNodeStates(state: EditorState): Record<string, NodeRunStatus> {
  return nodeStatesAt(state.runEvents, currentSeq(state));
}

export const createRunSlice: StateCreator<EditorState, [], [], RunSlice> = (set, get) => {
  const atEnd = () => get().runOffsetMs >= runLengthMs(get().runEvents);

  /** 실행이 왜 안 되는지는 화면에 한 줄로 말한다 — 조용히 넘어가지 않는다. */
  const tell = (message: Message) => set({ feedbackNotice: { message, tone: "warn" } });

  /**
   * 지금 듣고 있는 스트림과, 문서를 몇 번째 보고 있는지 — 상태가 아니라 이 슬라이스가 쥐고 있는 자원이다.
   * 밸브 앞에 멈춰 선 실행의 스트림은 저절로 닫히지 않으므로, 버릴 때는 우리가 끊어야 한다.
   */
  const stream = new RunStream({
    watchRunEvents: (runId, watch) => get().watchRunEvents(runId, watch),
    onEvent: (runId, event) => get().appendRunEvents(runId, [event]),
    onLost: (runId) => {
      if (get().activeRunId === runId) set({ isPlaying: false });
    },
    onFailure: (message) => tell(message),
  });

  /** 사용자가 재생을 넘겨받았다 — 손으로 옮기는 동안 시간은 저절로 흐르지 않는다. */
  const moveTo = (seq: number) =>
    set({ runOffsetMs: offsetOf(get().runEvents, seq), isPlaying: false });

  const answerGate = (approved: boolean, values?: Record<string, unknown>) =>
    submitGateAnswer(approved, values, {
      sendRunAnswer: (runId, answer) => get().sendRunAnswer(runId, answer),
      isAwaitingGate: () => Boolean(awaitingGate(get())),
      isAnswering: () => get().answeringGate,
      activeRunId: () => get().activeRunId,
      setAnswering: (answering) => set({ answeringGate: answering }),
      onFailure: (message) => tell(message),
      onAnswered: () => {
        // 이어지는 이벤트는 스트림으로 도착한다 — 그때까지 화면은 멈춰 선 마지막 사건에 서 있다.
        set({ isPlaying: true });
        // 답을 했으니 물음은 끝났다 — 카드는 자기 상태를 스스로 접는다.
        get().setGateCardOpen(false);
      },
    });

  return {
    runEvents: [],
    runOffsetMs: 0,
    isPlaying: false,
    runSpeed: 1,
    runHistory: [],
    activeRunId: null,
    breakpoints: [],
    compareSelection: [],
    adoptedRunId: null,
    startingRun: false,
    answeringGate: false,
    sendRunStart: (specId, specRevision, input) =>
      startRunOnServer(specId, specRevision, input),
    sendRunAnswer: (runId, answer) => answerGateOnServer(runId, answer),
    watchRunEvents: (runId, watch) => streamRunEvents(runId, watch),

    startRun: async (specRevision, input) => {
      if (get().spec === null) return;
      // 부탁해 둔 실행의 대답을 기다리는 중이거나 이미 보고 있는 실행이 있으면 새로 시작하지 않는다.
      if (get().startingRun || isRunning(get())) return;
      // 실행 전 검증 — 설정이 빈 노드가 있으면 실패를 보여주는 대신 그 자리로 데려간다
      // (디자인 언어 §1.5 놓침 방지 ④).
      const waiting = nodesNeedingSetup(get().nodes);
      if (waiting.length > 0) {
        set({ notice: msg("run.waiting.notice", { count: waiting.length }) });
        get().select("node", waiting[0].id);
        return;
      }
      // 실행해 보겠다는 뜻이 분명하므로, 답을 기다리던 "이 노드를 뺄까" 물음은 물러 준다.
      get().cancelDetach();
      // 실행하는 판은 서버에 저장된 판이다 — 어느 판을 돌릴지 적어 보내고, 서버가 이름과 시각을 매긴다.
      const askedFor = stream.currentGeneration();
      set({ startingRun: true });
      const outcome = await get().sendRunStart(get().exportSpec().id, specRevision, input);
      // 오가는 사이에 다른 문서를 열었다면 이 대답은 이 자리의 것이 아니다 — 못 들은 것으로 한다.
      if (stream.stale(askedFor)) return;
      if (outcome.failure) {
        set({ startingRun: false });
        return tell(outcome.failure);
      }
      const record: RunRecord = buildRunRecord(
        outcome.run,
        get().runHistory.length + 1,
        ranGraph(get().savedSpec, outcome.run.spec_revision, get().exportSpec),
      );
      set({
        runEvents: [],
        runOffsetMs: 0,
        isPlaying: true,
        runSpeed: 1,
        runHistory: [...get().runHistory, record],
        activeRunId: record.id,
        startingRun: false,
      });
      get().setGateCardOpen(false);
      void stream.follow(record.id);
    },

    appendRunEvents: (runId, heard) => {
      const record = get().runHistory.find((item) => item.id === runId);
      // 이 자리에서 시작하지 않은 실행의 이벤트는 받지 않는다.
      if (!record) return;
      const events = mergedEvents(record.events, heard);
      set({
        runHistory: get().runHistory.map((item) =>
          item.id === runId ? { ...item, events } : item,
        ),
        // 지금 보고 있는 실행이 아니면 화면은 건드리지 않는다 (지난 실행을 다시 보는 중일 수 있다).
        ...(get().activeRunId === runId ? { runEvents: events } : {}),
      });
    },

    replayRun: (id) => {
      const record = get().runHistory.find((item) => item.id === id);
      if (!record) return;
      set({
        runEvents: record.events,
        runOffsetMs: 0,
        isPlaying: true,
        runSpeed: 1,
        activeRunId: record.id,
      });
      get().setGateCardOpen(false);
    },

    // 기록은 남는다 — 닫는 것은 지금 보고 있던 화면과, 서버에 매달려 있던 스트림이다.
    stopRun: () => {
      stream.stopListening();
      set({ runEvents: [], runOffsetMs: 0, isPlaying: false, activeRunId: null });
      get().setGateCardOpen(false);
    },

    abandonRuns: () => {
      stream.abandon();
      set({ startingRun: false, answeringGate: false });
    },

    // 끝까지 본 실행을 다시 틀면 처음부터 흐른다.
    // 밸브 앞에 멈춰 선 실행은 끝난 것이 아니다 — 다시 틀 것이 아니라 확인을 받아야 한다.
    playRun: () =>
      awaitingGate(get())
        ? get().setGateCardOpen(true)
        : set({ isPlaying: true, ...(atEnd() ? { runOffsetMs: 0 } : {}) }),

    pauseRun: () => set({ isPlaying: false }),

    setRunSpeed: (speed) => set({ runSpeed: speed }),

    tickRun: (elapsedMs) => {
      if (!get().isPlaying) return;
      const events = get().runEvents;
      // 아직 이벤트가 오지 않은 실행은 재생할 것도 멈출 것도 없다 — 시계가 먼저 멈춰 세우지 않는다.
      if (events.length === 0) return;
      const result = advanceTick(
        events,
        get().breakpoints,
        get().runOffsetMs,
        elapsedMs,
        get().runSpeed,
      );
      // 밸브를 만나면 재생은 거기 서서 사람을 기다린다 — 지나온 밸브에는 다시 걸리지 않는다.
      if (result.kind === "halt") {
        set({ runOffsetMs: result.atMs, isPlaying: false });
        if (result.reason === "gate") get().setGateCardOpen(true);
        else set({ notice: msg("breakpoint.notice", { id: result.nodeId ?? "" }) });
        return;
      }
      set({ runOffsetMs: result.atMs, isPlaying: result.keepPlaying });
    },

    scrubToSeq: (seq) => moveTo(seq),

    stepRun: (direction) => moveTo(steppedSeq(get().runEvents, currentSeq(get()), direction)),

    restartRun: () => moveTo(get().runEvents[0]?.seq ?? 0),

    goToEvent: (seq) => {
      moveTo(seq);
      const nodeId = get().runEvents.find((event) => event.seq === seq)?.node_id;
      if (nodeId) get().select("node", nodeId);
    },

    approveGate: (values) => answerGate(true, values),

    rejectGate: () => answerGate(false),

    toggleBreakpoint: (nodeId) =>
      set({
        breakpoints: get().breakpoints.includes(nodeId)
          ? get().breakpoints.filter((id) => id !== nodeId)
          : [...get().breakpoints, nodeId],
      }),

    // 견주는 자리는 둘뿐이다 — 셋째가 오면 가장 오래 서 있던 것이 물러난다.
    toggleCompare: (id) => {
      const chosen = get().compareSelection;
      set({
        compareSelection: chosen.includes(id)
          ? chosen.filter((candidate) => candidate !== id)
          : [...chosen, id].slice(-COMPARE_SEATS),
      });
    },

    clearCompare: () => set({ compareSelection: [] }),

    promoteFailedRun: (id) => {
      const record = get().runHistory.find((item) => item.id === id);
      const spec = get().spec;
      if (!record || !spec) return;
      if (record.specSnapshot.id !== spec.id) return;
      if (!endedInFailure(record.events) || get().caseDraft) return;

      get().stopRun();
      get().clearCompare();
      get().enterEvalMode();
      get().startNewCase({
        title: translate(getLocale(), msg("eval.case.promoted.title")),
        input: inputFromRunStarted(record.events),
      });
    },

    // 채택은 그래프를 고치는 일이다 — 보고 있던 실행을 닫아야 캔버스가 다시 열린다.
    adoptRun: (id) => {
      const record = get().runHistory.find((item) => item.id === id);
      if (!record) return;
      get().stopRun();
      get().runCommand(
        adoptSpec(sceneOf(get()), get().exportSpec(), record.specSnapshot),
      );
      set({ adoptedRunId: record.id, compareSelection: [] });
    },
  };
};
