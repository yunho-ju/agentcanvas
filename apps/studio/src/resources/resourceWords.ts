// 연결과 도구를 화면의 쉬운 말로 옮기는 순수 함수들 — 컴포넌트는 이것을 그리기만 한다.
import type { ResourceBinding, ToolDef } from "../generated/agent_spec";
import type { MessageKey } from "../i18n/messages";
import { type FieldText, fieldTitle } from "../inspector/schemaForm";

/**
 * 연결 종류의 쉬운 말 — 표에 없는 종류는 원문 그대로 보여 준다(모르는 것을 지어내지 않는다).
 * 새 종류는 여기 한 줄이다.
 */
const KIND_WORDS: Record<string, MessageKey> = {
  "http.api": "resources.kind.httpApi",
  "mcp.toolset": "resources.kind.mcpToolset",
};

export function kindWord(kind: string): MessageKey | undefined {
  return KIND_WORDS[kind];
}

/** 도구 하나가 무엇을 받고 무엇을 돌려주는가 — 필드의 제목만 추린다 (raw JSON을 던지지 않는다). */
export interface ToolShape {
  inputs: FieldText[];
  outputs: FieldText[];
}

function titlesOf(schema: unknown): FieldText[] {
  if (typeof schema !== "object" || schema === null) return [];
  const properties = (schema as { properties?: unknown }).properties;
  if (typeof properties !== "object" || properties === null) return [];
  return Object.entries(properties as Record<string, unknown>).map(([name, property]) =>
    fieldTitle((property ?? {}) as Record<string, unknown>, name),
  );
}

export function toolShape(tool: ToolDef): ToolShape {
  return { inputs: titlesOf(tool.input_schema), outputs: titlesOf(tool.output_schema) };
}

/** 이 연결의 도구가 열쇠를 쓰는가 — 쓰면 이름만 적혀 있다는 사실을 함께 말한다. */
export function needsASecret(binding: ResourceBinding): boolean {
  return (binding.tools ?? []).some(
    (tool) => "auth" in tool.call && Boolean(tool.call.auth),
  );
}
