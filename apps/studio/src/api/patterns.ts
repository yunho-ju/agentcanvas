// 이 서버가 놓아 줄 수 있는 모양을 서버에게 묻는 문 — api/models.ts와 같은 관례다.
// 읽는 법은 registry/patternCatalog.ts가 알고, 이 파일은 그 모양에 서버 답을 옮길 뿐이다.
import { type PatternChoice, serverPatternsOf } from "../registry/patternCatalog";
import {
  type SendRequest,
  type ServerOptions,
  UNREADABLE,
  apiBaseUrl,
  bodyOf,
} from "./http";

const OK = 200;

/**
 * 이 서버의 모양 목록을 읽는다 — 못 들었으면 모른다고 한다(null).
 * 모른다는 답으로 아무것도 막지 않는다: 화면은 코드 이름 대신 칩을 세우지 않는다.
 */
export async function fetchServerPatternsFromServer(
  options: ServerOptions = {},
): Promise<PatternChoice[] | null> {
  const base = options.baseUrl ?? apiBaseUrl();
  const send = options.fetch ?? (globalThis.fetch as SendRequest);
  try {
    const response = await send(`${base}/patterns`, { method: "GET", headers: {} });
    const body = await bodyOf(response);
    if (body === UNREADABLE || response.status !== OK) return null;
    return serverPatternsOf(body);
  } catch {
    return null;
  }
}
