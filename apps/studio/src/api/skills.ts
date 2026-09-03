// 주소 하나를 주면 그 자리의 SKILL.md 원문을 가져다 주는 문.
// 화면은 주소를 스스로 부르지 않는다 — 어디까지 부를 수 있는지는 서버가 정한다.
import type { ServerHit } from "../graph/skillHits";
import { type Message, type MessageKey, msg } from "../i18n/messages";
import {
  type ServerOptions,
  type SendRequest,
  UNREADABLE,
  apiBaseUrl,
  bodyOf,
  reasonOf,
} from "./http";

const OK = 200;
export const SKILL_FETCH_DEADLINE_MS = 15_000;
export const SKILL_SEARCH_DEADLINE_MS = 15_000;

/**
 * 가져온 원문, 또는 안전한 실패.
 * 어디서 왔는가는 사람이 적은 그 주소다 — 서버가 저장소 안에서 어느 파일을 열었는지는
 * 우리가 찾아본 길일 뿐이라 문서의 출처로 적지 않는다.
 */
export interface SkillFetchOutcome {
  text?: string;
  failure?: Message;
}

/** 서버가 대는 까닭 -> 사람이 읽을 한 줄. 모르는 까닭은 일반 문구로 말한다. */
const FETCH_TROUBLE: Record<string, MessageKey> = {
  "skill.fetch.host": "skillImport.error.host",
  "skill.fetch.notfound": "skillImport.error.notFound",
  "skill.fetch.toolarge": "skillImport.error.tooLarge",
  "skill.fetch.timeout": "skillImport.error.timeout",
  "skill.fetch.ratelimited": "skillImport.error.rateLimited",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** 주소 하나가 가리키는 SKILL.md 원문을 물어본다 — 읽는 것은 화면의 파서다. */
export async function fetchSkillOnServer(
  url: string,
  options: ServerOptions & { deadline?: AbortSignal } = {},
): Promise<SkillFetchOutcome> {
  const send = options.fetch ?? (globalThis.fetch as SendRequest);
  const base = options.baseUrl ?? apiBaseUrl();
  let answer: Awaited<ReturnType<SendRequest>>;
  try {
    answer = await send(`${base}/skills/fetch?url=${encodeURIComponent(url)}`, {
      method: "GET",
      headers: {},
      signal: options.deadline ?? AbortSignal.timeout(SKILL_FETCH_DEADLINE_MS),
    });
  } catch {
    return { failure: msg("skillImport.error.offline") };
  }
  const body = await bodyOf(answer);
  if (body === UNREADABLE) return { failure: msg("skillImport.error.strange") };
  if (answer.status !== OK) {
    const known = FETCH_TROUBLE[reasonOf(body)];
    return { failure: msg(known ?? "skillImport.error.strange") };
  }
  if (!isRecord(body) || typeof body.text !== "string") {
    return { failure: msg("skillImport.error.strange") };
  }
  return { text: body.text };
}

/** 찾은 줄들, 또는 안전한 실패. 바깥에 닿았는지는 결과 없음과 다른 일이라 따로 말한다. */
export interface SkillSearchOutcome {
  hits?: ServerHit[];
  remoteReached?: boolean;
  failure?: Message;
}

/** 어디서 온 줄인지 — 서버가 말할 수 있는 것은 이 둘뿐이다. */
const ORIGINS = ["starter", "remote"];

function isTextOrNothing(value: unknown): boolean {
  return value === null || value === undefined || typeof value === "string";
}

/**
 * 서버가 준 줄 하나가 우리가 그릴 수 있는 모양인가 — 자료형을 믿고 그리지 않는다.
 * 모양이 다르면 그 답은 통째로 "알 수 없는 답"이다(반쯤 이해한 줄을 그리지 않는다).
 */
function isHit(value: unknown): value is ServerHit {
  return (
    isRecord(value) &&
    typeof value.name === "string" &&
    typeof value.origin === "string" &&
    ORIGINS.includes(value.origin) &&
    isTextOrNothing(value.description) &&
    isTextOrNothing(value.url) &&
    isTextOrNothing(value.owner_repo) &&
    isTextOrNothing(value.ref) &&
    (value.installs === null || value.installs === undefined || typeof value.installs === "number")
  );
}

/** 무엇을 잘하게 하고 싶은지 서버에 물어본다 — 바깥 목록을 부르는 것은 서버의 일이다. */
export async function searchSkillsOnServer(
  query: string,
  options: ServerOptions & { deadline?: AbortSignal } = {},
): Promise<SkillSearchOutcome> {
  const send = options.fetch ?? (globalThis.fetch as SendRequest);
  const base = options.baseUrl ?? apiBaseUrl();
  let answer: Awaited<ReturnType<SendRequest>>;
  try {
    answer = await send(`${base}/skills/search?q=${encodeURIComponent(query)}`, {
      method: "GET",
      headers: {},
      signal: options.deadline ?? AbortSignal.timeout(SKILL_SEARCH_DEADLINE_MS),
    });
  } catch {
    return { failure: msg("skillImport.error.offline") };
  }
  const body = await bodyOf(answer);
  if (body === UNREADABLE) return { failure: msg("skillImport.error.strange") };
  if (answer.status !== OK) return { failure: msg("skillImport.error.strange") };
  if (!isRecord(body) || !Array.isArray(body.hits) || !body.hits.every(isHit)) {
    return { failure: msg("skillImport.error.strange") };
  }
  return { hits: body.hits, remoteReached: body.remote_reached === true };
}
