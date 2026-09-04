// 모양이 이 문서에서 무엇을 바꿨는지 사람이 읽는 말로 (순수 함수, graph/impactWords.ts와 같은 자리).
// 카드도 선도 늘지 않는 모양은 바뀐 칸을 말해 주지 않으면 아무 일도 없던 것처럼 보인다.
import type { Locale } from "../i18n/locale";
import { fieldTitle } from "../inspector/schemaForm";
import { nodeTypes } from "../registry/registry";
import type { Scene } from "./scene";
import type { FlowNode } from "./serialize";

/** 이 모양이 설정을 바꾼 단계 — 바뀐 칸의 이름까지. 바꾼 것이 없으면 없다. */
export interface SettingsChange {
  id: string;
  fields: Record<Locale, string>;
}

function configOf(node: FlowNode | undefined): Record<string, unknown> {
  return node?.data.spec.config ?? {};
}

function changedFieldsOf(
  was: Record<string, unknown>,
  now: Record<string, unknown>,
): string[] {
  return [...new Set([...Object.keys(was), ...Object.keys(now)])].filter(
    (key) => JSON.stringify(was[key]) !== JSON.stringify(now[key]),
  );
}

/** 그 칸을 설정 패널이 부르는 이름 — registry가 제목을 주면 그것, 없으면 칸 이름 그대로. */
function fieldNames(node: FlowNode, fields: string[]): Record<Locale, string> {
  const properties = nodeTypes[node.data.spec.type]?.config_schema.properties ?? {};
  const named = fields.map((field) => {
    const schema = (properties as Record<string, unknown>)[field];
    return fieldTitle(
      typeof schema === "object" && schema !== null
        ? (schema as Record<string, unknown>)
        : {},
      field,
    );
  });
  return {
    ko: named.map((name) => name.ko).join(", "),
    en: named.map((name) => name.en).join(", "),
  };
}

/**
 * 이 모양이 이미 서 있던 단계의 설정을 바꿨는가 — 바꿨으면 어느 단계의 무슨 칸인가.
 * 새로 놓인 카드는 스스로 보이므로 여기서 세지 않는다.
 */
export function settingsChanged(before: Scene, put: Scene): SettingsChange | null {
  for (const node of put.nodes) {
    const standing = before.nodes.find((card) => card.id === node.id);
    if (!standing) continue;
    const fields = changedFieldsOf(configOf(standing), configOf(node));
    if (fields.length > 0) return { id: node.id, fields: fieldNames(node, fields) };
  }
  return null;
}
