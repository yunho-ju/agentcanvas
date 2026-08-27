import { apiBaseUrl } from "./api/http";

export const AUTH_EXPIRED_EVENT = "agentcanvas:auth-expired";

let csrfToken: string | null = null;
let installed = false;

export interface SessionAnswer {
  authenticated: boolean;
  csrf_token: string | null;
}

export function setCsrfToken(token: string | null): void {
  csrfToken = token;
}

/**
 * 앱의 진짜 fetch에 세션 쿠키와 CSRF를 한 번만 연결한다.
 * API 모듈에 주입된 test fetch는 그대로 두어 도메인 회귀와 인증 회귀를 섞지 않는다.
 */
export function installAuthenticatedFetch(): void {
  if (installed) return;
  installed = true;
  const nativeFetch = globalThis.fetch.bind(globalThis);
  globalThis.fetch = async (input, init = {}) => {
    const method = (init.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
    const headers = new Headers(init.headers ?? (input instanceof Request ? input.headers : undefined));
    if (csrfToken && ["POST", "PUT", "PATCH", "DELETE"].includes(method)) {
      headers.set("X-CSRF-Token", csrfToken);
    }
    const response = await nativeFetch(input, {
      ...init,
      method,
      headers,
      credentials: "include",
    });
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (
      response.status === 401 &&
      !url.endsWith("/auth/login") &&
      !url.endsWith("/auth/session")
    ) {
      csrfToken = null;
      window.dispatchEvent(new Event(AUTH_EXPIRED_EVENT));
    }
    return response;
  };
}

export async function readSession(): Promise<SessionAnswer | null> {
  try {
    const response = await globalThis.fetch(`${apiBaseUrl()}/auth/session`);
    if (response.status === 401) return { authenticated: false, csrf_token: null };
    if (!response.ok) return null;
    const answer = (await response.json()) as SessionAnswer;
    if (answer.authenticated !== true) return { authenticated: false, csrf_token: null };
    setCsrfToken(typeof answer.csrf_token === "string" ? answer.csrf_token : null);
    return answer;
  } catch {
    return null;
  }
}

export async function login(password: string): Promise<SessionAnswer | null> {
  try {
    const response = await globalThis.fetch(`${apiBaseUrl()}/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password }),
    });
    if (!response.ok) return { authenticated: false, csrf_token: null };
    const answer = (await response.json()) as SessionAnswer;
    if (answer.authenticated !== true || typeof answer.csrf_token !== "string") {
      return null;
    }
    setCsrfToken(answer.csrf_token);
    return answer;
  } catch {
    return null;
  }
}

export async function logout(): Promise<void> {
  try {
    await globalThis.fetch(`${apiBaseUrl()}/auth/logout`, { method: "POST" });
  } finally {
    setCsrfToken(null);
  }
}
