/* eslint-disable */
/**
 * packages/contracts/json_schema/optimization_proposal.json 에서 생성된 파일입니다. 직접 수정하지 마세요.
 * 다시 만들기: pnpm gen:types
 */

export type BatchId = string | null;
export type Cases = number;
export type CasesWithGaps = number;
export type En = string;
export type Ko = string;
export type PatternId = string | null;
export type TargetNodes = string[];

/**
 * 왜 이렇게 바꾸자는가 — objective·가설·대상 노드·기대 효과·근거의 봉투.
 */
export interface OptimizationProposal {
  evidence: ProposalEvidence;
  expected_effect: LocalizedText;
  hypothesis: LocalizedText;
  objective: LocalizedText;
  pattern_id?: PatternId;
  target_nodes?: TargetNodes;
}
/**
 * 무엇을 근거로 골랐는가 — 어느 eval 배치의 어떤 케이스가 근거인가 (읽기 전용 사실).
 *
 * 시험이 하나도 없으면 batch_id는 없음이고 셈도 0이다: 없는 근거를 지어내지 않는다.
 * 품질(eval)만 근거로 쓴다 — RunEvent에 token/latency/cost가 없으므로 비용·지연 근거는 없다.
 */
export interface ProposalEvidence {
  batch_id?: BatchId;
  cases?: Cases;
  cases_with_gaps?: CasesWithGaps;
}
/**
 * 화면에 그대로 나가는 한 조각의 글. 한 언어만 채운 글은 계약이 아니다.
 */
export interface LocalizedText {
  en: En;
  ko: Ko;
}
