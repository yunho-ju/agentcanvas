// 문서 하나 = 시험 묶음 하나 (v1 관례) — dataset의 이름표는 spec_id에서 결정적으로 짓는다.
// 여러 문서가 시험 묶음을 나눠 갖는 일은 EVAL-4 이후다 (DESIGN §10 gap).

/** spec_id가 가리키는 문서의 시험 묶음 id. 같은 문서는 언제나 같은 묶음을 가리킨다. */
export function datasetIdFor(specId: string): string {
  return `ds-${specId}`;
}
