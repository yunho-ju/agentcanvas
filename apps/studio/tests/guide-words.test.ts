// 첫 걸음 안내가 쓰는 말 (DESIGN §7 first-steps-card "문구").
// 검사 대상은 손으로 적지 않는다: 사전에서 `guide.` 문구를 모두 끌어온다 —
// 새 문구가 생기면 그날부터 같은 규칙을 받는다.
import { describe, expect, it } from "vitest";
import { FIRST_STEP_KEYS } from "../src/guide/firstSteps";
import { LOCALES, type Locale } from "../src/i18n/locale";
import { MESSAGES, type Message, type MessageKey, msg, translate } from "../src/i18n/messages";

/** 이 카드에 뜰 수 있는 말 전부 — 사전이 늘어나면 이 목록도 함께 늘어난다. */
const GUIDE_KEYS = (Object.keys(MESSAGES) as MessageKey[]).filter((key) =>
  key.startsWith("guide."),
);

const SAID: [MessageKey, Message][] = GUIDE_KEYS.map((key) => [key, msg(key)]);

function said(message: Message, locale: Locale): string {
  return translate(locale, message);
}

/**
 * 영어가 사용자를 향해 말하는가 — 완전한 명령형 판정은 기계가 할 수 없으므로,
 * 3인칭 서술("Run finished", "Nodes need setup")로 시작하는 흔한 꼴을 걸러내는 **근사 가드**다.
 * 첫 낱말이 우리 이야기(we·it·there…)이거나 사물의 이름(run·node·step…)이면 사용자를 부르는 말이 아니다.
 */
const NOT_SPEAKING_TO_YOU = [
  "we",
  "it",
  "there",
  "this",
  "these",
  "that",
  "the",
  "a",
  "an",
  "run",
  "runs",
  "node",
  "nodes",
  "step",
  "steps",
  "graph",
];

function speaksToTheUser(text: string): boolean {
  const firstWord = text.trim().split(" ")[0].toLowerCase();
  return !NOT_SPEAKING_TO_YOU.includes(firstWord);
}

describe("첫 걸음 안내가 쓰는 말", () => {
  it("사전에 있는 guide 문구를 하나도 빠뜨리지 않고 검사한다", () => {
    expect(GUIDE_KEYS.length).toBe(
      Object.keys(MESSAGES).filter((key) => key.startsWith("guide.")).length,
    );
    expect(GUIDE_KEYS.length).toBeGreaterThan(1);
  });

  // 걸음이 늘면 할 일과 방법도 함께 있어야 한다 — 파생 모듈의 걸음 이름이 기준이다.
  it("걸음마다 할 일 한 줄과 방법 한 줄을 갖춘다", () => {
    for (const key of FIRST_STEP_KEYS) {
      expect(GUIDE_KEYS).toContain(`guide.step.${key}`);
      expect(GUIDE_KEYS).toContain(`guide.how.${key}`);
    }
  });

  it.each(SAID)("%s — 내부 id 문법을 화면에 쓰지 않는다", (_key, message) => {
    for (const locale of LOCALES) {
      expect(said(message, locale)).not.toMatch(/[A-Za-z_][\w-]*\.[A-Za-z_]/);
    }
  });

  it.each(SAID)("%s — 자료형 원문을 그대로 쓰지 않는다", (_key, message) => {
    for (const locale of LOCALES) {
      for (const raw of ["string", "array", "object", "boolean", "integer"]) {
        expect(said(message, locale)).not.toContain(raw);
      }
    }
  });

  // 은유는 모션으로만 한다 (DESIGN §9) — 언어는 보편 문법이다.
  it.each(SAID)("%s — 은유 단어를 쓰지 않는다", (_key, message) => {
    for (const locale of LOCALES) {
      for (const figure of ["밸브", "파이프", "물방울", "valve", "pipe", "droplet"]) {
        expect(said(message, locale)).not.toContain(figure);
      }
    }
  });

  it.each(SAID)("%s — 한국어는 해요체로 말한다", (_key, message) => {
    expect(said(message, "ko")).toMatch(/요$/);
  });

  // 영어는 사용자에게 말한다 — 우리·그것 이야기로 시작하지 않는다.
  it.each(SAID)("%s — 영어는 사람을 향해 말한다", (_key, message) => {
    expect(speaksToTheUser(said(message, "en"))).toBe(true);
  });

  // 가드 자신을 먼저 시험한다 — 걸러야 할 말을 통과시키는 가드는 가드가 아니다.
  it("3인칭 서술을 실제로 걸러낸다", () => {
    for (const narration of ["Run finished", "Nodes need setup", "A node is waiting"]) {
      expect(speaksToTheUser(narration)).toBe(false);
    }
    for (const spoken of ["Press 'Try a run'", "Put down one node", "You made it"]) {
      expect(speaksToTheUser(spoken)).toBe(true);
    }
  });

  // 방법 줄이 가리키는 버튼의 이름은 화면에 실제로 있는 그 이름이어야 한다.
  it("실행 방법은 화면에 보이는 버튼 이름을 그대로 부른다", () => {
    for (const locale of LOCALES) {
      expect(said(msg("guide.how.run"), locale)).toContain(
        said(msg("run.start"), locale),
      );
    }
  });

  it.each(SAID)("%s — 마침표로 닫지 않는다 (카드의 한 줄)", (_key, message) => {
    for (const locale of LOCALES) {
      expect(said(message, locale)).not.toMatch(/\.$/);
    }
  });

  it.each(SAID)("%s — 두 언어로 말한다", (_key, message) => {
    expect(said(message, "ko").trim()).not.toBe("");
    expect(said(message, "en").trim()).not.toBe("");
    expect(said(message, "ko")).not.toBe(said(message, "en"));
  });

  it.each(SAID)("%s — 채우지 못한 빈칸을 화면에 남기지 않는다", (_key, message) => {
    for (const locale of LOCALES) {
      expect(said(message, locale)).not.toMatch(/[{}]/);
    }
  });
});
