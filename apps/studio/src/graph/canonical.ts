// 적는 방법을 걷어내고 내용만 남기는 하나뿐인 자리 (순수 함수 — 예외를 던지지 않는다).
//
// 같은 내용을 적는 방법은 여러 가지다: 키가 적힌 차례가 다를 수 있고(사람이 손으로 쓴 파일),
// 빈 자리를 null로 적어 보내는 쪽도 있고(서버의 pydantic) 아예 적지 않는 쪽도 있으며(화면),
// 아무 말이 없을 때 계약이 대신 적어 주는 값도 있다. 적는 방법은 내용이 아니다 —
// 그것 때문에 "달라졌다"고 말하면 사용자는 바꾸지 않은 것을 바꿨다고 듣는다.
//
// 문서 전체를 견주는 쪽(sameGraph)과 그 안의 한 조각을 견주는 쪽(연결의 도구 diff)이
// 같은 규칙을 써야 하므로, 조각의 **자리(경로)**를 함께 받는다.

/** 비어 있는 자리인가 — 적지 않은 것과 null과 빈 목록은 모두 "없음" 하나다. */
function isBlank(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (Array.isArray(value)) return value.length === 0;
  return typeof value === "object" && Object.keys(value as object).length === 0;
}

/**
 * 아무 말도 없을 때 계약이 대신 적어 주는 값 — 그 자리에 한해 "적지 않은 것"과 같은 뜻이다.
 * **자리(경로)까지 함께 적는다** — 같은 이름이 사용자의 schema 안에 있으면 그것은 내용이다.
 * 계약에 그런 자리가 늘면 여기 한 줄을 더한다.
 */
const WRITTEN_FOR_US: { at: string[]; value: unknown }[] = [
  { at: ["resources", "*", "tools", "*", "result_handling"], value: { mode: "full" } },
  { at: ["resources", "*", "approval_policy"], value: "read_only_auto" },
];

/** 문서 안에서 도구 하나가 서 있는 자리 — 도구끼리 견줄 때 이 자리부터 잰다. */
export const A_TOOL: string[] = ["resources", "*", "tools", "*"];

/** 배열 안은 자리 이름이 없다 — `*` 한 칸이 그 목록의 아무 자리나 가리킨다. */
function sits(path: string[], at: string[]): boolean {
  return path.length === at.length && path.every((step, index) => at[index] === step);
}

function isTheContractsOwnWords(path: string[], value: unknown): boolean {
  return WRITTEN_FOR_US.some(
    (written) =>
      sits(path, written.at) &&
      JSON.stringify(contentOf(value, path)) ===
        JSON.stringify(contentOf(written.value, path)),
  );
}

/** 적는 방법을 걷어내고 내용만 남긴다 — 키는 이름순으로 줄 세우고, 없는 자리는 지운다. */
function contentOf(value: unknown, path: string[]): unknown {
  if (Array.isArray(value)) return value.map((item) => contentOf(item, [...path, "*"]));
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(
        ([key, item]) => !isBlank(item) && !isTheContractsOwnWords([...path, key], item),
      )
      .sort(([one], [other]) => (one < other ? -1 : 1))
      .map(([key, item]) => [key, contentOf(item, [...path, key])]),
  );
}

/**
 * 적는 차례도 빈 자리도 계약의 기본값도 걷어낸 한 모양 — 같은 내용이면 같은 글자가 된다.
 * `at`은 이 값이 문서 안에서 서 있는 자리다 (문서 전체는 뿌리, 도구 하나는 `A_TOOL`).
 */
export function canonicalJson(value: unknown, at: string[] = []): string {
  return JSON.stringify(contentOf(value, at));
}

/** 두 값이 같은 내용인가 — 적는 방법은 보지 않는다. */
export function sameContent(one: unknown, other: unknown, at: string[] = []): boolean {
  return canonicalJson(one, at) === canonicalJson(other, at);
}
