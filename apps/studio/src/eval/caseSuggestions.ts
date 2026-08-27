// AI가 지어 준 시험 제안 — 담기 전까지는 묶음이 아니다 (DESIGN §7 eval-suggest-card, EVAL-2).
// 전부 순수 함수다: 서버 답을 읽고, 그릴 때 막을 것을 판정하고, 담을 때 이름을 붙인다.
// 봉투 타입(Outcome)도 여기가 원천이다 — api/는 이 모양에 서버 답을 맞춰 옮길 뿐이다.
import type { EvalCase } from "../generated/eval_case";
import { uniqueId } from "../graph/ids";
import { type Message, msg } from "../i18n/messages";

/** 아직 담지 않은 제안 하나 — 이름(id)이 없다: 담는 그 순간에 붙는다. */
export type CaseSuggestion = Omit<EvalCase, "id">;

/** 한 번에 지어 달라고 할 수 있는 개수 — 서버 계약(ge=1, le=20)과 같은 판정이다. */
export const SUGGEST_MIN = 1;
export const SUGGEST_MAX = 20;

/** 처음 여는 개수 — 다섯 개면 한 화면에서 읽을 만하다. */
export const SUGGEST_DEFAULT = 5;

/** 지금 이 개수로 지어 달라고 할 수 있는가 — 안 되면 그 자리에서 까닭을 말한다. */
export function howManyIssue(howMany: number | undefined): Message | null {
  if (howMany === undefined || howMany < SUGGEST_MIN || howMany > SUGGEST_MAX) {
    return msg("eval.suggest.count.range", { min: SUGGEST_MIN, max: SUGGEST_MAX });
  }
  return null;
}

/** 서버가 지어 보낸 것 — 몇 개를 청했고, 그중 몇 개가 계약에 닿았는가. */
export interface SuggestionsPayload {
  askedFor: number;
  suggestions: CaseSuggestion[];
}

/** 지어 달라고 한 결말 — 제안들이거나, 지어 오지 못한 까닭이다. */
export type SuggestOutcome =
  | { payload: SuggestionsPayload; failure?: undefined }
  | { payload?: undefined; failure: Message };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function suggestionOf(value: unknown): CaseSuggestion | null {
  if (!isRecord(value)) return null;
  const phrases = value.expected_phrases;
  if (typeof value.title !== "string" || !Array.isArray(phrases) || phrases.length === 0) {
    return null;
  }
  if (!phrases.every((phrase): phrase is string => typeof phrase === "string")) return null;
  // 서버 답에도 이름은 없다 — dataset에 들어갈 이름은 담는 그 순간 이쪽에서 붙는다.
  return {
    title: value.title,
    input: isRecord(value.input) ? value.input : {},
    expected_phrases: [phrases[0], ...phrases.slice(1)],
  };
}

/** 서버 답을 제안 목록으로 읽는다 — 모양이 아니면 읽지 못했다고 말한다(지어내지 않는다). */
export function suggestionsOf(body: unknown): SuggestionsPayload | null {
  if (!isRecord(body) || typeof body.asked_for !== "number" || !Array.isArray(body.cases)) {
    return null;
  }
  const suggestions: CaseSuggestion[] = [];
  for (const offered of body.cases) {
    const one = suggestionOf(offered);
    if (one === null) return null;
    suggestions.push(one);
  }
  return { askedFor: body.asked_for, suggestions };
}

/**
 * 고른 제안들을 담을 케이스로 짓는다 — 이름은 이 자리에서 붙고, 이미 쓰인 이름을 피한다.
 * 제목이 겹치는 것은 막지 않는다: 같은 제목의 시험 둘도 서로 다른 시험이다.
 */
export function casesFromSuggestions(
  chosen: CaseSuggestion[],
  taken: string[],
): EvalCase[] {
  const names = [...taken];
  return chosen.map((suggestion) => {
    const id = uniqueId("case", names);
    names.push(id);
    return { id, ...suggestion, runs_per_case: 1, passes_needed: 1 };
  });
}

/** 이 제안이 넣는 값들 — 카드 한 줄 요약의 앞쪽('무엇을 넣고'). */
export function givenText(input: Record<string, unknown>): string {
  return Object.values(input)
    .map((value) => (typeof value === "string" ? value : JSON.stringify(value)))
    .join(", ");
}
