// 영향 분석 결과를 사용자가 읽을 문장으로 옮긴다. 여기 문장에는 기술 용어를 쓰지 않는다.
// 언어는 아직 정하지 않는다 — 화면이 읽는 순간의 언어로 옮겨진다.
import { type Message, msg } from "../i18n/messages";
import type { Impact } from "./impact";

/** 아직 하지 않은 편집("끊어진다")과 이미 한 편집("끊어졌다")은 말끝이 다르다. */
export type Tense = "will" | "did";

export function impactLines(impact: Impact, tense: Tense): Message[] {
  const lines = [
    ...(impact.brokenEdges.length > 0
      ? [msg(`impact.edges.${tense}`, { count: impact.brokenEdges.length })]
      : []),
    ...(impact.unreachableNodes.length > 0
      ? [msg(`impact.nodes.${tense}`, { count: impact.unreachableNodes.length })]
      : []),
  ];
  return lines.length > 0 ? lines : [msg("impact.nothing")];
}
