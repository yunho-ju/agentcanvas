// 실행이 끝까지 가지 못했을 때 목록이 하는 말 (DESIGN §7 event-list 실행 실패 줄).
// 검사할 문구는 손으로 적지 않는다: 사전에서 `event.run.failed.` 문구를 모두 끌어온다 —
// 새 갈래가 생기면 그날부터 같은 규칙을 받는다.
import { describe, expect, it } from "vitest";
import type { RunEvent } from "../src/generated/run_event";
import { LOCALES, type Locale } from "../src/i18n/locale";
import { MESSAGES, type MessageKey, msg, translate } from "../src/i18n/messages";
import { FAILURE_REASONS, eventSummary } from "../src/run/eventWords";

const KEY_PREFIX = "event.run.failed.";

/** 사전에 있는 실패 갈래 문구 전부. */
const FAILURE_KEYS = (Object.keys(MESSAGES) as MessageKey[]).filter((key) =>
  key.startsWith(KEY_PREFIX),
);

/** 그 갈래로 끝난 실행의 마지막 사건. */
function failedWith(payload: Record<string, unknown>): RunEvent {
  return {
    run_id: "run_1",
    seq: 9,
    timestamp: "2026-08-01T12:30:09.000Z",
    spec_revision: `sha256:${"a".repeat(64)}`,
    event_type: "run.failed",
    payload,
  } as RunEvent;
}

function said(event: RunEvent, locale: Locale): string {
  return translate(locale, eventSummary(event));
}

/** 이유로 끝내지 않고 다음 걸음까지 말하는가 — '—' 뒤에 할 일이 붙는다. */
function saysNextStep(text: string): boolean {
  const [, step] = text.split("—");
  return step !== undefined && step.trim().length > 3;
}

/** 서버가 기계에게 쓰는 말이 화면에 새어 나왔는가. */
const RAW_WORDS = [
  "secret",
  "provider",
  "runtime",
  "error",
  "payload",
  "reason",
  "API",
  "LLM",
];

function usesRawWords(text: string): boolean {
  return RAW_WORDS.some((word) => text.toLowerCase().includes(word.toLowerCase()));
}

describe("실패 갈래마다 갈라 하는 말", () => {
  it("서버가 낼 수 있는 갈래를 하나도 빠뜨리지 않고 말한다", () => {
    expect(FAILURE_KEYS.sort()).toEqual(
      FAILURE_REASONS.map((reason) => `${KEY_PREFIX}${reason}`).sort(),
    );
    expect(FAILURE_REASONS.length).toBeGreaterThan(1);
  });

  it.each(FAILURE_REASONS)("%s — 그 갈래의 말을 한다", (reason) => {
    for (const locale of LOCALES) {
      expect(said(failedWith({ reason }), locale)).toBe(
        translate(locale, msg(`${KEY_PREFIX}${reason}` as MessageKey)),
      );
      expect(said(failedWith({ reason }), locale)).not.toBe(
        translate(locale, msg("event.run.failed")),
      );
    }
  });

  it.each(FAILURE_REASONS)("%s — 왜인지에서 그치지 않고 다음 걸음을 말한다", (reason) => {
    for (const locale of LOCALES) {
      expect(saysNextStep(said(failedWith({ reason }), locale))).toBe(true);
    }
  });

  it.each(FAILURE_REASONS)("%s — 두 언어로 말한다", (reason) => {
    const ko = said(failedWith({ reason }), "ko");
    const en = said(failedWith({ reason }), "en");

    expect(ko.trim()).not.toBe("");
    expect(en.trim()).not.toBe("");
    expect(ko).not.toBe(en);
    expect(en).not.toMatch(/[가-힣]/);
  });

  it.each(FAILURE_REASONS)("%s — 기계에게 쓰는 말을 그대로 옮기지 않는다", (reason) => {
    for (const locale of LOCALES) {
      expect(usesRawWords(said(failedWith({ reason }), locale))).toBe(false);
    }
  });

  // 서버가 실은 message는 우리 화면의 글이 아니다 (원문 노출 금지 — DESIGN §7).
  it("서버가 함께 보낸 영어 원문은 화면에 쓰지 않는다", () => {
    const raw = "the model refused: no key configured for provider";
    const event = failedWith({ reason: "missing_secret", message: raw });

    for (const locale of LOCALES) {
      expect(said(event, locale)).not.toContain(raw);
    }
  });

  it("모르는 갈래는 조용히 숨기지 않고 일반 문구로 말한다", () => {
    const strange = failedWith({ reason: "sunspots" });

    for (const locale of LOCALES) {
      expect(said(strange, locale)).toBe(translate(locale, msg("event.run.failed")));
    }
  });

  it("갈래를 적지 않은 옛 사건도 같은 일반 문구로 말한다", () => {
    for (const locale of LOCALES) {
      expect(said(failedWith({}), locale)).toBe(
        translate(locale, msg("event.run.failed")),
      );
    }
  });
});

// 가드 자신을 먼저 시험한다 — 걸러야 할 말을 통과시키는 가드는 가드가 아니다.
describe("문구 가드가 실제로 거른다", () => {
  it("다음 걸음이 없는 말을 걸러낸다", () => {
    expect(saysNextStep("실행이 끝까지 가지 못했어요")).toBe(false);
    expect(saysNextStep("여기서 멈췄어요 — 다시 실행해 주세요")).toBe(true);
  });

  it("기계에게 쓰는 말을 걸러낸다", () => {
    expect(usesRawWords("missing_secret 때문에 멈췄어요")).toBe(true);
    expect(usesRawWords("The provider did not answer")).toBe(true);
    expect(usesRawWords("열쇠가 없어 물어보지 못했어요 — 열쇠를 넣고 다시 해 주세요")).toBe(
      false,
    );
  });
});
