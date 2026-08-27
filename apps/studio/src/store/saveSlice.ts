// 서버에 맡긴 것과 아직 맡기지 않은 것 — 저장은 서버의 일이고, 여기는 그 결과만 안다.
// revision과 판 번호는 서버가 매긴다: 화면은 절대 스스로 계산하지 않는다.
import type { StateCreator } from "zustand";
import { type SaveOutcome, sendSpecToServer } from "../api/specs";
import type { AgentSpec } from "../generated/agent_spec";
import { sameGraph } from "../graph/sameGraph";
import { asCanvasWouldWriteIt } from "../graph/serialize";
import { type Message, msg } from "../i18n/messages";
import type { EditorState } from "./editor";
import type { FeedbackNotice } from "./feedbackSlice";
import { isRunning } from "./runSlice";

/**
 * 저장을 한 번 시도하고 남은 것 — 맡겼는가, 맡기지 못했는가, 아니면 지금은 맡길 수 없었는가.
 * "지금은 맡길 수 없다"는 실패가 아니다 (까닭은 화면에 한 줄로 말한다).
 */
export type SaveTurn = "saved" | "failed" | "blocked";

/** 그래프를 서버로 보내는 길. 시험은 이 자리에 가짜를 꽂는다. */
export type SendSpec = (spec: AgentSpec) => Promise<SaveOutcome>;

export interface SaveSlice {
  /** 서버가 마지막으로 돌려준 그래프 — 지금 캔버스와 견주어 무엇이 안 저장됐는지 안다 */
  savedSpec: AgentSpec | null;
  saving: boolean;
  sendSpec: SendSpec;
  /** 지금 그래프를 서버에 맡긴다 */
  saveSpec: () => Promise<SaveTurn>;
  /**
   * 먼저 저장하고, 사람이 넣어 준 값과 함께 실행한다 —
   * 실행 기록에 적히는 판은 서버가 매긴 판이다.
   */
  saveThenRun: (input?: Record<string, unknown>) => Promise<void>;
}

/** 서버가 매긴 판 번호 — 저장한 적이 없으면 없다. */
export function savedVersion(state: EditorState): number | null {
  return state.savedSpec?.version ?? null;
}

/** 저장한 뒤로 그래프가 달라졌는가 — 서버가 준 그래프와 지금 캔버스를 내용으로 견준다. */
export function unsavedChanges(state: EditorState): boolean {
  if (state.savedSpec === null) return false;
  return !sameGraph(state.exportSpec(), state.savedSpec);
}

/**
 * 이 캔버스를 두고 나가면 잃을 것이 있는가 — "저장한 뒤로 달라졌는가"와는 다른 물음이다.
 * 한 번도 맡기지 않은 문서는 통째로 잃는 것이므로, 달라진 곳을 셀 것도 없이 잃을 것이 있다.
 */
export function unsavedWork(state: EditorState): boolean {
  if (state.spec === null) return false;
  return state.savedSpec === null || unsavedChanges(state);
}

/**
 * 문서 카드가 늘 보여주는 한 줄 — 지금 이 그래프는 어디까지 저장돼 있는가.
 * 화면은 이 함수에 값 세 개만 건넨다 (매번 새 문장을 만들어 다시 그리게 하지 않으려고).
 */
export function captionFor(
  saving: boolean,
  version: number | null,
  changed: boolean,
): Message {
  if (saving) return msg("save.caption.saving");
  if (version === null) return msg("save.caption.never");
  return changed ? msg("save.caption.changed") : msg("save.caption.saved", { version });
}

export function saveCaption(state: EditorState): Message {
  return captionFor(state.saving, savedVersion(state), unsavedChanges(state));
}

/**
 * 지금 저장할 수 없는 까닭 — 없으면 저장할 수 있다.
 * 조용히 넘어가지 않기 위해, 부르는 쪽이 아니라 여기서 한 곳으로 모아 답한다.
 */
function whyNotNow(state: EditorState): Message | null {
  if (state.spec === null) return msg("save.none");
  if (state.saving) return msg("save.caption.saving");
  if (isRunning(state)) return msg("save.locked.running");
  if (state.pendingDetach !== null) return msg("save.locked.asking");
  return null;
}

function toldAbout(outcome: SaveOutcome): FeedbackNotice {
  if (outcome.failure) return { message: outcome.failure, tone: "danger" };
  const count = outcome.issues?.length ?? 0;
  // 저장은 벌주지 않는다 — 손볼 곳이 남아도 저장은 됐다고 먼저 말한다.
  return count === 0
    ? { message: msg("save.ok"), tone: "ok" }
    : { message: msg("save.ok.issues", { count }), tone: "warn" };
}

export const createSaveSlice: StateCreator<EditorState, [], [], SaveSlice> = (
  set,
  get,
) => ({
  savedSpec: null,
  saving: false,
  sendSpec: (spec) => sendSpecToServer(spec),

  saveSpec: async () => {
    // 빈 그래프로 남의 문서를 덮지 않고, 두 번 저장하지 않고, 실행을 보는 동안에는 맡기지 않는다.
    const why = whyNotNow(get());
    if (why) {
      set({ feedbackNotice: { message: why, tone: "warn" } });
      return "blocked";
    }

    set({ saving: true });
    const sent = get().exportSpec();
    const outcome = await get().sendSpec(sent);
    // 오가는 사이에 캔버스가 달라졌다면, 서버가 매긴 판은 지금 그래프의 판이 아니다.
    // 그때는 기준을 갈아 끼우지 않는다 — 캡션이 '저장 안 된 변경'이라 말해 준다.
    const stillTheSame = sameGraph(get().exportSpec(), sent);
    const saved = outcome.saved ? asCanvasWouldWriteIt(outcome.saved) : null;
    set({
      saving: false,
      feedbackNotice: toldAbout(outcome),
      ...(saved ? { savedSpec: saved, ...(stillTheSame ? { spec: saved } : {}) } : {}),
    });
    // 서버에 자리를 얻은 문서는 주소에도 남는다 — 새로고침하면 방금 저장한 것으로 돌아온다.
    if (saved) get().address.remember(saved.id);
    return outcome.saved ? "saved" : "failed";
  },

  saveThenRun: async (input) => {
    // 이미 저장이 오가는 중이거나, 실행을 부탁해 둔 중이거나, 실행을 보는 중이면 새로 시작하지 않는다.
    if (get().saving || get().startingRun || isRunning(get())) return;
    // 서버는 저장된 판을 돌린다 — 저장하지 못한 채로 실행하면 화면과 다른 그래프가 조용히 돈다.
    const turn = await get().saveSpec();
    if (turn === "failed") {
      set({ feedbackNotice: { message: msg("save.run.blocked"), tone: "warn" } });
      return;
    }
    // 맡길 수 없었던 까닭은 saveSpec이 이미 한 줄로 말해 두었다.
    const revision = get().savedSpec?.revision;
    if (turn === "blocked" || revision === undefined) return;
    await get().startRun(revision, input);
  },
});
