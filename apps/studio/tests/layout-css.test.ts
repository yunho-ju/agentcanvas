// 레이아웃 문법을 코드에 고정하는 lint 성격의 테스트 (DESIGN.md §1).
// 이 화면은 고정 칸으로 나뉜 어드민이 아니라, 캔버스 한 장 위에 뜬 작업대다.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  HISTORY_IN_MENU,
  MODE_ICONS_ONLY,
  READ_ONLY_WIDTH,
} from "../src/shell/topLayout";

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
    [".layer-top", "상단 문서·모드·실행"],
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

  // 위에 떠서 아래를 가리는 것은 비치지 않는다 — 글자 뒤에 다른 UI가 어른거리면 읽기가 방해된다.
  it("팝오버는 유리가 아니라 불투명한 표면이다", () => {
    for (const selector of [".doc-menu", ".revision-history"]) {
      expect(block(selector)).toContain("background: var(--surface-raised)");
      expect(block(selector)).not.toContain("var(--surface-glass)");
      expect(block(selector)).toContain("backdrop-filter: none");
    }
  });

  it("독 옆 패널과 설정 카드는 화면을 넘지 않고 스스로 스크롤한다", () => {
    for (const selector of [".dock__panel", ".inspector"]) {
      expect(block(selector)).toContain("max-height");
      expect(block(selector)).toContain("overflow-y: auto");
    }
  });
});

// DESIGN §1 상단 레이어 — 세 자리는 서로를 모르는 절대 배치가 아니라 한 그리드의 세 칸이다.
// DESIGN §1 쌓이는 순서 — 열린 팝오버는 언제나 다른 플로팅 요소 위다.
describe("무엇이 무엇 위에 쌓이는가", () => {
  const tokens = readFileSync(join(process.cwd(), "src", "tokens.css"), "utf8");

  /** 토큰 하나의 값 — 없으면 비교가 성립하지 않도록 NaN을 돌려준다. */
  function level(name: string): number {
    const found = new RegExp(`--${name}:\\s*(\\d+)`).exec(tokens);
    return found ? Number(found[1]) : Number.NaN;
  }

  it("층은 캔버스 < 플로팅 < 독 패널 < 팝오버 순으로 세워져 있다", () => {
    expect(level("z-float")).toBeLessThan(level("z-dock-panel"));
    expect(level("z-dock-panel")).toBeLessThan(level("z-popover"));
  });

  it("층의 높이는 토큰으로만 말한다", () => {
    expect(block(".layer-top")).toContain("z-index: var(--z-float)");
    expect(block(".dock")).toContain("z-index: var(--z-dock-panel)");
    expect(block(".doc-menu")).toContain("z-index: var(--z-popover)");
  });

  // 유리(backdrop-filter)는 그 자체로 쌓임 맥락을 만든다 — 자식만 올리면 이웃 아래에 깔린다.
  it("팝오버를 품은 카드와 그 레이어도 함께 올라간다", () => {
    for (const selector of [".layer-top:has(.doc-menu)", ".doc-card:has(.doc-menu)"]) {
      const at = rules.indexOf(selector);
      expect(at).toBeGreaterThan(-1);
      expect(rules.slice(at, rules.indexOf("}", at))).toContain(
        "z-index: var(--z-popover)",
      );
    }
  });
});

describe("상단의 세 자리는 한 그리드를 나눠 갖는다", () => {
  it("칸은 셋이고, 가운데 칸이 남는 폭을 갖는다", () => {
    const top = block(".layer-top");
    expect(top).toContain("display: grid");
    expect(top).toContain("grid-template-columns: auto 1fr auto");
  });

  it("세 자리는 이제 서로를 모르는 절대 배치가 아니다", () => {
    for (const selector of [".layer-top-left", ".mode-segment", ".layer-top-right"]) {
      expect(block(selector)).not.toContain("position: absolute");
    }
  });

  it("가운데 칸은 좁아져도 이웃을 밀지 않고 스스로 줄어든다", () => {
    const center = block(".layer-top-center");
    expect(center).toContain("justify-self: center");
    expect(center).toContain("min-width: 0");
  });

  it("칸 사이의 빈 자리는 캔버스의 것이다", () => {
    expect(block(".layer-top")).toContain("pointer-events: none");
    expect(block(".layer-top > *")).toContain("pointer-events: auto");
  });
});

describe("좁은 화면에서도 겹치지 않는다", () => {
  it("1280px 아래에서는 떠 있는 카드의 폭을 줄인다", () => {
    expect(rules).toContain("max-width: 1280px");
  });

  // 접는 폭은 한 곳(topLayout)에만 적는다 — CSS와 화면이 다른 폭을 믿으면 그 사이에서 겹친다.
  it("접는 폭은 화면 코드와 CSS가 같은 값을 쓴다", () => {
    expect(rules).toContain(`@media ${MODE_ICONS_ONLY}`);
    expect(rules).toContain(`@media ${HISTORY_IN_MENU}`);
    expect(rules).toContain(`@media ${READ_ONLY_WIDTH}`);
  });

  // 900↓에서 좁아진 자리는 문서명이 먼저 갖는다 (DESIGN §1 상단 레이어 900↓).
  it("되돌리기가 메뉴로 들어가는 폭에서는 브랜드 워드마크가 자리를 내준다", () => {
    const at = rules.indexOf(`@media ${HISTORY_IN_MENU}`);
    const narrow = rules.slice(at, rules.indexOf("\n}", at));
    expect(narrow).toContain(".doc-card__brand");
    expect(narrow).toContain("display: none");
  });

  // 휴대폰 폭에서는 세 칸이 한 줄에 들어가지 않는다 — 밀려 나오면 겹친다(실브라우저 390px).
  it("한 줄에 들어가지 않는 폭에서는 세 칸이 아래로 쌓인다", () => {
    const at = rules.indexOf(`@media ${READ_ONLY_WIDTH}`);
    const narrow = rules.slice(at, rules.indexOf("\n}", at));
    expect(narrow).toContain("grid-template-columns: 1fr");
  });
});
