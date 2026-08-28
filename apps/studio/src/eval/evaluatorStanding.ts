// 이 서버에 선 판정 층 — 서버가 내려준 목록을 읽고, 무엇이 없는지 판정하는 순수 함수들.
// 이름은 evaluatorCatalog와 같은 원천(서버 카탈로그)이고, 여기서 새 이름을 짓지 않는다.

/** 층 이름 → 이 서버에서 서는가. 서버에 물어보지 못했으면 이것 자체가 없다(null). */
export type EvaluatorStanding = Record<string, boolean>;

/** 서버 답을 읽는다 — 모양이 어긋나면 아는 척하지 않고 모른다고 한다. */
export function standingOf(body: unknown): EvaluatorStanding | null {
  if (!Array.isArray(body)) return null;
  const standing: EvaluatorStanding = {};
  for (const item of body) {
    if (!item || typeof item !== "object") return null;
    const layer = item as { name?: unknown; standing?: unknown };
    if (typeof layer.name !== "string" || typeof layer.standing !== "boolean") return null;
    standing[layer.name] = layer.standing;
  }
  return standing;
}

/**
 * 이 층이 이 서버에 없다고 **아는가** — 모르면(조회 실패·서버가 말하지 않은 이름) 아니다.
 * fail-open은 이 한 줄이다: 모르는 것을 없다고 말하지 않고, 기능을 막지도 않는다.
 */
export function layerIsMissing(standing: EvaluatorStanding | null, name: string): boolean {
  return standing?.[name] === false;
}
