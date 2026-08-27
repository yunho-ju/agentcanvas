// Python `agentcanvas_contracts.instruction_catalog`의 TS 미러.
// 골라 채울 시작 글은 여기서만 나온다 — 화면에 본문을 하드코딩하지 않는다.
import catalogData from "../../../../packages/contracts/json_schema/instruction_catalog.json";
import type { InstructionPresetDef } from "../generated/instruction_preset_def";

export type { InstructionPresetDef } from "../generated/instruction_preset_def";

export const INSTRUCTION_CATALOG: Record<string, InstructionPresetDef> =
  catalogData as unknown as Record<string, InstructionPresetDef>;

/** id가 가리키는 프리셋 — 정확히 같은 이름만 찾고, 못 찾으면 없다고 말한다 (던지지 않는다). */
export function resolveInstructionPreset(id: string): InstructionPresetDef | undefined {
  return INSTRUCTION_CATALOG[id];
}
