// 지금 화면이 쓰는 언어 하나 — 그래프의 상태가 아니므로 editor store에 두지 않는다.
// 처음에는 브라우저의 언어를 따르고, 한 번 고르면 그 선택이 기억된다.
import { FALLBACK_LOCALE, type Locale, localeOf } from "./locale";

const STORAGE_KEY = "agentcanvas.locale";

/** 사용자가 전에 골라 둔 언어. 고른 적이 없거나 우리가 모르는 언어면 없다. */
export function readStoredLocale(): Locale | undefined {
  try {
    return localeOf(globalThis.localStorage?.getItem(STORAGE_KEY));
  } catch {
    // 저장소를 막아 둔 브라우저에서도 화면은 떠야 한다.
    return undefined;
  }
}

/** 아직 고른 적이 없을 때의 언어 — 브라우저가 원하는 말로 맞이한다. */
export function browserLocale(): Locale {
  return localeOf(globalThis.navigator?.language) ?? FALLBACK_LOCALE;
}

let current: Locale | null = null;
const listeners = new Set<() => void>();

export function getLocale(): Locale {
  current ??= readStoredLocale() ?? browserLocale();
  return current;
}

export function setLocale(locale: Locale): void {
  if (current === locale) return;
  current = locale;
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, locale);
  } catch {
    // 기억해 두지 못해도 이번 화면은 고른 언어로 간다.
  }
  for (const listener of listeners) listener();
}

export function subscribeLocale(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
