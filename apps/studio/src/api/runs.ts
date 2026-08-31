// 실행을 서버에 부탁하는 문 — 실행을 열고, 사람의 답을 보내고, 이벤트를 받아 본다.
// specs.ts와 같은 관례다: 어디로 보낼지와 무엇으로 보낼지는 밖에서 정해 주고, 실패는 던지지 않고
// 쉬운 말로 돌려준다. 이벤트는 EventSource가 아니라 fetch의 몸통 스트림으로 읽는다 —
// 끊긴 자리에서 이어 받을지 말지를 부르는 쪽이 정할 수 있어야 하기 때문이다.
import type { Run } from "../generated/run";
import type { ApprovalAnswer } from "../generated/approval_answer";
import type { RunEvent } from "../generated/run_event";
import { type Message, msg } from "../i18n/messages";
import {
  type SendRequest,
  type ServerOptions,
  UNREADABLE,
  apiBaseUrl,
  bodyOf,
  reasonOf,
} from "./http";
import { readSse } from "./sse";

/** 실행을 열어 본 결말 — 서버가 발급한 실행이거나, 열지 못한 까닭이다. */
export type RunStartOutcome =
  | { run: Run; status: string; failure?: undefined }
  | { run?: undefined; status?: undefined; failure: Message };

/** 사람의 답을 보낸 결말 — 답을 받아 준 실행이거나, 받지 못한 까닭이다. */
export type RunAnswerOutcome = RunStartOutcome;

/** 이벤트를 흘려보내는 몸통 — 진짜 fetch의 Response도 이 모양으로 읽는다. */
export interface StreamResponse {
  readonly status: number;
  chunks: AsyncIterable<string>;
}

/** 스트림을 여는 것. 시험은 가짜 청크를 흘리는 것을 꽂는다. */
export type OpenStream = (
  url: string,
  init: { signal?: AbortSignal },
) => Promise<StreamResponse>;

/**
 * 이벤트 받아 보기가 끝난 자리 — 실행이 닫혀서 끝났는가, 아니면 끊겼는가.
 * 끊겼다면 어디까지 들었는지 말해 준다: 이어 받을지는 부르는 쪽이 정한다.
 */
export interface StreamEnd {
  ended: boolean;
  lastSeq: number | null;
  failure?: Message;
}

export interface StreamWatch {
  /** 이 순번 다음부터 들려 달라 — 끊겼다 다시 물을 때 쓴다 */
  after?: number;
  onEvent: (event: RunEvent) => void;
  /** 더 듣지 않기로 했다는 뜻 — 서버에 매달린 스트림을 그 자리에서 끊는다 */
  signal?: AbortSignal;
  baseUrl?: string;
  open?: OpenStream;
}

const CREATED = 201;
const OK = 200;

/**
 * 서버가 이만큼 지나도 아무 말이 없으면 닿지 못한 것으로 한다.
 * 영원히 기다리면 실행 버튼도 승인 버튼도 영영 잠긴 채로 남는다 — 잠금은 반드시 풀려야 한다.
 */
export const SERVER_DEADLINE_MS = 15_000;

/** 실행 문에 건네는 것 — 어디로 보낼지, 무엇으로 보낼지, 얼마나 기다릴지. */
export interface RunApiOptions extends ServerOptions {
  /** 여기까지만 기다린다 — 따로 주지 않으면 SERVER_DEADLINE_MS만큼 */
  deadline?: AbortSignal;
}

/** 시한이 먼저 지나면 대답을 기다리는 일을 그만둔다 — 서버의 답과 시한이 달리기를 한다. */
function untilTheDeadline(deadline: AbortSignal): Promise<typeof TOO_LATE> {
  return new Promise((resolve) => {
    if (deadline.aborted) return resolve(TOO_LATE);
    deadline.addEventListener("abort", () => resolve(TOO_LATE));
  });
}

const TOO_LATE = Symbol("the server said nothing in time");

/** 서버가 보낸 봉투에서 실행을 꺼낸다 — 실행이 실려 있지 않으면 실행으로 삼지 않는다. */
function runOf(body: unknown, strange: Message): RunStartOutcome {
  const envelope = body as { run?: Run; status?: string };
  if (
    body === UNREADABLE ||
    !envelope ||
    typeof envelope !== "object" ||
    typeof envelope.run?.id !== "string"
  ) {
    return { failure: strange };
  }
  return { run: envelope.run, status: envelope.status ?? "" };
}

/**
 * 서버에 몸통을 실어 한 번 묻는다 — 닿지 못하거나 시한을 넘기면 던지지 않고 없음(null)으로 돌아온다.
 * 시한은 소켓에도 함께 건넨다: 우리가 기다림을 그만두면 서버로 가던 길도 끊긴다.
 */
async function tellServer(
  url: string,
  body: unknown,
  options: RunApiOptions,
): Promise<{ status: number; body: unknown } | null> {
  const send = options.fetch ?? (globalThis.fetch as SendRequest);
  const deadline = options.deadline ?? AbortSignal.timeout(SERVER_DEADLINE_MS);
  try {
    const answered = await Promise.race([
      send(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: deadline,
      }),
      untilTheDeadline(deadline),
    ]);
    if (answered === TOO_LATE) return null;
    return { status: answered.status, body: await bodyOf(answered) };
  } catch {
    return null;
  }
}

/**
 * 저장된 그래프를 서버에서 돌린다 — 어느 판을 돌릴지와, 사람이 넣은 값을 적어 보낸다.
 * 그 판이 서버의 최신 판이 아니면 서버가 물린다: 조용히 다른 판을 돌리지 않는다.
 */
export async function startRunOnServer(
  specId: string,
  specRevision: string,
  input?: Record<string, unknown>,
  options: RunApiOptions = {},
): Promise<RunStartOutcome> {
  const base = options.baseUrl ?? apiBaseUrl();
  const url = `${base}/specs/${encodeURIComponent(specId)}/runs`;
  // 넣은 값이 없으면 값 자리를 만들지 않는다 — 적지 않은 것을 적은 척 보내지 않는다.
  const asked = {
    spec_revision: specRevision,
    ...(input && Object.keys(input).length > 0 ? { input } : {}),
  };
  const answer = await tellServer(url, asked, options);
  if (answer === null) return { failure: msg("run.start.offline") };
  if (answer.status === CREATED) return runOf(answer.body, msg("run.start.strange"));
  if (answer.status === 404) return { failure: msg("run.start.notSaved") };
  if (answer.status === 409) return { failure: msg("run.start.moved") };
  if (answer.body === UNREADABLE) return { failure: msg("run.start.strange") };
  return {
    failure: msg("run.start.failed", {
      reason: reasonOf(answer.body) || String(answer.status),
    }),
  };
}

/** 대화 한 마디로 실을 것 — 어느 대화의, 누구의 말이고, 무엇을 건네는가. */
export interface ChatTurn {
  /**
   * 이 말이 이어 붙는 대화 — 같은 대화의 말들은 처음 만난 판과 계속 이야기한다.
   * 첫 말에는 없다: 서버가 그 실행의 이름으로 대화를 연다 (CHAT-1 확정 의미).
   */
  threadId?: string;
  /** 말한 이를 가리키는 이름(`end-user://...`) — 없으면 만든 사람이 자기 그래프에 말을 건 것이다 */
  endUserRef?: string;
  input?: Record<string, unknown>;
}

/**
 * 게시된 판에 말을 건다 — 어느 판과 이야기할지는 서버가 집는다.
 * 화면은 revision을 계산하지 않는다: 대화 도중 게시가 바뀌어도 하던 대화는 첫 판으로 이어진다.
 */
export async function startChatTurnOnServer(
  specId: string,
  turn: ChatTurn,
  options: RunApiOptions = {},
): Promise<RunStartOutcome> {
  const base = options.baseUrl ?? apiBaseUrl();
  const url = `${base}/specs/${encodeURIComponent(specId)}/runs`;
  // 적지 않은 것은 적은 척 보내지 않는다 — 서버는 모르는 자리를 조용히 삼키지 않는다.
  const asked = {
    revision_source: "published",
    ...(turn.threadId ? { thread_id: turn.threadId } : {}),
    ...(turn.endUserRef ? { end_user_ref: turn.endUserRef } : {}),
    ...(turn.input && Object.keys(turn.input).length > 0 ? { input: turn.input } : {}),
  };
  const answer = await tellServer(url, asked, options);
  if (answer === null) return { failure: msg("run.start.offline") };
  if (answer.status === CREATED) return runOf(answer.body, msg("run.start.strange"));
  if (answer.status === 404) return { failure: msg("run.start.notSaved") };
  if (answer.status === 409) return { failure: msg("chat.start.notPublished") };
  if (answer.body === UNREADABLE) return { failure: msg("run.start.strange") };
  return {
    failure: msg("run.start.failed", {
      reason: reasonOf(answer.body) || String(answer.status),
    }),
  };
}

/** 실행을 그만두라고 부탁한 결말 — 그만두었거나, 그만두지 못한 까닭이다. */
export type RunCancelOutcome =
  | { ok: true; failure?: undefined }
  | { ok?: undefined; failure: Message };

/**
 * 기다리던 실행을 여기서 그만둔다 — 답을 기다리는 동안에는 그 대화를 지울 수 없기 때문이다.
 * 그만둔 사실은 이벤트로 이어 온다: 이 문은 부탁이 닿았는지만 말한다.
 */
export async function cancelRunOnServer(
  runId: string,
  options: RunApiOptions = {},
): Promise<RunCancelOutcome> {
  const base = options.baseUrl ?? apiBaseUrl();
  const url = `${base}/runs/${encodeURIComponent(runId)}/cancel`;
  const said = await tellServer(url, {}, options);
  if (said === null) return { failure: msg("chat.stop.offline") };
  if (said.status === OK) return { ok: true };
  return { failure: msg("chat.stop.failed", { status: String(said.status) }) };
}

/** 밸브 앞에 멈춰 선 실행에 사람의 답을 보낸다 — 이어지는 이벤트는 스트림으로 온다. */
export async function answerGateOnServer(
  runId: string,
  answer: ApprovalAnswer,
  options: RunApiOptions = {},
): Promise<RunAnswerOutcome> {
  const base = options.baseUrl ?? apiBaseUrl();
  const url = `${base}/runs/${encodeURIComponent(runId)}/approval`;
  const said = await tellServer(url, answer, options);
  if (said === null) return { failure: msg("run.answer.offline") };
  if (said.status === OK) return runOf(said.body, msg("run.answer.strange"));
  if (said.status === 404) return { failure: msg("run.answer.gone") };
  if (said.status === 409) return { failure: msg("run.answer.moved") };
  if (said.body === UNREADABLE) return { failure: msg("run.answer.strange") };
  return {
    failure: msg("run.answer.failed", {
      reason: reasonOf(said.body) || String(said.status),
    }),
  };
}

/** 실행이 닫히는 사건들 — 이것이 오면 서버가 스트림을 닫는다 (정상 종료다). */
const RUN_CLOSED = ["run.completed", "run.failed"];

/**
 * 토막 하나에 실려 온 것을 이벤트로 읽는다 — 순번과 종류가 없으면 이벤트로 삼지 않는다.
 * 서버는 node_id를 비워서라도 적고 시각에 마이크로초까지 적는다: 글자로 견주지 않고 읽어서 넘긴다.
 */
function runEventOf(data: string): RunEvent | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    return null;
  }
  const event = parsed as { seq?: unknown; event_type?: unknown };
  if (typeof event?.seq !== "number" || typeof event.event_type !== "string") return null;
  return parsed as RunEvent;
}

/** 진짜 fetch로 스트림을 연다 — 몸통을 글자 청크로 풀어 읽는다 (jsdom 밖의 자리다). */
const openWithFetch: OpenStream = async (url, init) => {
  const response = await globalThis.fetch(url, {
    method: "GET",
    headers: { accept: "text/event-stream" },
    ...(init.signal ? { signal: init.signal } : {}),
  });
  const body = response.body;
  return {
    status: response.status,
    chunks: (async function* () {
      if (!body) return;
      const reader = body.getReader();
      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) return;
        yield decoder.decode(value, { stream: true });
      }
    })(),
  };
};

/**
 * 실행이 남기는 이벤트를 오는 대로 받아 넘긴다.
 * 실행이 닫히면 서버가 스트림을 닫는다 — 그것이 정상 종료다. 그 전에 끊기면 끊겼다고 말한다.
 */
export async function streamRunEvents(
  runId: string,
  watch: StreamWatch,
): Promise<StreamEnd> {
  const base = watch.baseUrl ?? apiBaseUrl();
  const open = watch.open ?? openWithFetch;
  const path = `${base}/runs/${encodeURIComponent(runId)}/events`;
  const url = watch.after === undefined ? path : `${path}?after=${watch.after}`;
  let lastSeq = watch.after ?? null;

  let stream: StreamResponse;
  try {
    stream = await open(url, { ...(watch.signal ? { signal: watch.signal } : {}) });
  } catch {
    return { ended: false, lastSeq, failure: msg("run.stream.lost") };
  }
  if (stream.status !== OK) {
    return { ended: false, lastSeq, failure: msg("run.stream.lost") };
  }

  let rest = "";
  try {
    for await (const chunk of stream.chunks) {
      const read = readSse(rest, chunk);
      rest = read.rest;
      for (const frame of read.frames) {
        const event = runEventOf(frame);
        if (event === null) continue;
        watch.onEvent(event);
        lastSeq = event.seq;
        if (RUN_CLOSED.includes(event.event_type)) return { ended: true, lastSeq };
      }
    }
  } catch {
    return { ended: false, lastSeq, failure: msg("run.stream.lost") };
  }
  return { ended: false, lastSeq };
}
