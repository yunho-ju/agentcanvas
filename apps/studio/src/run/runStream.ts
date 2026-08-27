// 실행 스트림의 수명과 재개 정책 — 언제 다시 붙고 언제 포기하는가.
// 네트워크 자체는 계속 api/runs.ts가 한다: 여기는 watch 함수와 콜백을 주입받아
// "몇 번 다시 잇는가·끊긴 것을 언제 실패로 보는가"만 정한다.
// 문서를 넘나드는 동안 낡은 부탁을 가려내는 세대표(generation)도 이 자리가 쥔다 —
// store는 이 인스턴스를 하나 들고 있다가 부르기만 한다.
import type { StreamEnd } from "../api/runs";
import type { RunEvent } from "../generated/run_event";
import type { Message } from "../i18n/messages";
import { msg } from "../i18n/messages";

/**
 * 실행이 남기는 이벤트를 받아 보는 길 — 실행이 닫히거나 길이 끊길 때까지 돌아오지 않는다.
 * 더 듣지 않기로 하면 `signal`로 알린다: 버린 스트림을 서버에 매달아 두지 않는다.
 */
export type WatchRun = (
  runId: string,
  watch: { after?: number; onEvent: (event: RunEvent) => void; signal?: AbortSignal },
) => Promise<StreamEnd>;

export interface RunStreamCallbacks {
  watchRunEvents: WatchRun;
  /** 이벤트가 도착했다 — 어느 실행의 것인지와 함께 넘긴다 */
  onEvent: (runId: string, event: RunEvent) => void;
  /** 더 올 이벤트가 없다는 것을 알게 됐다 — 아직 이 실행을 보고 있다면 재생도 여기서 멈춘다 */
  onLost: (runId: string) => void;
  /** 끊긴 채로 다시 잇지 못했다 — 화면에 말할 까닭 */
  onFailure: (message: Message) => void;
}

/**
 * 실행 스트림의 수명 — 언제 다시 붙고 언제 포기하는가.
 * 이 자리가 쥐는 자원은 지금 듣고 있는 스트림의 AbortController와, 문서가 몇 번째인지 세는 세대뿐이다.
 */
export class RunStream {
  private listening: AbortController | null = null;
  private generation = 0;

  constructor(private readonly callbacks: RunStreamCallbacks) {}

  /** 이 자리가 몇 번째 문서를 보고 있는가 — 부탁을 낼 때 함께 적어 둔다. */
  currentGeneration(): number {
    return this.generation;
  }

  /** 그 부탁이 지금 세대의 것이 아닌가 — 문서를 넘나드는 사이에 온 늦은 대답을 가린다. */
  stale(askedFor: number): boolean {
    return askedFor !== this.generation;
  }

  stopListening(): void {
    this.listening?.abort();
    this.listening = null;
  }

  /** 문서를 놓는다 — 듣던 스트림을 끊고 세대를 하나 올린다. */
  abandon(): void {
    this.stopListening();
    this.generation += 1;
  }

  /**
   * 서버가 흘려보내는 이벤트를 실행이 닫힐 때까지 받는다.
   * 닫히기 전에 끊기면 읽던 자리부터 한 번 더 이어 받고, 그래도 끊기면 그 사실을 말한다
   * (계속 다시 묻지 않는다 — 사람이 다시 실행하는 편이 정직하다).
   * 우리가 그만 듣기로 한 경우는 끊긴 것이 아니다 — 다시 잇지도, 아무 말도 하지 않는다.
   */
  async follow(runId: string): Promise<void> {
    this.stopListening();
    const stop = new AbortController();
    this.listening = stop;
    const onEvent = (event: RunEvent) => this.callbacks.onEvent(runId, event);
    const watch = { onEvent, signal: stop.signal };
    const first = await this.callbacks.watchRunEvents(runId, watch);
    if (first.ended || stop.signal.aborted) return;
    const again = await this.callbacks.watchRunEvents(runId, {
      ...watch,
      ...(first.lastSeq === null ? {} : { after: first.lastSeq }),
    });
    if (again.ended || stop.signal.aborted) return;
    // 더 올 이벤트가 없다는 것을 알게 됐다 — 도착을 기다리며 서 있던 재생도 여기서 멈춘다.
    // 그 사이 다른 기록을 다시 보고 있다면 그 재생은 이 실행의 것이 아니다: 건드리지 않는다.
    this.callbacks.onLost(runId);
    this.callbacks.onFailure(again.failure ?? msg("run.stream.lost"));
  }
}
