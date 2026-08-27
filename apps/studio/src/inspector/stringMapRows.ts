// 이름->값 표를 편집하는 동안에는 "이름이 아직 비어 있는 줄"이 존재한다.
// config에는 그런 줄이 갈 수 없으므로, 화면의 줄 목록과 config를 서로 옮기는 순수 함수를 둔다.

export interface MapRow {
  name: string;
  value: string;
}

export function toRows(value: unknown): MapRow[] {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return [];
  return Object.entries(value as Record<string, unknown>).map(([name, entry]) => ({
    name,
    value: typeof entry === "string" ? entry : String(entry ?? ""),
  }));
}

export function fromRows(rows: MapRow[]): Record<string, string> {
  return Object.fromEntries(
    rows.filter((row) => row.name.trim() !== "").map((row) => [row.name, row.value]),
  );
}

/**
 * 두 번 이상 쓰인 이름들. 같은 이름이 여럿이면 마지막 값만 저장되므로
 * 사용자가 모르게 값이 사라지는 일을 막으려면 이 이름들을 알려 줘야 한다.
 */
export function duplicateNames(rows: MapRow[]): string[] {
  const seen = new Set<string>();
  const twice = new Set<string>();
  for (const { name } of rows) {
    if (name.trim() === "") continue;
    if (seen.has(name)) twice.add(name);
    seen.add(name);
  }
  return [...twice];
}

export function sameMap(rows: MapRow[], value: unknown): boolean {
  return JSON.stringify(fromRows(rows)) === JSON.stringify(fromRows(toRows(value)));
}
