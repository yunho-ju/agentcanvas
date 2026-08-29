// 지금 그래프를 objective로 고쳐 달라고 서버에 묻는 자리 (OPT-1).
// 화면은 patch를 조립하지 않는다 — 서버가 만든 candidate와 제안문만 안다.
import type { AgentSpec } from "../generated/agent_spec";
import type { OptimizationProposal } from "../generated/optimization_proposal";
import { type Message, msg } from "../i18n/messages";
import {
  type SendRequest,
  type ServerOptions,
  UNREADABLE,
  apiBaseUrl,
  bodyOf,
} from "./http";

/** 저장하지 않은 후보 + 제안문, 또는 안전한 실패. */
export type OptimizeOutcome =
  | {
      candidate: AgentSpec;
      issues: unknown[];
      proposal: OptimizationProposal;
      failure?: undefined;
    }
  | { candidate?: undefined; failure: Message };

const OK = 200;
const DEFAULT_MODEL_REF = "model://openai";
export const OPTIMIZE_DEADLINE_MS = 30_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** 무엇을 물어보는가 — 무엇을 개선할지(objective)와 어느 그래프 위에서인지. */
export interface OptimizeAsk {
  objective: string;
  baseSpec: AgentSpec;
  modelRef?: string;
}

/** 서버가 만든 후보 patch + 제안문을 물어본다 — 성공해도 그래프에 넣는 것은 사람의 승인이다. */
export async function optimizeOnServer(
  ask: OptimizeAsk,
  options: ServerOptions & { deadline?: AbortSignal } = {},
): Promise<OptimizeOutcome> {
  const send = options.fetch ?? (globalThis.fetch as SendRequest);
  const base = options.baseUrl ?? apiBaseUrl();
  let answer: Awaited<ReturnType<SendRequest>>;
  try {
    answer = await send(`${base}/optimize/preview`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model_ref: ask.modelRef ?? DEFAULT_MODEL_REF,
        objective: ask.objective,
        base_spec: ask.baseSpec,
      }),
      signal: options.deadline ?? AbortSignal.timeout(OPTIMIZE_DEADLINE_MS),
    });
  } catch {
    return { failure: msg("optimize.error.offline") };
  }
  const body = await bodyOf(answer);
  if (body === UNREADABLE) return { failure: msg("optimize.error.strange") };
  if (answer.status !== OK) {
    return { failure: msg("optimize.error.failed", { status: String(answer.status) }) };
  }
  if (
    !isRecord(body) ||
    !isRecord(body.candidate) ||
    !isRecord(body.proposal) ||
    !Array.isArray(body.issues)
  ) {
    return { failure: msg("optimize.error.strange") };
  }
  return {
    candidate: body.candidate as unknown as AgentSpec,
    issues: body.issues,
    proposal: body.proposal as unknown as OptimizationProposal,
  };
}
