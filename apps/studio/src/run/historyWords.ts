// 실행 기록 하나를 사람이 읽는 한 줄로. 숫자를 문장으로 바꾸는 일은 여기서만 한다.
import type { Locale } from "../i18n/locale";
import { counted, msg, translate } from "../i18n/messages";
import type { RunRecord } from "../store/runSlice";
import { runLengthMs } from "./player";

/** 초 단위로, 소수 한 자리까지만 (0.0초는 그냥 0초다). */
function seconds(ms: number, locale: Locale): string {
  const rounded = Math.floor(ms / 100) / 10;
  return translate(locale, msg("run.elapsed", { seconds: rounded.toLocaleString(locale) }));
}

/** 예: "실행 1 · 17단계 · 3.2초" */
export function runSummary(record: RunRecord, locale: Locale): string {
  return [
    translate(locale, msg("runHistory.name", { number: record.order })),
    translate(
      locale,
      msg(counted("runHistory.steps", record.events.length), {
        count: record.events.length,
      }),
    ),
    seconds(runLengthMs(record.events), locale),
  ].join(" · ");
}
