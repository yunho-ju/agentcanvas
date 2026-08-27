// Python `agentcanvas_contracts.schema_catalog`의 TS 미러.
// ref가 가리키는 값의 형식은 여기서만 나온다 — 화면에 형식을 하드코딩하지 않는다.
import catalogData from "../../../../packages/contracts/json_schema/schema_catalog.json";
import type { SchemaDef } from "../generated/schema_def";

export type { SchemaDef } from "../generated/schema_def";

export const SCHEMA_CATALOG: Record<string, SchemaDef> = catalogData as unknown as Record<
  string,
  SchemaDef
>;

/** ref가 가리키는 형식 — 정확히 같은 이름만 찾고, 못 찾으면 없다고 말한다 (던지지 않는다). */
export function resolveSchema(ref: string): SchemaDef | undefined {
  return SCHEMA_CATALOG[ref];
}
