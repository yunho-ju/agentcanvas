/* eslint-disable */
/**
 * packages/contracts/json_schema/approval_answer.json 에서 생성된 파일입니다. 직접 수정하지 마세요.
 * 다시 만들기: pnpm gen:types
 */

export type Approved = boolean;
export type Values = {
  [k: string]: unknown;
} | null;

/**
 * 밸브 앞에서 사람이 내린 답 — 허락인가, 그리고 함께 적어 넣은 값이 있는가.
 *
 * 거절(approved=false)에는 values를 실을 수 없다 — 허락하지 않은 값이 실행에 남지 않는다.
 */
export interface ApprovalAnswer {
  approved: Approved;
  values?: Values;
}
