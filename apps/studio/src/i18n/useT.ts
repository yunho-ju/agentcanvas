// 화면이 언어에 손을 얹는 자리 — 언어가 바뀌면 이 훅을 쓰는 화면이 다시 그려진다.
import { useSyncExternalStore } from "react";
import type { Locale } from "./locale";
import { getLocale, subscribeLocale } from "./localeStore";
import {
  type Message,
  type MessageKey,
  type MessageParams,
  msg,
  translate,
} from "./messages";

export function useLocale(): Locale {
  return useSyncExternalStore(subscribeLocale, getLocale, getLocale);
}

/** 문구 하나를 지금 화면의 언어로. 키를 주어도 되고, 이미 지어진 메시지를 주어도 된다. */
export type Translate = (text: MessageKey | Message, params?: MessageParams) => string;

export function useT(): Translate {
  const locale = useLocale();
  return (text, params) =>
    translate(locale, typeof text === "string" ? msg(text, params) : text);
}
