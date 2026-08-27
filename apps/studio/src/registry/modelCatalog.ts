// Python `agentcanvas_contracts.model_catalog`의 TS 미러.
// 고를 수 있는 모델 목록은 여기서만 나온다 — 화면에 목록을 하드코딩하지 않는다.
import catalogData from "../../../../packages/contracts/json_schema/model_catalog.json";
import type { ModelDef } from "../generated/model_def";

export type { ModelDef } from "../generated/model_def";

export const MODEL_CATALOG: Record<string, ModelDef> = catalogData as unknown as Record<
  string,
  ModelDef
>;

/** ref가 가리키는 모델 — 정확히 같은 이름만 찾고, 못 찾으면 없다고 말한다 (던지지 않는다). */
export function resolveModel(ref: string): ModelDef | undefined {
  return MODEL_CATALOG[ref];
}
