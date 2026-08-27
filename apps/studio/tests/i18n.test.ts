import { beforeEach, describe, expect, it } from "vitest";
import { LOCALES, type Locale, localized } from "../src/i18n/locale";
import { MESSAGES, type MessageKey, msg, translate } from "../src/i18n/messages";
import {
  getLocale,
  readStoredLocale,
  setLocale,
  subscribeLocale,
} from "../src/i18n/localeStore";

const KOREAN = /[가-힣]/;

describe("the message dictionary", () => {
  it("says every message in every language we publish", () => {
    const missing = Object.entries(MESSAGES).flatMap(([key, text]) =>
      LOCALES.filter((locale) => text[locale].trim() === "").map(
        (locale) => `${key}.${locale}`,
      ),
    );
    expect(missing).toEqual([]);
  });

  it("keeps korean out of the english side", () => {
    const leftover = Object.entries(MESSAGES)
      .filter(([, text]) => KOREAN.test(text.en))
      .map(([key]) => key);
    expect(leftover).toEqual([]);
  });

  it("fills the same blanks in both languages", () => {
    const blanksOf = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
    const uneven = Object.entries(MESSAGES).filter(
      ([, text]) =>
        blanksOf(text.ko).sort().join() !== blanksOf(text.en).sort().join(),
    );
    expect(uneven.map(([key]) => key)).toEqual([]);
  });
});

describe("translate", () => {
  it("says the same thing in the asked language", () => {
    expect(translate("ko", msg("mode.build"))).toBe("만들기");
    expect(translate("en", msg("mode.build"))).toBe("Build");
  });

  it("fills the blanks with what the message carries", () => {
    const line = translate("ko", msg("impact.nodes.will", { count: 3 }));
    expect(line).toContain("3");
  });

  it("leaves an unfilled blank alone rather than printing nothing", () => {
    expect(translate("en", { key: "impact.nodes.will", params: {} })).toContain(
      "{count}",
    );
  });

  it("translates a message carried inside another message", () => {
    const inner = msg("event.node.unnamed");
    const line = translate("en", msg("event.node.queued", { node: inner }));
    expect(line).toContain(translate("en", inner));
    expect(line).not.toContain("[object Object]");
  });

  it("picks the language of a two-language text carried inside a message", () => {
    const title = { ko: "실행할 도구 이름", en: "Name of the tool to run" };
    expect(translate("ko", msg("setup.empty", { title }))).toContain("실행할 도구 이름");
    expect(translate("en", msg("setup.empty", { title }))).toContain(
      "Name of the tool to run",
    );
  });

  it("joins a list of messages carried inside another message", () => {
    const line = translate(
      "ko",
      msg("edit.config.notice", {
        id: "input",
        impact: [msg("impact.edges.did", { count: 1 })],
      }),
    );
    expect(line).toContain("input");
    expect(line).toContain(translate("ko", msg("impact.edges.did", { count: 1 })));
  });
});

describe("the chosen language", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("remembers what the user chose", () => {
    setLocale("en");
    expect(readStoredLocale()).toBe("en");
    expect(getLocale()).toBe("en");
  });

  it("starts from the browser's language when nothing was chosen", () => {
    expect(readStoredLocale()).toBeUndefined();
  });

  it("ignores a stored language we do not publish", () => {
    localStorage.setItem("agentcanvas.locale", "fr");
    expect(readStoredLocale()).toBeUndefined();
  });

  it("lets the screen know when the language changes", () => {
    const seen: Locale[] = [];
    const stop = subscribeLocale(() => seen.push(getLocale()));
    setLocale("en");
    setLocale("ko");
    stop();
    setLocale("en");
    expect(seen).toEqual(["en", "ko"]);
  });
});

describe("registry text", () => {
  it("picks the language the screen is showing", () => {
    const text = { ko: "입력", en: "Input" };
    expect(localized(text, "ko")).toBe("입력");
    expect(localized(text, "en")).toBe("Input");
  });

  it("says nothing when the registry gave no text at all", () => {
    expect(localized(undefined, "ko")).toBe("");
  });
});

describe("message keys", () => {
  it("are the only thing a message can name", () => {
    const key: MessageKey = "mode.build";
    expect(MESSAGES[key]).toBeDefined();
  });
});
