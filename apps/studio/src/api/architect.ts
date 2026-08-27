import type { AgentSpec } from "../generated/agent_spec";
import type { AgentSpecPatch } from "../generated/agent_spec_patch";
import { type Message, msg } from "../i18n/messages";
import {
  type HttpResponse,
  type ServerOptions,
  type SendRequest,
  UNREADABLE,
  apiBaseUrl,
  bodyOf,
} from "./http";

/** 서버가 candidate를 검증하며 본 한 가지 — 화면은 이 계약을 raw JSON으로 펼치지 않는다. */
export interface ArchitectIssue {
  severity: string;
  code: string;
  message: string;
  node?: string | null;
  edge?: string | null;
}

export interface ArchitectEvidence {
  provider: string;
  model_ref: string;
  model_id: string;
  request_id: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  latency_ms: number | null;
  provider_processing_ms: number | null;
  request_fingerprint: string;
  external_state: "preview_only";
  persisted: false;
  watermark: "not_applicable_json_candidate";
  cost: { status: "estimate_requires_price_snapshot"; estimated_usd: number | null };
}

/** 빈 캔버스 Architect 요청의 결말 — 저장하지 않은 candidate 또는 안전한 실패다. */
export type ArchitectDraftOutcome =
  | {
      draft: AgentSpec;
      patch: AgentSpecPatch;
      issues: ArchitectIssue[];
      evidence?: ArchitectEvidence;
      failure?: undefined;
    }
  | { draft?: undefined; patch?: undefined; issues?: undefined; failure: Message };

export interface ArchitectApiOptions extends ServerOptions {
  /** 이 시한까지만 provider preview를 기다린다. */
  deadline?: AbortSignal;
}

const OK = 200;
export const ARCHITECT_DEADLINE_MS = 30_000;
const TOO_LATE = Symbol("architect request timed out");

function untilTheDeadline(deadline: AbortSignal): Promise<typeof TOO_LATE> {
  return new Promise((resolve) => {
    if (deadline.aborted) return resolve(TOO_LATE);
    deadline.addEventListener("abort", () => resolve(TOO_LATE), { once: true });
  });
}

async function askServer(
  url: string,
  body: unknown,
  options: ArchitectApiOptions,
): Promise<{ response: HttpResponse; body: unknown } | null> {
  const send = options.fetch ?? (globalThis.fetch as SendRequest);
  const deadline = options.deadline ?? AbortSignal.timeout(ARCHITECT_DEADLINE_MS);
  try {
    const answer = await Promise.race([
      send(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: deadline,
      }),
      untilTheDeadline(deadline),
    ]);
    if (answer === TOO_LATE) return null;
    return { response: answer, body: await bodyOf(answer) };
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function evidenceOf(value: unknown): ArchitectEvidence | undefined {
  return isRecord(value) ? (value as unknown as ArchitectEvidence) : undefined;
}

function draftOf(body: unknown): ArchitectDraftOutcome {
  if (!isRecord(body) || !isRecord(body.candidate) || !isRecord(body.patch) || !Array.isArray(body.issues)) {
    return { failure: msg("architect.error.strange") };
  }
  const evidence = evidenceOf(body.evidence);
  return {
    draft: body.candidate as unknown as AgentSpec,
    patch: body.patch as unknown as AgentSpecPatch,
    issues: body.issues as ArchitectIssue[],
    ...(evidence ? { evidence } : {}),
  };
}

/** 서버가 만든 canonical seed 기반 candidate를 물어본다 — 성공해도 저장은 하지 않는다. */
export async function createArchitectDraftOnServer(
  request: string,
  draftId: string,
  modelRef = "model://openai",
  options: ArchitectApiOptions = {},
): Promise<ArchitectDraftOutcome> {
  const base = options.baseUrl ?? apiBaseUrl();
  const answer = await askServer(
    `${base}/architect/draft`,
    { model_ref: modelRef, request, draft_id: draftId },
    options,
  );
  if (answer === null) return { failure: msg("architect.error.offline") };
  if (answer.body === UNREADABLE) return { failure: msg("architect.error.strange") };
  if (answer.response.status !== OK) {
    return { failure: msg("architect.error.failed", { status: String(answer.response.status) }) };
  }
  return draftOf(answer.body);
}
