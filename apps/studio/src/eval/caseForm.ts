// 케이스 폼의 왕복 — 화면의 칸(줄단위 문구·횟수 두 필드)과 계약(EvalCase)을 오간다 (순수 함수).
// expected_phrases는 계약에서 배열이지만 화면에서는 줄마다 하나인 글 상자다 (DESIGN §7 eval-case-form).
import type { EvalCase } from "../generated/eval_case";
import { uniqueId } from "../graph/ids";

/** 폼이 들고 있는 값 — 아직 계약이 아니다(빈 제목·빈 문구도 여기서는 그냥 값이다). */
export interface EvalCaseDraft {
  /** 새 케이스면 아직 어느 케이스도 아니다 */
  id: string | null;
  title: string;
  /** 넣을 값 — run-input-card와 같은 원천(bindings)의 값 이름을 키로 쓴다 */
  input: Record<string, unknown>;
  /** 줄마다 하나인 "들어있어야 하는 말" */
  expectedText: string;
  /** 아직 다 못 쳤거나(예: "-") 지운 상태는 값이 아니다 — toNumber와 같은 규칙(inspector/values) */
  runsPerCase: number | undefined;
  passesNeeded: number | undefined;
}

export type NewCaseSeed = Pick<EvalCaseDraft, "title" | "input">;

/** 아직 아무것도 적지 않은 새 케이스 초안 — 기본은 1번 돌려 1번 통과다. */
export function emptyCaseDraft(): EvalCaseDraft {
  return { id: null, title: "", input: {}, expectedText: "", runsPerCase: 1, passesNeeded: 1 };
}

/** 저장된 케이스를 고쳐 쓸 수 있는 초안으로 편다. */
export function draftFromCase(evalCase: EvalCase): EvalCaseDraft {
  return {
    id: evalCase.id,
    title: evalCase.title,
    input: { ...evalCase.input },
    expectedText: evalCase.expected_phrases.join("\n"),
    runsPerCase: evalCase.runs_per_case ?? 1,
    passesNeeded: evalCase.passes_needed ?? 1,
  };
}

/** 줄마다 하나인 문구 상자를 읽는다 — 빈 줄은 문구가 아니다. */
export function phrasesFromText(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
}

/** 문구 하나를 상자에 더한다 — 줄마다 하나이므로 아래 줄에 붙이고, 적어 둔 말은 지우지 않는다. */
export function withPhrase(text: string, phrase: string): string {
  return text.trim() === "" ? phrase : `${text}\n${phrase}`;
}

/** 통과해야 할 횟수가 돌리는 횟수를 넘는가 — 계약 검증과 같은 판정을 그릴 때부터 막는다. */
export function passesExceedRuns(
  passesNeeded: number | undefined,
  runsPerCase: number | undefined,
): boolean {
  return passesNeeded !== undefined && runsPerCase !== undefined && passesNeeded > runsPerCase;
}

/** 두 횟수 다 1 이상인가 — 아직 다 못 친 값(undefined)은 이 판정에서는 "아니다"로 본다. */
export function countsAreAtLeastOne(draft: EvalCaseDraft): boolean {
  return (
    draft.runsPerCase !== undefined &&
    draft.runsPerCase >= 1 &&
    draft.passesNeeded !== undefined &&
    draft.passesNeeded >= 1
  );
}

/** 이 초안을 지금 저장할 수 있는가 — 제목·문구가 있고, 횟수가 앞뒤가 맞아야 한다. */
export function draftIsSavable(draft: EvalCaseDraft): boolean {
  return (
    draft.title.trim() !== "" &&
    phrasesFromText(draft.expectedText).length > 0 &&
    countsAreAtLeastOne(draft) &&
    !passesExceedRuns(draft.passesNeeded, draft.runsPerCase)
  );
}

/**
 * 이 초안이 저장된 그 케이스와 내용까지 같은가 — "저장했어요" 캡션은 이게 참일 때만 말할 수 있다.
 * draftFromCase로 정규화해 견준다: 배열 vs 튜플 같은 자잘한 모양 차이에 속지 않는다.
 */
export function draftMatchesCase(draft: EvalCaseDraft, evalCase: EvalCase): boolean {
  return JSON.stringify(draft) === JSON.stringify(draftFromCase(evalCase));
}

/** 초안을 계약 모양으로 짓는다 — 저장할 수 없는 초안이면 아무것도 짓지 않는다. */
export function caseFromDraft(draft: EvalCaseDraft, taken: string[]): EvalCase | null {
  if (!draftIsSavable(draft)) return null;
  const phrases = phrasesFromText(draft.expectedText);
  return {
    id: draft.id ?? uniqueId("case", taken),
    title: draft.title,
    input: draft.input,
    expected_phrases: [phrases[0], ...phrases.slice(1)],
    // draftIsSavable이 이미 countsAreAtLeastOne을 확인했다 — 여기 닿았다면 둘 다 수다.
    runs_per_case: draft.runsPerCase as number,
    passes_needed: draft.passesNeeded as number,
  };
}
