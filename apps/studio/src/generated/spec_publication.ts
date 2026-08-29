/* eslint-disable */
/**
 * packages/contracts/json_schema/spec_publication.json 에서 생성된 파일입니다. 직접 수정하지 마세요.
 * 다시 만들기: pnpm gen:types
 */

export type PublishedAt = string;
export type Revision = string;
export type SpecId = string;

/**
 * 지금 이 문서가 대화 상대로 내놓은 판 하나 — 어느 그래프의 어느 판이, 언제부터.
 */
export interface SpecPublication {
  published_at: PublishedAt;
  revision: Revision;
  spec_id: SpecId;
}
