import type { AgentSpec } from "../generated/agent_spec";
import type { AgentSpecPatch } from "../generated/agent_spec_patch";
import type { PatternAnswer } from "../generated/pattern_answer";
import type { PatternAsk } from "../generated/pattern_ask";
import type { SkippedPattern } from "../generated/skipped_pattern";
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

/**
 * 빈 캔버스 Architect 요청의 결말 — 되묻기, 저장하지 않은 candidate, 안전한 실패 셋 중 하나다.
 * 물음과 초안은 함께 오지 않는다 (DESIGN §7 pattern-asks).
 */
export type ArchitectDraftOutcome =
  | {
      asks: PatternAsk[];
      draft?: undefined;
      patch?: undefined;
      issues?: undefined;
      droppedSkillRefs?: undefined;
      skippedPatterns?: undefined;
      failure?: undefined;
    }
  | {
      asks?: undefined;
      draft: AgentSpec;
      patch: AgentSpecPatch;
      issues: ArchitectIssue[];
      /** 서버가 알아보지 못해 단계에서 빼낸 skill 이름표들 — 검토 카드가 그 사실을 말한다 */
      droppedSkillRefs?: string[];
      /** 예라고 했는데 서버가 초안에 넣지 못한 모양들 — 검토 카드가 그 까닭을 말한다 */
      skippedPatterns?: SkippedPattern[];
      evidence?: ArchitectEvidence;
      failure?: undefined;
    }
  | {
      asks?: undefined;
      draft?: undefined;
      patch?: undefined;
      issues?: undefined;
      droppedSkillRefs?: undefined;
      skippedPatterns?: undefined;
      failure: Message;
    };

export interface ArchitectApiOptions extends ServerOptions {
  /** 이 시한까지만 provider preview를 기다린다. */
  deadline?: AbortSignal;
  /** 되묻기에 사람이 한 답 — 답을 실은 부름에는 서버가 다시 묻지 않는다 */
  answers?: PatternAnswer[];
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
  if (isRecord(body) && Array.isArray(body.asks) && body.asks.length > 0) {
    return { asks: body.asks as PatternAsk[] };
  }
  if (!isRecord(body) || !isRecord(body.candidate) || !isRecord(body.patch) || !Array.isArray(body.issues)) {
    return { failure: msg("architect.error.strange") };
  }
  const evidence = evidenceOf(body.evidence);
  const dropped = body.dropped_skill_refs;
  const skipped = body.skipped_patterns;
  return {
    draft: body.candidate as unknown as AgentSpec,
    patch: body.patch as unknown as AgentSpecPatch,
    issues: body.issues as ArchitectIssue[],
    droppedSkillRefs: Array.isArray(dropped) ? dropped.map(String) : [],
    skippedPatterns: Array.isArray(skipped) ? (skipped as SkippedPattern[]) : [],
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
  const answers = options.answers ?? [];
  const answer = await askServer(
    `${base}/architect/draft`,
    {
      model_ref: modelRef,
      request,
      draft_id: draftId,
      // 답이 하나도 없는 부름은 아직 아무것도 묻지 않은 부름이다 — 그때만 서버가 되묻는다.
      ...(answers.length > 0 ? { answers } : {}),
    },
    options,
  );
  if (answer === null) return { failure: msg("architect.error.offline") };
  if (answer.body === UNREADABLE) return { failure: msg("architect.error.strange") };
  if (answer.response.status !== OK) {
    return { failure: msg("architect.error.failed", { status: String(answer.response.status) }) };
  }
  return draftOf(answer.body);
}
