// 노드가 지금 무엇을 하고 있는지 쉬운 말과 모양으로 알린다.
// 색만으로 상태를 말하지 않는다 (접근성 원칙) — 글과 기호가 언제나 함께 간다.
import type { Locale } from "../i18n/locale";
import { type Message, msg, translate } from "../i18n/messages";
import type { NodeRunStatus } from "./player";

export interface StatusWord {
  /** 카드에 적히는 쉬운 말 */
  label: Message;
  /** 색을 보지 못해도 구분되는 기호 */
  mark: string;
}

/** 걸린 시간 한 조각 — 실행 중 카드가 덧붙이는 유일한 숫자다 (디자인 언어 §2.3). */
export function elapsedWords(elapsedMs: number, locale: Locale): string {
  const seconds = new Intl.NumberFormat(locale, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(elapsedMs / 1000);
  return translate(locale, msg("run.elapsed", { seconds }));
}

export const STATUS_WORDS: Record<NodeRunStatus, StatusWord> = {
  idle: { label: msg("status.idle"), mark: "·" },
  queued: { label: msg("status.queued"), mark: "…" },
  running: { label: msg("status.running"), mark: "▶" },
  // 잠긴 밸브 — 흐르지도 끝나지도 않고 사람을 기다린다.
  waiting: { label: msg("status.waiting"), mark: "✋" },
  // 사람이 답을 했고, 그 답이 아니오였다 — 손을 든 그 자리에서 흐름이 끝난다.
  rejected: { label: msg("status.rejected"), mark: "✋" },
  // 노드는 마쳤지만 그 노드가 부른 도구가 답을 가져오지 못했다 — 초록불과 갈라 말한다.
  toolFailed: { label: msg("status.toolFailed"), mark: "⚠" },
  completed: { label: msg("status.completed"), mark: "✓" },
  failed: { label: msg("status.failed"), mark: "!" },
};
