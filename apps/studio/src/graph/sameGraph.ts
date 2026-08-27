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

/** 적는 방법을 걷어내고 내용만 남긴다 — 키는 이름순으로 줄 세우고, 없는 자리는 지운다. */
function contentOf(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(contentOf);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => !isBlank(item))
      .sort(([one], [other]) => (one < other ? -1 : 1))
      .map(([key, item]) => [key, contentOf(item)]),
  );
}

/** 두 그래프가 같은 내용인가. 키 순서나 빈 자리를 적었는지 여부는 보지 않는다. */
export function sameGraph(one: AgentSpec | null, other: AgentSpec | null): boolean {
  if (one === null || other === null) return one === other;
  return JSON.stringify(contentOf(one)) === JSON.stringify(contentOf(other));
}
