// 서버로 나가는 유일한 문. fetch를 부르는 곳은 이 파일뿐이고, 어디로 보낼지와 무엇으로 보낼지는
// 밖에서 정해 준다 (시험은 가짜를 꽂는다). 실패는 던지지 않고 쉬운 말로 돌려준다.
import type { AgentSpec } from "../generated/agent_spec";
import { type Message, msg } from "../i18n/messages";
import {
  type HttpResponse,
  type SendRequest,
  type ServerOptions,
  UNREADABLE,
  apiBaseUrl,
  bodyOf,
  reasonOf,
} from "./http";

/** 서버가 저장하며 본 것 하나 — 화면은 개수와 문장만 읽는다. */
export interface SaveIssue {
  severity: string;
  code: string;
  message: string;
}

/** 알아 두면 좋은 이야기 — 잘못이 아니므로 "손볼 곳"에 들지 않는다 (engine Severity.INFO). */
const JUST_SO_YOU_KNOW = "info";

/**
 * 정말 손봐야 하는 곳의 수 — 막는 것(error)과 살펴볼 것(warning)만 센다.
 * 세는 규칙이 화면 여기저기로 흩어지지 않게, 서버의 답을 읽는 이 자리에서만 센다.
 */
export function thingsToFix(issues: SaveIssue[] = []): number {
  return issues.filter((issue) => issue.severity !== JUST_SO_YOU_KNOW).length;
}

/** 저장의 결말 — 저장된 그래프이거나, 저장하지 못한 까닭이다. */
export type SaveOutcome =
  | { saved: AgentSpec; issues: SaveIssue[]; failure?: undefined }
  | { saved?: undefined; issues?: undefined; failure: Message };

/** 목록 한 줄 — 서버가 저장해 둔 문서를 이만큼만 말해 준다 (그래프 전체는 열 때 가져온다). */
export interface SavedDoc {
  id: string;
  name: string | null;
  version: number;
  revision: string;
  saved_at: string;
}

/** 현재 문서에 남아 있는 한 판 — 그래프 몸통은 이 읽기 전용 길에 오지 않는다. */
export interface SpecRevision {
  version: number;
  revision: string;
  created_at: string;
}

/**
 * 목록을 물어본 결말 — 목록이거나, 못 불러온 까닭이다.
 * `hasMore`는 서버가 세어 말해 준 것이다: 화면이 개수를 보고 짐작하지 않는다.
 */
export type DocListOutcome =
  | { documents: SavedDoc[]; hasMore: boolean; failure?: undefined }
  | { documents?: undefined; hasMore?: undefined; failure: Message };

/** 판 기록을 물어본 결말 — 목록이거나, 구분 가능한 실패 문장이다. */
export type RevisionHistoryOutcome =
  | { revisions: SpecRevision[]; failure?: undefined }
  | { revisions?: undefined; failure: Message };


/** 그래프 문에 건네는 것 — 어디로 보낼지와 무엇으로 보낼지. */
export type SpecApiOptions = ServerOptions;

function envelopeOf(body: unknown): SaveOutcome {
  const envelope = body as { spec?: AgentSpec; issues?: SaveIssue[] };
  if (!envelope || typeof envelope !== "object" || !envelope.spec) {
    return { failure: msg("save.failed", { reason: "no spec in the answer" }) };
  }
  return { saved: envelope.spec, issues: envelope.issues ?? [] };
}

const CREATED = 201;
const OK = 200;
const ALREADY_SAVED = 409;
const CONFLICT = 409;
const REFUSED = 422;
const PRECONDITION_REQUIRED = 428;
const NOT_THERE = 404;

/** 서버에 묻기만 하는 길(GET). 닿지 못하면 던지지 않고 없음(null)으로 돌아온다. */
async function askServer(
  url: string,
  options: SpecApiOptions,
): Promise<{ response: HttpResponse; body: unknown } | null> {
  const send = options.fetch ?? (globalThis.fetch as SendRequest);
  try {
    const response = await send(url, { method: "GET", headers: {} });
    return { response, body: await bodyOf(response) };
  } catch {
    return null;
  }
}

/** 서버가 저장해 둔 문서들 — 최근에 저장한 것이 앞에 온다. */
export async function fetchSavedDocs(
  options: SpecApiOptions = {},
): Promise<DocListOutcome> {
  const base = options.baseUrl ?? apiBaseUrl();
  const answer = await askServer(`${base}/specs`, options);
  if (answer === null) return { failure: msg("open.list.offline") };
  if (answer.body === UNREADABLE) return { failure: msg("open.list.strange") };
  if (answer.response.status !== OK) {
    return {
      failure: msg("open.list.failed", {
        reason: String(answer.response.status),
      }),
    };
  }
  return listingOf(answer.body);
}

/** 서버가 보낸 목록 봉투를 읽는다 — 모양이 다르면 목록으로 삼지 않는다. */
function listingOf(body: unknown): DocListOutcome {
  const listing = body as { documents?: unknown; has_more?: unknown };
  if (!listing || typeof listing !== "object" || !Array.isArray(listing.documents)) {
    return { failure: msg("open.list.strange") };
  }
  return {
    documents: listing.documents as SavedDoc[],
    hasMore: listing.has_more === true,
  };
}

/** 저장해 둔 문서 하나를 통째로 가져온다 — 손볼 곳은 서버가 읽는 순간 다시 재어 준다. */
export async function fetchSavedSpec(
  id: string,
  options: SpecApiOptions = {},
): Promise<SaveOutcome> {
  const base = options.baseUrl ?? apiBaseUrl();
  const answer = await askServer(`${base}/specs/${encodeURIComponent(id)}`, options);
  if (answer === null) return { failure: msg("open.offline") };
  if (answer.body === UNREADABLE) return unreadable(answer.response);
  if (answer.response.status === NOT_THERE) return { failure: msg("open.notFound") };
  if (answer.response.status !== OK) {
    return {
      failure: msg("open.failed", {
        reason: reasonOf(answer.body) || String(answer.response.status),
      }),
    };
  }
  return envelopeOf(answer.body);
}

/**
 * 저장해 둔 판 하나를 통째로 가져온다 — 지금 저장된 판을 읽는 것과 같은 봉투로 온다.
 * 게시된 판이 무엇을 받는지(대화를 열 수 있는지)는 캔버스가 아니라 이 몸통이 말한다.
 */
export async function fetchSpecRevision(
  id: string,
  revision: string,
  options: SpecApiOptions = {},
): Promise<SaveOutcome> {
  const base = options.baseUrl ?? apiBaseUrl();
  const answer = await askServer(
    `${base}/specs/${encodeURIComponent(id)}/revisions/${encodeURIComponent(revision)}`,
    options,
  );
  if (answer === null) return { failure: msg("open.offline") };
  if (answer.body === UNREADABLE) return unreadable(answer.response);
  if (answer.response.status === NOT_THERE) return { failure: msg("open.notFound") };
  if (answer.response.status !== OK) {
    return {
      failure: msg("open.failed", {
        reason: reasonOf(answer.body) || String(answer.response.status),
      }),
    };
  }
  return envelopeOf(answer.body);
}

/** 저장된 판의 머리말만 가져온다 — 서버가 준 순서를 그대로 보존한다. */
export async function fetchSpecRevisions(
  id: string,
  options: SpecApiOptions = {},
): Promise<RevisionHistoryOutcome> {
  const base = options.baseUrl ?? apiBaseUrl();
  const answer = await askServer(`${base}/specs/${encodeURIComponent(id)}/revisions`, options);
  if (answer === null) return { failure: msg("revisionHistory.offline") };
  if (answer.body === UNREADABLE) return { failure: msg("revisionHistory.strange") };
  if (answer.response.status === NOT_THERE) {
    return { failure: msg("revisionHistory.notFound") };
  }
  if (answer.response.status !== OK) {
    return {
      failure: msg("revisionHistory.failed", { status: String(answer.response.status) }),
    };
  }
  return revisionsOf(answer.body);
}

/** 서버가 보낸 판 목록을 읽는다 — 하나라도 계약 밖이면 전체를 읽을 수 없다고 말한다. */
function revisionsOf(body: unknown): RevisionHistoryOutcome {
  const envelope = body as { revisions?: unknown };
  if (
    !envelope ||
    typeof envelope !== "object" ||
    !Array.isArray(envelope.revisions) ||
    !envelope.revisions.every(isSpecRevision)
  ) {
    return { failure: msg("revisionHistory.strange") };
  }
  return { revisions: envelope.revisions };
}

function isSpecRevision(value: unknown): value is SpecRevision {
  if (!value || typeof value !== "object") return false;
  const revision = value as Partial<SpecRevision>;
  return (
    Number.isInteger(revision.version) &&
    (revision.version ?? 0) > 0 &&
    typeof revision.created_at === "string" &&
    revision.created_at.length > 0 &&
    typeof revision.revision === "string" &&
    /^sha256:[0-9a-f]{64}$/.test(revision.revision)
  );
}

/** 저장 문에 건네는 것 — 서버 자리에 더해, 이 문서가 이미 서버에 있는 줄 아는지. */
export interface SaveSpecOptions extends SpecApiOptions {
  /**
   * 화면이 이미 아는 사실: 이 문서는 서버에 있다(열어 왔거나 맡겨 봤다).
   * 그러면 만들기(POST)부터 두드리지 않고 곧장 고친다 — 아는 것을 모르는 척하지 않는다.
   */
  knownOnServer?: boolean;
}

/**
 * 그래프를 서버에 맡긴다. 처음이면 새로 만들고, 이미 있는 그래프라고 하면 고치는 길로 이어 간다 —
 * 사용자는 "저장" 한 가지만 안다.
 */
export async function sendSpecToServer(
  spec: AgentSpec,
  options: SaveSpecOptions = {},
): Promise<SaveOutcome> {
  const base = options.baseUrl ?? apiBaseUrl();
  const send = options.fetch ?? (globalThis.fetch as SendRequest);
  const body = JSON.stringify(spec);
  const headers = { "content-type": "application/json" };

  /** 서버에 새로 만든다. */
  async function create(): Promise<HttpResponse> {
    return send(`${base}/specs`, { method: "POST", headers, body });
  }

  /** 서버에 이미 있는 그 문서를 고친다 — 손에 든 판이 서버의 지금 판일 때만 받아 준다. */
  async function replace(): Promise<HttpResponse> {
    return send(`${base}/specs/${encodeURIComponent(spec.id)}`, {
      method: "PUT",
      headers: { ...headers, "If-Match": spec.revision },
      body,
    });
  }

  async function read(response: HttpResponse, ok: number): Promise<SaveOutcome> {
    const answer = await bodyOf(response);
    return response.status === ok ? answerOf(response, answer) : failureOf(response, answer);
  }

  try {
    if (options.knownOnServer) {
      const changed = await replace();
      // 서버가 "그런 문서 없다"고 하면 서버가 옳다 — 화면의 기억을 접고 새로 만든다.
      if (changed.status !== NOT_THERE) return await read(changed, OK);
      return await read(await create(), CREATED);
    }

    const created = await create();
    // 서버가 "이미 있다"고 하면 서버가 옳다 — 화면이 몰랐어도 고치는 길로 이어 간다.
    if (created.status !== ALREADY_SAVED) return await read(created, CREATED);
    return await read(await replace(), OK);
  } catch {
    // 서버가 꺼져 있거나 길이 막혔다 — 편집한 것은 화면에 그대로 있다.
    return { failure: msg("save.offline") };
  }
}

function answerOf(response: HttpResponse, body: unknown): SaveOutcome {
  return body === UNREADABLE ? unreadable(response) : envelopeOf(body);
}

/** 닿기는 닿았는데 우리가 아는 말이 아니다 — 꺼져 있는 것과 다른 일이다. */
function unreadable(response: HttpResponse): SaveOutcome {
  return { failure: msg("save.unreadable", { status: response.status }) };
}

function failureOf(response: HttpResponse, body: unknown): SaveOutcome {
  if (body === UNREADABLE) return unreadable(response);
  const reason = reasonOf(body);
  if (response.status === CONFLICT) {
    return { failure: msg("save.conflict") };
  }
  if (response.status === REFUSED) {
    return {
      failure: reason
        ? msg("save.refused", { reason })
        : msg("save.refused.contract"),
    };
  }
  if (response.status === PRECONDITION_REQUIRED) {
    return { failure: msg("save.precondition") };
  }
  return { failure: msg("save.failed", { reason: reason || String(response.status) }) };
}
