// 대화 문 — 한 대화에 오간 말들을 되읽고(fetch), 대화를 통째로 지운다(delete).
// runs.ts와 같은 관례다: fetch를 부르는 곳은 이 파일뿐이고, 실패는 던지지 않고 쉬운 말로 돌려준다.
// 스레드는 실행들을 묶는 끈일 뿐 따로 만들어 두는 것이 아니다 — 아무도 말하지 않은 대화는
// 없다고 하지 않고 비어 있다.
import type { Run } from "../generated/run";
import type { RunEvent } from "../generated/run_event";
import { type Message, msg } from "../i18n/messages";
import {
  type SendRequest,
  type ServerOptions,
  UNREADABLE,
  apiBaseUrl,
  bodyOf,
} from "./http";

/** 오간 말을 되읽은 결말 — 말한 순서대로 선 실행들이거나, 못 읽은 까닭이다. */
export type ThreadRunsOutcome =
  | { runs: Run[]; failure?: undefined }
  | { runs?: undefined; failure: Message };

/**
 * 지난 대화 한 줄 — 무엇으로 시작했고, 몇 번 오갔고, 지금 어떤가.
 * 서버가 쌓인 이벤트에서 파생해 곁들여 준다(저장된 적이 없다). 대화는 파생 개념이라
 * 계약(generated/)에 없다: 이 문 앞에서만 쓰는 모습이다.
 */
export interface ThreadSummary {
  thread_id: string;
  /** 사람이 처음 건넨 말 — 건넨 것이 없으면 지어내지 않고 없다(null) */
  first_said: string | null;
  started_at: string;
  last_at: string;
  /** 오간 횟수 — 실행 하나가 말 한 번이다 */
  turns: number;
  last_status: string;
  spec_revision: string;
}

/** 말 한 번 — 그 실행과, 그 실행이 남긴 이벤트들(SSE로 받던 것과 같은 것). */
export interface ThreadTurn {
  run: Run;
  events: RunEvent[];
}

/** 지난 대화들을 되읽은 결말 — 최근에 말이 오간 것부터 선 요약들이거나, 못 읽은 까닭이다. */
export type SpecThreadsOutcome =
  | { threads: ThreadSummary[]; failure?: undefined }
  | { threads?: undefined; failure: Message };

/** 대화에 쌓인 이벤트를 되읽은 결말 — 실행별로 묶인 이벤트들이거나, 못 읽은 까닭이다. */
export type ThreadEventsOutcome =
  | { turns: ThreadTurn[]; failure?: undefined }
  | { turns?: undefined; failure: Message };

/** 대화를 지운 결말 — 지웠거나, 못 지운 까닭이다. */
export type ThreadDeleteOutcome =
  | { ok: true; failure?: undefined }
  | { ok?: undefined; failure: Message };

export type ThreadApiOptions = ServerOptions;

const OK = 200;
const NO_CONTENT = 204;
const STILL_GOING = 409;

function pathFor(base: string, threadId: string): string {
  return `${base}/threads/${encodeURIComponent(threadId)}`;
}

/** 한 대화에 오간 말들 — 말한 순서대로. 아무도 말하지 않은 대화는 빈 목록이다. */
export async function fetchThreadRuns(
  threadId: string,
  options: ThreadApiOptions = {},
): Promise<ThreadRunsOutcome> {
  const base = options.baseUrl ?? apiBaseUrl();
  const send = options.fetch ?? (globalThis.fetch as SendRequest);
  const answered = await fetchList(`${pathFor(base, threadId)}/runs`, send);
  if (answered.read === undefined) return { failure: answered.failure };
  return { runs: answered.read as Run[] };
}

/**
 * 서버에서 목록 하나를 받아 온다 — 던지지 않고, 못 읽었으면 까닭을 돌려준다.
 * 목록이 아닌 답은 목록으로 삼지 않는다: 반쪽만 읽은 것을 읽었다고 하지 않는다.
 */
async function fetchList(
  url: string,
  send: SendRequest,
): Promise<{ read: unknown[]; failure?: undefined } | { read?: undefined; failure: Message }> {
  try {
    const response = await send(url, { method: "GET", headers: {} });
    const body = await bodyOf(response);
    if (response.status !== OK || body === UNREADABLE || !Array.isArray(body)) {
      return {
        failure: msg("chat.thread.read.failed", { status: String(response.status) }),
      };
    }
    return { read: body };
  } catch {
    return { failure: msg("chat.thread.read.offline") };
  }
}

/** 한 그래프에서 오간 지난 대화들 — 최근에 말이 오간 것부터, 요약을 곁들여 한 번에. */
export async function fetchSpecThreads(
  specId: string,
  options: ThreadApiOptions = {},
): Promise<SpecThreadsOutcome> {
  const base = options.baseUrl ?? apiBaseUrl();
  const send = options.fetch ?? (globalThis.fetch as SendRequest);
  const answered = await fetchList(
    `${base}/specs/${encodeURIComponent(specId)}/threads`,
    send,
  );
  if (answered.read === undefined) return { failure: answered.failure };
  return { threads: answered.read as ThreadSummary[] };
}

/** 한 대화에 쌓인 이벤트 — 실행별로 묶여 말한 순서대로. 흐르는 중이면 지금까지의 스냅샷이다. */
export async function fetchThreadEvents(
  threadId: string,
  options: ThreadApiOptions = {},
): Promise<ThreadEventsOutcome> {
  const base = options.baseUrl ?? apiBaseUrl();
  const send = options.fetch ?? (globalThis.fetch as SendRequest);
  const answered = await fetchList(`${pathFor(base, threadId)}/events`, send);
  if (answered.read === undefined) return { failure: answered.failure };
  return { turns: answered.read as ThreadTurn[] };
}

/** 대화를 통째로 지운다 — 아직 끝나지 않은 말이 있으면 서버가 하나도 지우지 않는다. */
export async function deleteThreadOnServer(
  threadId: string,
  options: ThreadApiOptions = {},
): Promise<ThreadDeleteOutcome> {
  const base = options.baseUrl ?? apiBaseUrl();
  const send = options.fetch ?? (globalThis.fetch as SendRequest);
  try {
    const response = await send(pathFor(base, threadId), {
      method: "DELETE",
      headers: {},
    });
    if (response.status === NO_CONTENT || response.status === OK) return { ok: true };
    if (response.status === STILL_GOING) {
      return { failure: msg("chat.thread.delete.stillGoing") };
    }
    return {
      failure: msg("chat.thread.delete.failed", { status: String(response.status) }),
    };
  } catch {
    return { failure: msg("chat.thread.delete.offline") };
  }
}
