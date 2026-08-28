// 붙여 넣은 API 설명을 연결 제안으로 바꿔 달라고 서버에 묻는 자리.
// 화면은 patch 작업을 조립하지 않는다 — 서버가 만든 candidate만 안다.
import type { AgentSpec } from "../generated/agent_spec";
import { type Message, msg } from "../i18n/messages";
import {
  type ServerOptions,
  type SendRequest,
  UNREADABLE,
  apiBaseUrl,
  bodyOf,
} from "./http";

/** 사람이 무엇을 붙여 넣었는가 — 서버의 표와 같은 이름이다. */
export type ToolSourceKind = "openapi" | "curl" | "prose";

/** 저장하지 않은 제안, 또는 안전한 실패. */
export type ToolWrapOutcome =
  | { candidate: AgentSpec; issues: unknown[]; failure?: undefined }
  | { candidate?: undefined; issues?: undefined; failure: Message };

const OK = 200;
const DEFAULT_MODEL_REF = "model://openai";
export const TOOL_WRAP_DEADLINE_MS = 30_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** 무엇을 물어보는가 — 붙여 넣은 것, 그것이 무엇인지, 어느 문서 위에서, 무엇을 다시 가져오는지. */
export interface ToolWrapAsk {
  source: string;
  sourceKind: ToolSourceKind;
  baseSpec: AgentSpec;
  /** 이미 있는 연결을 다시 가져오는 중이면 그 id — 없으면 새 연결을 만드는 것이다 */
  replacing?: string | null;
  modelRef?: string;
}

/** 서버가 만든 연결 제안을 물어본다 — 성공해도 문서에 넣는 것은 사람의 승인이다. */
export async function wrapToolsOnServer(
  ask: ToolWrapAsk,
  options: ServerOptions & { deadline?: AbortSignal } = {},
): Promise<ToolWrapOutcome> {
  const send = options.fetch ?? (globalThis.fetch as SendRequest);
  const base = options.baseUrl ?? apiBaseUrl();
  let answer: Awaited<ReturnType<SendRequest>>;
  try {
    answer = await send(`${base}/tools/wrap`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model_ref: ask.modelRef ?? DEFAULT_MODEL_REF,
        source_kind: ask.sourceKind,
        source: ask.source,
        base_spec: ask.baseSpec,
        // 다시 가져오는 중일 때만 대상을 싣는다 — 없으면 새 연결을 만드는 요청 그대로다.
        ...(ask.replacing ? { replacing: ask.replacing } : {}),
      }),
      signal: options.deadline ?? AbortSignal.timeout(TOOL_WRAP_DEADLINE_MS),
    });
  } catch {
    return { failure: msg("toolWrap.error.offline") };
  }
  const body = await bodyOf(answer);
  if (body === UNREADABLE) return { failure: msg("toolWrap.error.strange") };
  if (answer.status !== OK) {
    return { failure: msg("toolWrap.error.failed", { status: String(answer.status) }) };
  }
  if (!isRecord(body) || !isRecord(body.candidate) || !Array.isArray(body.issues)) {
    return { failure: msg("toolWrap.error.strange") };
  }
  return { candidate: body.candidate as unknown as AgentSpec, issues: body.issues };
}
