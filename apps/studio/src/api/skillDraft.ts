// 지시문 하나를 skill 초안 한 장으로 지어 달라고 서버에 묻는 자리 (SK-5).
// 화면은 모델을 스스로 부르지 않는다 — 부를 곳이 있는지도, 무엇으로 지었는지도 서버가 말한다.
import type { SkillDef } from "../generated/skill_def";
import { type Message, msg } from "../i18n/messages";
import {
  type ServerOptions,
  type SendRequest,
  UNREADABLE,
  apiBaseUrl,
  bodyOf,
} from "./http";

const OK = 200;
/** 서버가 적은 것을 물린 자리 — 잠시 뒤 다시 해도 같은 답이 온다 (사람이 고칠 일이다). */
const REFUSED = 422;
const DEFAULT_MODEL_REF = "model://openai";
export const SKILL_DRAFT_DEADLINE_MS = 30_000;

/** 무엇이 이 초안을 지었는가 — 서버의 말 그대로다. */
export type DraftedBy = "model" | "scaffold";

/** 지어 온 초안, 또는 안전한 실패. */
export interface SkillDraftOutcome {
  text?: string;
  draftedBy?: DraftedBy;
  failure?: Message;
}

/** 무엇을 물어보는가 — 사람이 적은 것과, 참고로 함께 보내는 skill들. */
export interface SkillDraftAsk {
  instruction: string;
  name: string;
  description: string;
  references: SkillDef[];
  modelRef?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** 서버가 지은 초안을 물어본다 — 성공해도 문서에 넣는 것은 사람의 승인이다. */
export async function draftSkillOnServer(
  ask: SkillDraftAsk,
  options: ServerOptions & { deadline?: AbortSignal } = {},
): Promise<SkillDraftOutcome> {
  const send = options.fetch ?? (globalThis.fetch as SendRequest);
  const base = options.baseUrl ?? apiBaseUrl();
  let answer: Awaited<ReturnType<SendRequest>>;
  try {
    answer = await send(`${base}/skills/draft`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model_ref: ask.modelRef ?? DEFAULT_MODEL_REF,
        instruction: ask.instruction,
        name: ask.name,
        description: ask.description,
        references: ask.references,
      }),
      signal: options.deadline ?? AbortSignal.timeout(SKILL_DRAFT_DEADLINE_MS),
    });
  } catch {
    return { failure: msg("skillMake.error.offline") };
  }
  const body = await bodyOf(answer);
  if (body === UNREADABLE) return { failure: msg("skillMake.error.strange") };
  // 적은 것이 물린 것과 저쪽이 잠시 흔들린 것은 다른 일이고, 사람이 할 일도 다르다.
  if (answer.status === REFUSED) return { failure: msg("skillMake.error.refused") };
  if (answer.status !== OK) return { failure: msg("skillMake.error.strange") };
  if (
    !isRecord(body) ||
    typeof body.text !== "string" ||
    (body.drafted_by !== "model" && body.drafted_by !== "scaffold")
  ) {
    return { failure: msg("skillMake.error.strange") };
  }
  return { text: body.text, draftedBy: body.drafted_by };
}
