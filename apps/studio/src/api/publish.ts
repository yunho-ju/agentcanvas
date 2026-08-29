// 게시 문 — 저장된 판 하나를 대화 상대로 내놓거나(publish), 내리거나(unpublish), 지금 어느
// 판이 나가 있는지 묻는다(fetch). fetch를 부르는 곳은 이 파일뿐이고, 실패는 던지지 않고
// 쉬운 말로 돌려준다. 게시된 판이 없다는 것은 실패가 아니라 답이다(publication: null).
import type { SpecPublication } from "../generated/spec_publication";
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

/** 게시를 청한 결말 — 나간 판이거나, 게시하지 못한 까닭이다. */
export type PublishOutcome =
  | { publication: SpecPublication; failure?: undefined }
  | { publication?: undefined; failure: Message };

/** 게시를 물어본 결말 — 나간 판(없으면 null)이거나, 못 물어본 까닭이다. */
export type PublicationOutcome =
  | { publication: SpecPublication | null; failure?: undefined }
  | { publication?: undefined; failure: Message };

/** 게시를 내린 결말 — 내렸거나, 못 내린 까닭이다. */
export type UnpublishOutcome =
  | { ok: true; failure?: undefined }
  | { ok?: undefined; failure: Message };

export type PublishApiOptions = ServerOptions;

const OK = 200;
const NO_CONTENT = 204;
const NOT_THERE = 404;

function pathFor(base: string, id: string): string {
  return `${base}/specs/${encodeURIComponent(id)}`;
}

function isPublication(value: unknown): value is SpecPublication {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<SpecPublication>;
  return (
    typeof candidate.spec_id === "string" &&
    candidate.spec_id.length > 0 &&
    typeof candidate.revision === "string" &&
    /^sha256:[0-9a-f]{64}$/.test(candidate.revision) &&
    typeof candidate.published_at === "string" &&
    candidate.published_at.length > 0
  );
}

/** 저장된 판 하나를 게시한다 — 서버는 그 판이 저장돼 있을 때만 받아 준다. */
export async function publishSpec(
  id: string,
  revision: string,
  options: PublishApiOptions = {},
): Promise<PublishOutcome> {
  const base = options.baseUrl ?? apiBaseUrl();
  const send = options.fetch ?? (globalThis.fetch as SendRequest);
  try {
    const response = await send(pathFor(base, id) + "/publish", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ revision }),
    });
    const body = await bodyOf(response);
    if (body === UNREADABLE) {
      return { failure: msg("publish.strange") };
    }
    if (response.status === NOT_THERE) {
      return { failure: msg("publish.notSaved") };
    }
    if (response.status !== OK || !isPublication(body)) {
      return {
        failure: msg("publish.failed", {
          reason: reasonOf(body) || String(response.status),
        }),
      };
    }
    return { publication: body };
  } catch {
    return { failure: msg("publish.offline") };
  }
}

/** 게시를 내린다 — 가리키던 판이 없어진다. 이미 없어도 탈은 없다(서버가 멱등). */
export async function unpublishSpec(
  id: string,
  options: PublishApiOptions = {},
): Promise<UnpublishOutcome> {
  const base = options.baseUrl ?? apiBaseUrl();
  const send = options.fetch ?? (globalThis.fetch as SendRequest);
  try {
    const response = await send(pathFor(base, id) + "/publish", {
      method: "DELETE",
      headers: {},
    });
    if (response.status !== NO_CONTENT && response.status !== OK) {
      return { failure: msg("publish.down.failed", { status: String(response.status) }) };
    }
    return { ok: true };
  } catch {
    return { failure: msg("publish.offline") };
  }
}

/** 지금 이 문서가 대화 상대로 내놓은 판을 묻는다 — 없으면 null(실패가 아니다). */
export async function fetchPublication(
  id: string,
  options: PublishApiOptions = {},
): Promise<PublicationOutcome> {
  const base = options.baseUrl ?? apiBaseUrl();
  const send = options.fetch ?? (globalThis.fetch as SendRequest);
  let response: HttpResponse;
  try {
    response = await send(pathFor(base, id) + "/publication", {
      method: "GET",
      headers: {},
    });
  } catch {
    return { failure: msg("publish.read.offline") };
  }
  const body = await bodyOf(response);
  if (body === UNREADABLE) return { failure: msg("publish.strange") };
  if (response.status !== OK) {
    return { failure: msg("publish.read.failed", { status: String(response.status) }) };
  }
  if (body === null) return { publication: null };
  if (!isPublication(body)) return { failure: msg("publish.strange") };
  return { publication: body };
}
