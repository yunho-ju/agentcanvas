// Python `agentcanvas_contracts.evaluator_catalog`의 TS 미러 — registry.ts가 node_registry.json을
// 미러하는 것과 같은 방식이다. 판정기 설명은 이 자리에서만 온다 (설계 원칙 §4.2 — 손 복제 금지).
import catalogData from "../../../../packages/contracts/json_schema/evaluator_catalog.json";
import type { EvaluatorDef } from "../generated/evaluator_def";
import type { MessageKey } from "../i18n/messages";

export const evaluatorCatalog: Record<string, EvaluatorDef> = catalogData as unknown as Record<
  string,
  EvaluatorDef
>;

/** 사다리 0층 — 답에 기대하는 말이 글자 그대로 들어있는지 본다. */
export const EXPECTED_PHRASES_EVALUATOR = "expected_phrases";

/** 그 위의 층 — 글자가 달라도 답이 그 뜻을 담고 있는지 본다(서버에 설치됐을 때만 선다). */
export const NLI_ENTAILMENT_EVALUATOR = "nli_entailment";

/** 사다리 맨 위 — 심판 모델이 뜻을 보고 판정한다(사람이 켠 실행에서만 선다). */
export const LLM_JUDGE_EVALUATOR = "llm_judge";

/**
 * 0층이 놓친 회차를 구제한 층 → 그 회차에 붙는 쉬운 말 (DESIGN §7 eval-case-card).
 * 화면은 층 이름으로 분기하지 않는다: 층이 늘면 여기 한 줄이 는다.
 * 0층(글자 확인)은 구제가 아니므로 여기 없고, 표에 없는 이름은 아무 말도 하지 않는다.
 */
export const RESCUE_LINE: Record<string, MessageKey> = {
  [NLI_ENTAILMENT_EVALUATOR]: "eval.case.rescued",
  [LLM_JUDGE_EVALUATOR]: "eval.case.rescued.judge",
};
