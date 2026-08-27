// Python `agentcanvas_contracts.evaluator_catalog`의 TS 미러 — registry.ts가 node_registry.json을
// 미러하는 것과 같은 방식이다. 판정기 설명은 이 자리에서만 온다 (설계 원칙 §4.2 — 손 복제 금지).
import catalogData from "../../../../packages/contracts/json_schema/evaluator_catalog.json";
import type { EvaluatorDef } from "../generated/evaluator_def";

export const evaluatorCatalog: Record<string, EvaluatorDef> = catalogData as unknown as Record<
  string,
  EvaluatorDef
>;

/** v1 유일한 판정기 — 답에 기대하는 말이 들어있는지 본다. */
export const EXPECTED_PHRASES_EVALUATOR = "expected_phrases";
