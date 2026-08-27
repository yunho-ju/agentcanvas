/* eslint-disable */
/**
 * packages/contracts/json_schema/eval_batch.json 에서 생성된 파일입니다. 직접 수정하지 마세요.
 * 다시 만들기: pnpm gen:types
 */

export type DatasetId = string;
export type Id = string;
export type OutputText = string;
export type Passed = boolean;
export type RunId = string;
export type Attempts = EvalAttempt[];
export type CaseId = string;
export type Evaluator = string;
export type EvaluatorVersion = string;
export type Passed1 = boolean;
export type Results = EvalCaseResult[];
export type SpecId = string;
export type SpecRevision = string;
export type StartedAt = string;

/**
 * 데이터셋 하나를 어느 판에 대고 돌린 한 벌의 결과.
 *
 * v1 배치는 spec을 그대로 돈다 — 스펙이 쓰는 모델은 spec_revision이 가리키는 그래프
 * 안에 있다. 검증하지 않은 모델 이름을 여기 따로 적어 두지 않는다(모델 비교 배치는 v2).
 */
export interface EvalBatch {
  dataset_id: DatasetId;
  id: Id;
  results: Results;
  spec_id: SpecId;
  spec_revision: SpecRevision;
  started_at: StartedAt;
}
/**
 * 케이스 하나의 결론 — 몇 번 돌렸고, passes_needed를 채웠는가.
 */
export interface EvalCaseResult {
  attempts: Attempts;
  case_id: CaseId;
  evaluator: Evaluator;
  evaluator_version: EvaluatorVersion;
  passed: Passed1;
}
/**
 * 케이스 하나를 한 번 돌린 시도 — 어느 실행이었고, 통과했는가, 무엇을 답했는가.
 */
export interface EvalAttempt {
  output_text: OutputText;
  passed: Passed;
  run_id: RunId;
}
