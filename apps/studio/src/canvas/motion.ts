// 코드가 tokens.css에 적힌 값을 읽어야 할 때 — 시간과 길이. 값의 출처는 여전히 tokens.css다.
// 모션을 원치 않는 사용자에게는 토큰 자체가 짧아지므로 이 함수들이 따로 살필 일이 없다.

/** `--space-2` 같은 길이 토큰을 픽셀로. 읽을 수 없으면 0 — 값을 지어내지 않는다. */
export function tokenLengthPx(token: string): number {
  const amount = Number.parseFloat(
    getComputedStyle(document.documentElement).getPropertyValue(token),
  );
  return Number.isNaN(amount) ? 0 : amount;
}

/** `--dur-enter` 같은 시간 토큰을 밀리초로. 읽을 수 없으면 움직이지 않는다. */
export function motionDurationMs(token: string): number {
  const value = getComputedStyle(document.documentElement).getPropertyValue(token).trim();
  const amount = Number.parseFloat(value);
  if (Number.isNaN(amount)) return 0;
  return value.endsWith("ms") ? amount : amount * 1000;
}
