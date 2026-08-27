// 레이아웃 문법을 코드에 고정하는 lint 성격의 테스트 (DESIGN.md §1).
// 이 화면은 고정 칸으로 나뉜 어드민이 아니라, 캔버스 한 장 위에 뜬 작업대다.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const app = readFileSync(join(process.cwd(), "src", "app.css"), "utf8");
/** 규칙은 실제로 화면에 닿는 선언에만 건다 — 설명하는 주석은 값이 아니다. */
const rules = app.replace(/\/\*[\s\S]*?\*\//g, "");

/** 선택자 하나에 딸린 선언 블록. */
function block(selector: string): string {
  const at = rules.indexOf(`${selector} {`);
  return at === -1 ? "" : rules.slice(at, rules.indexOf("}", at));
}

describe("캔버스가 화면의 주인이다", () => {
  it("고정 3단 칸은 남아 있지 않다", () => {
    expect(rules).not.toContain(".app__side");
    expect(rules).not.toContain(".app__body");
  });

  it("캔버스는 화면 전체를 채운다", () => {
    expect(block(".app__canvas")).toContain("position: absolute");
    expect(block(".app__canvas")).toContain("inset: 0");
  });

  it("앱은 그 위에 층을 얹을 수 있는 한 겹이다", () => {
    expect(block(".app")).toContain("position: relative");
  });
});

describe("모든 도구는 캔버스 위에 뜬다", () => {
  it.each([
    [".layer-top-left", "좌상단 문서와 편집 기록"],
    [".mode-segment", "상단 중앙 모드"],
    [".layer-top-right", "우상단 실행과 실행 입력"],
    [".dock", "좌측 도구 독"],
    [".layer-right", "우측 설정·실행 기록"],
    [".layer-bottom", "하단 되감기·지난 실행"],
  ])("%s — %s 층이 캔버스 위에 떠 있다", (selector) => {
    expect(block(selector)).toContain("position: absolute");
  });

  it("떠 있는 것은 유리 질감과 hairline을 함께 입는다", () => {
    const layer = block(".layer");
    expect(layer).toContain("backdrop-filter");
    expect(layer).toContain("var(--surface-glass)");
    expect(layer).toContain("var(--hairline)");
    expect(layer).toContain("var(--shadow-float)");
  });

  it("독 옆 패널과 설정 카드는 화면을 넘지 않고 스스로 스크롤한다", () => {
    for (const selector of [".dock__panel", ".inspector"]) {
      expect(block(selector)).toContain("max-height");
      expect(block(selector)).toContain("overflow-y: auto");
    }
  });
});

describe("좁은 화면에서도 겹치지 않는다", () => {
  it("1280px 아래에서는 떠 있는 카드의 폭을 줄인다", () => {
    expect(rules).toContain("max-width: 1280px");
  });
});
