// 두 그래프가 같은 그래프인가 (순수 함수 — 예외를 던지지 않는다).
// 무엇이 "적는 방법"이고 무엇이 "내용"인지는 canonical 하나가 안다 — 여기서 다시 정하지 않는다.
import type { AgentSpec } from "../generated/agent_spec";
import { sameContent } from "./canonical";

/** 두 그래프가 같은 내용인가. 키 순서나 빈 자리를 적었는지 여부는 보지 않는다. */
export function sameGraph(one: AgentSpec | null, other: AgentSpec | null): boolean {
  if (one === null || other === null) return one === other;
  return sameContent(one, other);
}
