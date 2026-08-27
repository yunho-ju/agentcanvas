// config 값 <-> 입력 상자의 문자열. 컴포넌트는 이 함수들만 부르고 스스로 변환하지 않는다.

/** 값 하나를 바꾼 새 묶음 — 빈 값은 남기지 않고 지운다("채웠다"고 오해되지 않게). */
export function withValue(
  values: Record<string, unknown>,
  name: string,
  value: unknown,
): Record<string, unknown> {
  const next = { ...values };
  if (value === undefined) delete next[name];
  else next[name] = value;
  return next;
}

export function asText(value: unknown): string {
  if (value === undefined || value === null) return "";
  return typeof value === "string" ? value : String(value);
}

/** 빈 입력은 값이 아니라 "값 없음"이다 — config에 빈 문자열을 남기지 않는다. */
export function fromText(text: string): string | undefined {
  return text === "" ? undefined : text;
}

export function toNumber(text: string): number | undefined {
  if (text.trim() === "") return undefined;
  const parsed = Number(text);
  return Number.isNaN(parsed) ? undefined : parsed;
}

export function asLines(value: unknown): string {
  return Array.isArray(value) ? value.map(asText).join("\n") : asText(value);
}

export function fromLines(text: string): string[] | undefined {
  const items = text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
  return items.length === 0 ? undefined : items;
}

export function asJsonText(value: unknown): string {
  return value === undefined ? "" : JSON.stringify(value, null, 2);
}

export type ParsedJson = { ok: true; value: unknown } | { ok: false };

/** 예외를 던지지 않는다 — 아직 JSON이 아닌 글자도 편집 중에는 정상이다. */
export function parseJson(text: string): ParsedJson {
  if (text.trim() === "") return { ok: true, value: undefined };
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false };
  }
}
