// 화면의 언어 — 지금 보고 있는 말로 "다른 말로 보기"를 권한다.
// 읽는 기계가 이 글이 무슨 말인지 알도록 문서의 lang도 여기서 맞춘다.
import { useEffect } from "react";
import type { Locale } from "./locale";
import { setLocale } from "./localeStore";
import { useLocale, useT } from "./useT";

/** 지금 언어에서 한 번 누르면 가게 되는 언어 — 두 언어이므로 표 하나면 된다. */
const NEXT_LOCALE: Record<Locale, Locale> = { ko: "en", en: "ko" };

export function LocaleToggle() {
  const locale = useLocale();
  const t = useT();
  const next = NEXT_LOCALE[locale];

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  return (
    <button
      type="button"
      className="icon-button icon-button--locale"
      aria-label={t(`locale.switchTo.${next}`)}
      title={t(`locale.switchTo.${next}`)}
      onClick={() => setLocale(next)}
    >
      <span aria-hidden="true">{next.toUpperCase()}</span>
    </button>
  );
}
