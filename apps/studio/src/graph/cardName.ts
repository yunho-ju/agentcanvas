// 화면이 카드를 부르는 하나뿐인 이름 — 카드 제목·설정 패널·목록·서랍·저장 소식이 모두 여기서 부른다.
// 등록부(display_name)가 원천이고, 어느 한 언어라도 비면 종류 이름으로 물러난다.
import { LOCALES, type Locale } from "../i18n/locale";
import type { LocalizedText } from "../generated/node_type";
import type { AgentNodeData } from "./serialize";

/** 아직 언어가 정해지지 않은 이름 — 소식(Message)에 담아 읽는 순간에 언어를 고를 수 있다. */
export type CardName = string | LocalizedText;

export function cardName(data: AgentNodeData): CardName {
  const name = data.nodeType?.display_name;
  return name && LOCALES.every((locale) => name[locale]) ? name : data.spec.type;
}

/** 지금 화면의 언어로 부르는 이름 — 그리는 자리가 쓴다. */
export function cardTitle(data: AgentNodeData, locale: Locale): string {
  const name = cardName(data);
  return typeof name === "string" ? name : name[locale];
}
