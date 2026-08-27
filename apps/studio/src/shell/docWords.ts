// 목록 한 줄이 말하는 것 — 언제 저장했는가. 판 번호와 이름은 문장이 알아서 채운다.
import type { Locale } from "../i18n/locale";
import { msg, translate } from "../i18n/messages";

/** 각 언어가 날짜와 시각을 적는 방식. 새 언어는 이 표에 한 줄을 더한다. */
const CLOCKS: Record<Locale, string> = { ko: "ko-KR", en: "en-US" };

/**
 * 서버가 적어 보낸 시각을 사람이 읽는 말로 옮긴다.
 * 읽을 수 없는 값은 온 그대로 내보내지 않는다 — 기계가 적은 글은 화면의 말이 아니다.
 */
export function savedWhen(savedAt: string, locale: Locale): string {
  const when = new Date(savedAt);
  if (Number.isNaN(when.getTime())) return translate(locale, msg("open.when.unknown"));
  return when.toLocaleString(CLOCKS[locale], {
    dateStyle: "medium",
    timeStyle: "short",
  });
}
