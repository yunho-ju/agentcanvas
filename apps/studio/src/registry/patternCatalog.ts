// 이 서버가 문서에 놓아 줄 수 있는 모양들을 화면이 읽는 모양으로 옮기는 규칙
// (registry/modelOptions.ts와 같은 문법 — 어긋난 답은 아는 척하지 않고 모른다고 한다).
import type { LocalizedText } from "../generated/pattern_def";

/** 화면이 부르는 모양 하나 — 칩에 서는 짧은 이름과, 제안문이 가리키는 id. */
export interface PatternChoice {
  id: string;
  shortName: LocalizedText;
}

/** 서버 답을 읽는다 — 모양이 어긋나면 모른다고 한다(null). 화면은 그러면 칩을 세우지 않는다. */
export function serverPatternsOf(body: unknown): PatternChoice[] | null {
  if (!body || typeof body !== "object") return null;
  const said = body as { patterns?: unknown };
  if (!Array.isArray(said.patterns)) return null;
  const patterns: PatternChoice[] = [];
  for (const item of said.patterns) {
    const pattern = asPatternChoice(item);
    if (pattern === null) return null;
    patterns.push(pattern);
  }
  return patterns;
}

function asPatternChoice(item: unknown): PatternChoice | null {
  if (!item || typeof item !== "object") return null;
  const said = item as { id?: unknown; short_name?: unknown };
  const shortName = asLocalizedText(said.short_name);
  if (typeof said.id !== "string" || shortName === null) return null;
  return { id: said.id, shortName };
}

function asLocalizedText(value: unknown): LocalizedText | null {
  if (!value || typeof value !== "object") return null;
  const text = value as { ko?: unknown; en?: unknown };
  if (typeof text.ko !== "string" || typeof text.en !== "string") return null;
  return { ko: text.ko, en: text.en };
}
