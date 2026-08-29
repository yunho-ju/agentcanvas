/* eslint-disable */
/**
 * packages/contracts/json_schema/run.json 에서 생성된 파일입니다. 직접 수정하지 마세요.
 * 다시 만들기: pnpm gen:types
 */

export type CreatedAt = string;
export type EndUserRef = string | null;
export type Id = string;
export type SpecId = string;
export type SpecRevision = string;
export type ThreadId = string;

/**
 * 한 번의 실행 — 어느 그래프의 어느 판을, 언제, 어느 스레드에서, 누구의 말로 돌렸는가.
 */
export interface Run {
  created_at: CreatedAt;
  end_user_ref?: EndUserRef;
  id: Id;
  spec_id: SpecId;
  spec_revision: SpecRevision;
  thread_id: ThreadId;
}
