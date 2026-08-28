// 두 그래프가 같은 그래프인가 (순수 함수 — 예외를 던지지 않는다).
//
// 같은 내용을 적는 방법은 여러 가지다: 키가 적힌 순서가 다를 수 있고(사람이 손으로 쓴 파일),
// 빈 자리를 null로 적어 보내는 쪽도 있고(서버의 pydantic) 아예 적지 않는 쪽도 있다(화면).
// 적는 방법은 내용이 아니다 — 그것 때문에 "달라졌다"고 말하면 사용자는 저장하고도 불안해진다.
import type { AgentSpec } from "../generated/agent_spec";

/** 비어 있는 자리인가 — 적지 않은 것과 null과 빈 목록은 모두 "없음" 하나다. */
function isBlank(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (Array.isArray(value)) return value.length === 0;
  return typeof value === "object" && Object.keys(value as object).length === 0;
}

/**
 * 아무 말도 없을 때 계약이 대신 적어 주는 값 — 그 자리에 한해 "적지 않은 것"과 같은 뜻이다.
 * 손으로 적은 문서는 비워 두고 서버는 채워서 돌려주므로, 이 둘을 다르다고 말하지 않는다.
 * **자리(경로)까지 함께 적는다** — 같은 이름이 사용자의 schema 안에 있으면 그것은 내용이다.
 * 계약에 그런 자리가 늘면 여기 한 줄을 더한다.
 */
const WRITTEN_FOR_US: { at: string[]; value: unknown }[] = [
  { at: ["resources", "*", "tools", "*", "result_handling"], value: { mode: "full" } },
];

/** 배열 안은 자리 이름이 없다 — `*` 한 칸이 그 목록의 아무 자리나 가리킨다. */
function sits(path: string[], at: string[]): boolean {
  return path.length === at.length && path.every((step, index) => at[index] === step);
}

/** 적는 차례를 걷어낸 한 모양 — 같은 내용이면 같은 글자가 된다. */
function canonical(value: unknown): string {
  return JSON.stringify(contentOf(value, []));
}

function isTheContractsOwnWords(path: string[], value: unknown): boolean {
  return WRITTEN_FOR_US.some(
    (written) => sits(path, written.at) && canonical(value) === canonical(written.value),
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

/** 두 그래프가 같은 내용인가. 키 순서나 빈 자리를 적었는지 여부는 보지 않는다. */
export function sameGraph(one: AgentSpec | null, other: AgentSpec | null): boolean {
  if (one === null || other === null) return one === other;
  return canonical(one) === canonical(other);
}
