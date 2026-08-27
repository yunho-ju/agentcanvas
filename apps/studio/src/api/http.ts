// 서버와 말할 때 문마다 같은 것들 — 어디로 보낼지, 무엇으로 보낼지, 못 읽은 답을 무엇이라 부를지.
// 이 자리에 모으는 까닭: 같은 뜻의 심볼(UNREADABLE 같은)을 문마다 따로 만들면 서로 견줄 수 없다.

/** 서버의 대답 중 우리가 읽는 것 — 진짜 fetch의 Response도 이 모양이다. */
export interface HttpResponse {
  readonly status: number;
  json(): Promise<unknown>;
}

export type SendRequest = (
  url: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body?: string;
    /** 이 시한이 지나면 그만 기다린다 — 소켓도 여기서 끊긴다 */
    signal?: AbortSignal;
  },
) => Promise<HttpResponse>;

export interface ServerOptions {
  baseUrl?: string;
  fetch?: SendRequest;
}

/** 개발자의 컴퓨터에서 서버가 서 있는 자리 — 배포 환경은 VITE_API_URL로 정한다. */
export const DEFAULT_BASE_URL = "http://localhost:8000";

export function apiBaseUrl(): string {
  const configured = import.meta.env?.VITE_API_URL;
  return typeof configured === "string" && configured !== ""
    ? configured
    : DEFAULT_BASE_URL;
}

/** 서버가 보낸 답을 읽을 수 없었다는 뜻 — "닿지 못했다"와는 다른 일이다. */
export const UNREADABLE = Symbol("unreadable answer");

/** 서버가 무엇을 보냈든 읽어 본다 — 읽을 수 없으면 그렇다고 말한다(던지지 않는다). */
export async function bodyOf(
  response: Pick<HttpResponse, "json">,
): Promise<unknown | typeof UNREADABLE> {
  try {
    return await response.json();
  } catch {
    return UNREADABLE;
  }
}

/**
 * 서버가 무엇 때문에 못 받았는지 한 줄로.
 * 사람이 읽을 수 있는 한 문장일 때만 옮긴다 — 기계가 늘어놓은 목록은 화면에 내보내지 않는다.
 */
export function reasonOf(body: unknown): string {
  if (typeof body === "object" && body !== null && "detail" in body) {
    const detail = (body as { detail: unknown }).detail;
    if (typeof detail === "string") return detail;
  }
  return "";
}
