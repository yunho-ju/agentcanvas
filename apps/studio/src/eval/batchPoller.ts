// 배치가 도는 동안의 확인 정책 — SSE 없이, 주입된 타이머로 GET을 되풀이한다 (설계 확정 결정).
// 네트워크(fetch)도 시계(setTimeout)도 이 자리는 모른다: 전부 밖에서 받는다 — 시험은 둘 다 가짜를 꽂는다.
import type { EvalBatch } from "../generated/eval_batch";
import { type Message, msg } from "../i18n/messages";

/** 조회 한 번의 결말 — 서버가 준 지금 모습이거나, 물어보지도 못한 까닭이다. */
export type BatchReadOutcome =
  | { status: "running"; batch?: undefined; failure?: undefined }
  | { status: "completed"; batch: EvalBatch; failure?: undefined }
  | { status: "failed"; batch?: undefined; failure?: undefined }
  | { status?: undefined; batch?: undefined; failure: Message };

/** 배치를 열어 본 결말 — 서버가 발급한 이름이거나, 열지 못한 까닭이다. */
export type BatchStartOutcome =
  | { batchId: string; failure?: undefined }
  | { batchId?: undefined; failure: Message };

/** 물어볼 때마다 store에 그대로 앉힐 조각 — evalSlice는 이 함수를 부르기만 한다. */
export interface BatchUpdatePatch {
  batchStatus?: "completed" | "failed";
  batch?: EvalBatch;
  caseSaveNotice?: { message: Message; tone: "warn" | "danger" };
}

/**
 * 완결·실패는 쉬운 말과 다음 걸음만 담는다(서버 원문 노출 금지). 서버에 못 닿은 한 번(failure)은
 * 배치가 죽었다는 뜻이 아니다 — 그때는 알림만 하고 되풀이는 poller가 스스로 잇는다.
 */
export function batchUpdatePatch(outcome: BatchReadOutcome): BatchUpdatePatch {
  if (outcome.status === "completed") return { batchStatus: "completed", batch: outcome.batch };
  if (outcome.status === "failed") {
    return {
      batchStatus: "failed",
      caseSaveNotice: { message: msg("eval.batch.failed"), tone: "danger" },
    };
  }
  if (outcome.failure) {
    // 연결이 안 됐는지, 서버가 알 수 없는 답을 보냈는지 — 까닭은 api/eval.ts가 이미 갈라 뒀다.
    // 여기서 하나로 뭉개지 않는다(독립 리뷰 2라운드 minor 3).
    return { caseSaveNotice: { message: outcome.failure, tone: "warn" } };
  }
  return {};
}

export type FetchBatch = (batchId: string) => Promise<BatchReadOutcome>;
export type SetTimer = (tick: () => void, ms: number) => unknown;
export type ClearTimer = (handle: unknown) => void;

/** 도는 배치를 얼마 만에 다시 물어보는가 — 값의 자리는 여기 한 곳뿐이다. */
export const EVAL_POLL_INTERVAL_MS = 750;

export interface BatchPollerCallbacks {
  fetchBatch: FetchBatch;
  /** 물어볼 때마다(완결·실패까지 포함) 지금 안 것을 알려 준다 */
  onUpdate: (outcome: BatchReadOutcome) => void;
  setTimer: SetTimer;
  clearTimer: ClearTimer;
  intervalMs?: number;
}

/** 완결됐거나, 배경에서 죽었다고 서버가 말한 상태 — 되풀이를 그칠 까닭이다. */
const TERMINAL_STATUSES = new Set(["completed", "failed"]);

/**
 * 배치 하나를 완결되거나 실패할 때까지 되풀이해 묻는다.
 * 서버에 한 번 못 닿은 것(outcome.failure)은 배치가 죽었다는 뜻이 아니다 — 그때도 되풀이는
 * 그치지 않는다(독립 리뷰 minor). 그만 듣기로 하면(stop) 이미 나간 부탁의 답은 조용히 버린다.
 */
export class BatchPoller {
  private handle: unknown = null;
  private live = false;

  constructor(private readonly callbacks: BatchPollerCallbacks) {}

  start(batchId: string): void {
    this.stop();
    this.live = true;
    void this.tick(batchId);
  }

  stop(): void {
    if (this.handle !== null) this.callbacks.clearTimer(this.handle);
    this.handle = null;
    this.live = false;
  }

  private async tick(batchId: string): Promise<void> {
    if (!this.live) return;
    const outcome = await this.callbacks.fetchBatch(batchId);
    // 기다리는 사이에 그만 듣기로 했을 수 있다 — 그 답은 이제 아무의 것도 아니다.
    if (!this.live) return;
    this.callbacks.onUpdate(outcome);
    // "running"도, 서버에 못 닿은 한 번(outcome.failure)도 되풀이를 그치지 않는다 —
    // 배치가 죽었다는 확정은 서버가 status:"failed"로 말했을 때뿐이다.
    if (outcome.status !== undefined && TERMINAL_STATUSES.has(outcome.status)) {
      this.stop();
      return;
    }
    this.handle = this.callbacks.setTimer(
      () => void this.tick(batchId),
      this.callbacks.intervalMs ?? EVAL_POLL_INTERVAL_MS,
    );
  }
}
