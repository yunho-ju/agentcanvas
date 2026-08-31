// 대화 문 — 한 대화에 오간 말들을 되읽고(fetch), 대화를 통째로 지운다(delete).
// runs.ts와 같은 관례다: fetch를 부르는 곳은 이 파일뿐이고, 실패는 던지지 않고 쉬운 말로 돌려준다.
// 스레드는 실행들을 묶는 끈일 뿐 따로 만들어 두는 것이 아니다 — 아무도 말하지 않은 대화는
// 없다고 하지 않고 비어 있다.
import type { Run } from "../generated/run";
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
  try {
    const response = await send(`${pathFor(base, threadId)}/runs`, {
      method: "GET",
      headers: {},
    });
    const body = await bodyOf(response);
    if (response.status !== OK || body === UNREADABLE || !Array.isArray(body)) {
      return {
        failure: msg("chat.thread.read.failed", { status: String(response.status) }),
      };
    }
    return { runs: body as Run[] };
  } catch {
    return { failure: msg("chat.thread.read.offline") };
  }
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
