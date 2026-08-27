// 화면이 쓰는 언어. 계약(LocalizedText)도, 화면의 문구도 이 두 언어를 함께 들고 다닌다.
import type { LocalizedText } from "../generated/node_type";

export type Locale = "ko" | "en";

/** 우리가 내놓는 언어들 — 새 언어는 여기와 messages.ts에 함께 는다. */
export const LOCALES: Locale[] = ["ko", "en"];

/** 그 밖의 언어로 온 요청은 한국어로 맞이한다. */
export const FALLBACK_LOCALE: Locale = "ko";

/** "en-US"처럼 지역이 붙은 이름에서 우리가 아는 언어를 알아본다. 모르면 없다. */
export function localeOf(tag: string | undefined | null): Locale | undefined {
  const language = (tag ?? "").toLowerCase().split("-")[0];
  return LOCALES.find((locale) => locale === language);
}

/** 계약이 두 언어로 들고 온 글에서 지금 화면의 언어를 고른다. */
export function localized(
  text: LocalizedText | null | undefined,
  locale: Locale,
): string {
  return text ? text[locale] : "";
}
