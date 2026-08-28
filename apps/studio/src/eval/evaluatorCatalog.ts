// Python `agentcanvas_contracts.evaluator_catalog`의 TS 미러 — registry.ts가 node_registry.json을
// 미러하는 것과 같은 방식이다. 판정기 설명은 이 자리에서만 온다 (설계 원칙 §4.2 — 손 복제 금지).
import catalogData from "../../../../packages/contracts/json_schema/evaluator_catalog.json";
import type { EvaluatorDef } from "../generated/evaluator_def";

export const evaluatorCatalog: Record<string, EvaluatorDef> = catalogData as unknown as Record<
  string,
  EvaluatorDef
>;

/** 사다리 0층 — 답에 기대하는 말이 글자 그대로 들어있는지 본다. */
export const EXPECTED_PHRASES_EVALUATOR = "expected_phrases";

/** 그 위의 층 — 글자가 달라도 답이 그 뜻을 담고 있는지 본다(서버에 설치됐을 때만 선다). */
export const NLI_ENTAILMENT_EVALUATOR = "nli_entailment";
