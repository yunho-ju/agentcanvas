/** 충돌 판을 구분할 만큼만 보여 주는 식별자 — digest 전체는 화면으로 새지 않는다. */
export function shortRevision(revision: string): string {
  if (!/^sha256:[0-9a-f]{64}$/.test(revision)) return "sha256:????????…";
  return `sha256:${revision.slice("sha256:".length, "sha256:".length + 8)}…`;
}
