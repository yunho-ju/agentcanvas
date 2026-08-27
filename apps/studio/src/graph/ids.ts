// 이름은 겹치면 안 된다 — 계약이 같은 id를 두 번 허용하지 않기 때문이다.

/** 이미 쓰인 이름이면 뒤에 번호를 붙여 비어 있는 이름을 돌려준다. */
export function uniqueId(base: string, taken: string[]): string {
  if (!taken.includes(base)) return base;
  let suffix = 2;
  while (taken.includes(`${base}-${suffix}`)) suffix += 1;
  return `${base}-${suffix}`;
}
