// 지난 대화 한 줄이 말하는 것 — 제목(첫 말)과 캡션(언제·몇 번·지금 어떤가).
// 숫자와 서버의 상태 이름을 사람의 말로 바꾸는 일은 여기서만 한다 (historyWords와 같은 관례).
import type { ThreadStatus, ThreadSummary } from "../api/threads";
import type { Locale } from "../i18n/locale";
import { type Message, counted, msg, translate } from "../i18n/messages";
import { savedWhen } from "../shell/docWords";
import { nothingSaid } from "./threadHistory";

/** 마지막 말이 지금 어떤가 — 갈래마다 한 줄. 새 갈래는 이 표에 한 줄을 더한다(분기 금지). */
const STATUS_WORDS: Record<ThreadStatus, Message> = {
  running: msg("chat.threads.status.running"),
  paused: msg("chat.threads.status.paused"),
  completed: msg("chat.threads.status.completed"),
  failed: msg("chat.threads.status.failed"),
};

/** 서버가 적은 상태 이름은 화면에 쓰지 않는다 — 쉬운 말 네 갈래로만 말한다 (§9). */
export function threadStatusWords(status: ThreadStatus): Message {
  return STATUS_WORDS[status];
}

/** 이 대화의 제목 — 첫 말이다. 건넨 말 없이 시작한 실행이면 지어내지 않고 자리표시로 말한다. */
export function threadTitle(summary: ThreadSummary, locale: Locale): string {
  return nothingSaid(summary.first_said)
    ? translate(locale, msg("chat.threads.noSaid"))
    : (summary.first_said as string);
}

/** 예: "2026. 8. 1. 오후 9:40 · 3번 오감 · 끝난 대화" */
export function threadCaption(summary: ThreadSummary, locale: Locale): string {
  return [
    savedWhen(summary.last_at, locale),
    translate(
      locale,
      msg(counted("chat.threads.turns", summary.turns), { count: summary.turns }),
    ),
    translate(locale, threadStatusWords(summary.last_status)),
  ].join(" · ");
}
