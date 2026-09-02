// 이 서버가 부를 수 있는 모델을 서버에게 묻는 문 — api/eval.ts의 판정 층 조회와 같은 관례다.
// 읽는 법은 registry/modelOptions.ts가 알고, 이 파일은 그 모양에 서버 답을 옮길 뿐이다
// (의존 방향은 api → registry 한쪽으로만).
import { type ServerCatalog, serverCatalogOf } from "../registry/modelOptions";
import {
  type SendRequest,
  type ServerOptions,
  UNREADABLE,
  apiBaseUrl,
  bodyOf,
} from "./http";

const OK = 200;

/**
 * 이 서버의 런타임 카탈로그를 읽는다 — 못 들었으면 모른다고 한다(null).
 * 모른다는 답으로 아무것도 막지 않는다: 부르는 쪽이 번들 목록으로 되돌아간다(fail-open).
 */
export async function fetchServerModelsFromServer(
  options: ServerOptions = {},
): Promise<ServerCatalog | null> {
  const base = options.baseUrl ?? apiBaseUrl();
  const send = options.fetch ?? (globalThis.fetch as SendRequest);
  try {
    const response = await send(`${base}/models`, { method: "GET", headers: {} });
    const body = await bodyOf(response);
    if (body === UNREADABLE || response.status !== OK) return null;
    return serverCatalogOf(body);
  } catch {
    return null;
  }
}
