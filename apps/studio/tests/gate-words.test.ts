// 밸브 앞 카드가 쓰는 말의 규칙 (DESIGN §7 gate-card). 문구를 통째로 박지 않는다 —
// 규칙을 어기면 빨개지는 형태로만 고정한다. 검사 대상은 손으로 적지 않는다:
// 사전에서 `gate.` 문구를 모두 끌어온다. 새 문구가 생기면 그날부터 같은 규칙을 받는다.
import { describe, expect, it } from "vitest";
import { LOCALES, type Locale } from "../src/i18n/locale";
import { MESSAGES, type Message, type MessageKey, msg, translate } from "../src/i18n/messages";

/** 빈칸을 채울 대역 — 내부 이름표처럼 생긴 값을 일부러 넣는다. */
const STAND_IN = { id: "human-gate", label: "검토 의견", tool: "charge_card" };

const GATE_KEYS = (Object.keys(MESSAGES) as MessageKey[]).filter((key) =>
  key.startsWith("gate."),
);

const SAID: [MessageKey, Message][] = GATE_KEYS.map((key) => [key, msg(key, STAND_IN)]);

function said(message: Message, locale: Locale): string {
  return translate(locale, message);
}

describe("밸브 앞 카드가 쓰는 말", () => {
  it("사전에 있는 gate 문구를 하나도 빠뜨리지 않고 검사한다", () => {
    expect(GATE_KEYS.length).toBe(
      Object.keys(MESSAGES).filter((key) => key.startsWith("gate.")).length,
    );
    expect(GATE_KEYS.length).toBeGreaterThan(5);
  });

  it.each(SAID)("%s — 두 언어로 말한다", (_key, message) => {
    expect(said(message, "ko").trim()).not.toBe("");
    expect(said(message, "en").trim()).not.toBe("");
  });

  // 양식·프롬프트를 가리키는 내부 이름(ref 원문)은 사용자가 읽는 글이 아니다.
  it.each(SAID)("%s — 내부 ref 원문을 화면에 쓰지 않는다", (_key, message) => {
    for (const locale of LOCALES) {
      expect(said(message, locale)).not.toContain("://");
    }
  });

  it.each(SAID)("%s — 채우지 못한 빈칸을 화면에 남기지 않는다", (_key, message) => {
    for (const locale of LOCALES) {
      expect(said(message, locale)).not.toMatch(/[{}]/);
    }
  });

  it.each(SAID)("%s — 마침표로 닫지 않는다 (카드의 한 줄)", (_key, message) => {
    for (const locale of LOCALES) {
      expect(said(message, locale)).not.toMatch(/\.$/);
    }
  });
});
