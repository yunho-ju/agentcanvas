// 디자인 언어(docs/design/design-language.md)를 코드에 고정하는 lint 성격의 테스트.
// 값의 출처는 tokens.css 하나뿐이다 — 나머지 파일에 색·radius·타이포·시간이 박히면 여기서 걸린다.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const src = join(process.cwd(), "src");

function read(name: string): string {
  return readFileSync(join(src, name), "utf8");
}

function componentFiles(dir = src): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return componentFiles(path);
    return entry.name.endsWith(".tsx") ? [path] : [];
  });
}

const tokens = read("tokens.css");
const app = read("app.css");
/** 규칙은 실제로 화면에 닿는 선언에만 건다 — 설명하는 주석은 값이 아니다. */
const appRules = app.replace(/\/\*[\s\S]*?\*\//g, "");

/** `--name: value;` 한 줄의 값. */
function tokenValue(css: string, name: string): string | undefined {
  return new RegExp(`${name}\\s*:\\s*([^;]+);`)
    .exec(css)?.[1]
    .trim()
    .replace(/\s+/g, " ");
}

/** `light-dark(밝을 때, 어두울 때)` — 한 토큰이 들고 있는 두 화면의 값. */
function themePair(name: string): { light: string; dark: string } {
  const value = tokenValue(tokens, name) ?? "";
  const inside = /^light-dark\((.*)\)$/.exec(value)?.[1];
  if (inside === undefined) return { light: value, dark: value };
  // 괄호 안의 쉼표(rgba)는 건너뛰고 두 값을 가르는 쉼표만 찾는다.
  let depth = 0;
  for (let i = 0; i < inside.length; i += 1) {
    if (inside[i] === "(") depth += 1;
    else if (inside[i] === ")") depth -= 1;
    else if (inside[i] === "," && depth === 0) {
      return { light: inside.slice(0, i).trim(), dark: inside.slice(i + 1).trim() };
    }
  }
  return { light: inside.trim(), dark: inside.trim() };
}

/** `속성: 값;` 선언을 모두 모은다 (주석은 미리 지운다). */
function declarations(css: string, property: string): string[] {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, "");
  return [...clean.matchAll(new RegExp(`(?:^|[;{\\s])${property}\\s*:([^;}]+)`, "g"))].map(
    (match) => match[1].trim(),
  );
}

const NAMED_TOKENS = [
  "--bg-canvas",
  "--surface",
  "--surface-raised",
  "--hairline",
  "--ink",
  "--ink-soft",
  "--accent",
  "--accent-strong",
  "--accent-soft",
  "--running",
  "--success",
  "--warn",
  "--danger",
  "--radius-card",
  "--radius-control",
  "--shadow-card",
  "--font-sans",
  "--text-body",
  "--text-label",
  "--text-title",
  "--text-caption",
  "--ease-spring",
  "--dur-enter",
  "--dur-exit",
];

describe("tokens.css는 값의 유일한 출처다", () => {
  it("디자인 언어 표의 토큰을 모두 정의한다", () => {
    const missing = NAMED_TOKENS.filter((name) => tokenValue(tokens, name) === undefined);
    expect(missing).toEqual([]);
  });

  it("표에 적힌 Flow Cyan·표면·상태 색을 그대로 쓴다", () => {
    expect(themePair("--bg-canvas").light).toBe("#F6F7F9");
    expect(themePair("--surface").light).toBe("#FFFFFF");
    expect(themePair("--hairline").light).toBe("#E5E8EC");
    expect(themePair("--ink").light).toBe("#191F28");
    expect(themePair("--ink-soft").light).toBe("#6B7684");
    expect(themePair("--accent").light).toBe("#0D83A0");
    expect(themePair("--accent-strong").light).toBe("#0E667C");
    expect(themePair("--accent-soft").light).toBe("#E2F4F8");
    expect(themePair("--success").light).toBe("#12B76A");
    expect(themePair("--warn").light).toBe("#F59E0B");
    expect(themePair("--danger").light).toBe("#EF4444");
  });

  it("실행 중 파랑은 브랜드 cyan과 다른 색이다 — 상태와 브랜드를 섞지 않는다", () => {
    expect(themePair("--running").light).toBe("#3B82F6");
    expect(themePair("--running").dark).toBe("#3B82F6");
    expect(themePair("--running").light).not.toBe(themePair("--accent").light);
    expect(themePair("--running").dark).not.toBe(themePair("--accent").dark);
  });

  it("표에 적힌 모양·모션 값을 그대로 쓴다", () => {
    expect(tokenValue(tokens, "--radius-card")).toBe("14px");
    expect(tokenValue(tokens, "--radius-control")).toBe("10px");
    expect(tokenValue(tokens, "--dur-enter")).toBe("240ms");
    expect(tokenValue(tokens, "--dur-exit")).toBe("160ms");
  });

  it("그림자는 낮고 정밀하다 — 띄우는 대신 hairline과 함께 경계를 만든다", () => {
    const shadow = tokenValue(tokens, "--shadow-card") ?? "";
    expect(shadow).toContain("0 1px 2px");
    expect(shadow).toContain("0 4px 12px");
    expect(declarations(app, "border").some((value) => value.includes("--hairline"))).toBe(
      true,
    );
  });

  it("타이포 계단은 표의 네 크기다", () => {
    expect(tokenValue(tokens, "--text-title")).toBe("14px");
    expect(tokenValue(tokens, "--text-body")).toBe("13.5px");
    expect(tokenValue(tokens, "--text-label")).toBe("12.5px");
    expect(tokenValue(tokens, "--text-caption")).toBe("11.5px");
  });

  // 그리드는 "빌더 티"의 주범이라 폐기했다 (브리프 A1) — 깊이는 표면 대비와 hairline이 만든다.
  it("캔버스는 점 하나 없는 단색이다", () => {
    expect(tokenValue(tokens, "--dot")).toBeUndefined();
    expect(appRules).not.toContain("background-pattern");
  });

  // 스스로 사라지는 안내가 머무는 시간 (DESIGN §8) — 읽을 시간이지 모션이 아니다.
  it("스스로 사라지는 안내의 수명도 토큰이 정한다", () => {
    expect(tokenValue(tokens, "--dur-hint")).toMatch(/ms$/);
  });

  it("모션을 줄인 화면에서도 안내의 수명은 줄지 않는다", () => {
    const reduced = /prefers-reduced-motion: reduce\)\s*{([\s\S]*?)\n}/.exec(tokens)?.[1];
    expect(reduced).toBeDefined();
    expect(reduced).not.toContain("--dur-hint");
  });

  it("본문 글꼴은 번들된 Pretendard다 — CDN을 부르지 않는다", () => {
    expect(tokenValue(tokens, "--font-sans")).toContain("Pretendard");
    expect(tokens).not.toMatch(/https?:\/\//);
  });
});

describe("다크 모드는 같은 토큰의 다른 값이다", () => {
  it("표면과 글자 토큰이 어두운 화면의 값을 함께 들고 있다", () => {
    expect(themePair("--bg-canvas").dark).toBe("#0E0F12");
    expect(themePair("--surface").dark).toBe("#17181C");
    expect(themePair("--surface-raised").dark).toBe("#1D1F24");
    expect(themePair("--hairline").dark).toBe("#2A2D33");
    expect(themePair("--ink").dark).toBe("#ECEDEF");
    expect(themePair("--ink-soft").dark).toBe("#8B95A1");
    expect(themePair("--accent").dark).toBe("#23BFE7");
    expect(themePair("--accent-soft").dark).toBe("#0D4A59");
  });

  it("고르지 않은 사용자에게는 시스템 설정을 따른다", () => {
    expect(tokenValue(tokens, "color-scheme")).toBe("light dark");
  });

  it("사용자가 고른 화면이 시스템보다 먼저다", () => {
    expect(tokens).toMatch(/\[data-theme="dark"\]\s*{\s*color-scheme: dark;/);
    expect(tokens).toMatch(/\[data-theme="light"\]\s*{\s*color-scheme: light;/);
  });
});

describe("app.css에는 값이 박혀 있지 않다", () => {
  it("색을 직접 적지 않는다", () => {
    expect(appRules.match(/#[0-9a-fA-F]{3,8}\b/g)).toBeNull();
    expect(appRules.match(/\b(?:rgba?|hsla?)\(/g)).toBeNull();
  });

  it("radius·글자 크기를 직접 적지 않는다", () => {
    expect(declarations(app, "border-radius").filter((v) => v.includes("px"))).toEqual([]);
    expect(declarations(app, "font-size").filter((v) => v.includes("px"))).toEqual([]);
  });

  it("그림자는 shadow 토큰으로만 만든다", () => {
    const literal = declarations(app, "box-shadow").filter(
      (value) => !value.includes("var(") && value !== "none",
    );
    expect(literal).toEqual([]);
  });

  it("모션 시간을 직접 적지 않는다", () => {
    expect(appRules.match(/\b\d+(?:\.\d+)?m?s\b/g)).toBeNull();
  });

  it("컴포넌트에도 색이 박혀 있지 않다", () => {
    const dirty = componentFiles().filter((path) =>
      /#[0-9a-fA-F]{6}\b/.test(readFileSync(path, "utf8")),
    );
    expect(dirty).toEqual([]);
  });
});

// 카드는 상태를 말하고 inspector는 값을 말한다 (디자인 언어 §1.5).
// 감춘 정보가 어디서 다시 나타나는지를 CSS에 고정한다 — 감추기만 하면 정보를 잃은 것이다.
describe("정보 위계 — 감춘 것은 반드시 다시 나타난다", () => {
  /** 선택자 하나에 딸린 선언 블록. */
  function block(selector: string): string {
    const at = appRules.indexOf(`${selector} {`);
    return at === -1 ? "" : appRules.slice(at, appRules.indexOf("}", at));
  }

  it("포트 이름은 평소에 감춰져 있다", () => {
    expect(block(".node-card__port-label")).toContain("opacity: 0");
  });

  it.each([
    [".node-card__port:hover .node-card__port-label", "포트 하나에 다가갔을 때"],
    [".react-flow__node.selected .node-card__port-label", "그 노드를 골랐을 때"],
    ['.node-card__port[data-link="compatible"] .node-card__port-label', "이을 수 있을 때"],
  ])("%s — %s 다시 나타난다", (selector) => {
    expect(appRules).toContain(selector);
  });

  it("연결을 끄는 동안 이을 수 없는 포트는 물러난다", () => {
    expect(appRules).toContain('.node-card__port[data-link="incompatible"]');
  });

  it("설명 툴팁은 마우스와 키보드 초점 양쪽에서 열린다", () => {
    expect(block(".node-card__tooltip")).toContain("opacity: 0");
    expect(appRules).toContain(".node-card:hover .node-card__tooltip");
    expect(appRules).toContain(".node-card:focus-visible .node-card__tooltip");
  });

  it("문제는 감추지 않는다 — 설정 뱃지에는 여는 조건이 없다", () => {
    expect(appRules).toContain(".node-card__setup");
    expect(appRules).not.toContain(".node-card:hover .node-card__setup");
  });

  it("새 컨트롤도 hover·active·keyboard 초점을 모두 갖춘다", () => {
    // 이들은 쓸 수 없게 되는 대신 사라진다 — 회색이 된 채 남아 있지 않는다.
    for (const base of [
      ".node-card__setup",
      ".run-controls__waiting",
      ".run-history__card",
      ".run-history__compare",
      ".compare-column__adopt",
      ".doc-card__name",
      ".open-dialog__doc",
      ".open-dialog__save",
      ".open-dialog__anyway",
      ".open-dialog__back",
      ".open-dialog__retry",
      ".doc-menu__open-server",
      ".revision-history__retry",
      ".first-steps__hide",
      ".resources-panel__new",
      ".tool-wrap-card__kind",
      ".tool-wrap-card__actions .button-primary",
      ".tool-wrap-card__actions .button-ghost",
      ".palette__tool",
      ".resources-panel__reimport",
      ".resources-panel__delete",
    ]) {
      const missing = [":hover", ":active", ":focus-visible"].filter(
        (state) => !app.includes(`${base}${state}`),
      );
      expect(missing).toEqual([]);
    }
  });
});

// 이어 붙이는 점은 보이는 크기와 잡히는 크기가 다르다 (DESIGN §7 port-handle).
describe("포트를 잡는 손", () => {
  function handleBlock(selector: string): string {
    const at = appRules.indexOf(`${selector} {`);
    return at === -1 ? "" : appRules.slice(at, appRules.indexOf("}", at));
  }

  it("잡히는 영역은 보이는 점보다 크다 — 정밀 조준을 시키지 않는다", () => {
    expect(tokenValue(tokens, "--handle-hit")).toBe("24px");
    expect(tokenValue(tokens, "--handle-size")).toBe("8px");
  });

  /**
   * 연결선의 끝은 캔버스 라이브러리가 **손잡이 요소의 박스**에서 잰다 —
   * 요소를 키우면 선의 끝이 점에서 떨어진다. 그래서 요소는 점 크기 그대로다 (DESIGN §7).
   */
  it("손잡이 요소는 보이는 점 크기 그대로다 — 연결선의 끝이 점에 닿는다", () => {
    const handle = handleBlock(".react-flow__handle");
    expect(handle).toContain("width: var(--handle-size)");
    expect(handle).toContain("height: var(--handle-size)");
    expect(handle).not.toContain("var(--handle-hit)");
    expect(handleBlock(".node-card__ports--inputs .react-flow__handle")).toContain(
      "calc(var(--handle-size) / -2)",
    );
    expect(handleBlock(".node-card__ports--outputs .react-flow__handle")).toContain(
      "calc(var(--handle-size) / -2)",
    );
  });

  it("넓어진 것은 손이 닿는 자리뿐이다 — 보이지 않는 의사요소가 덧대어 있다", () => {
    const hit = handleBlock(".react-flow__handle::before");
    expect(hit).toContain("position: absolute");
    expect(hit).toContain("width: var(--handle-hit)");
    // 세로는 이웃 포트와 겹치지 않는 만큼 — 포트 하나의 높이와 그 사이 간격.
    expect(hit).toContain("height: calc(var(--handle-size) + var(--space-2))");
  });

  it("다가가면 자라고 이을 수 있으면 밝아지는 것은 그 점 자신이다", () => {
    expect(appRules).toContain(".react-flow__node:hover .react-flow__handle {");
    expect(
      handleBlock('.node-card__port[data-link="compatible"] .react-flow__handle'),
    ).toContain("var(--accent)");
  });
});

// 캔버스가 손에 반응하는 방식 (브리프 A3·B4·B6).
describe("캔버스의 새 장치들", () => {
  it("정렬 안내선은 브랜드색 얇은 선이다", () => {
    expect(appRules).toContain(".canvas__guide");
    expect(appRules.slice(appRules.indexOf(".canvas__guide"))).toContain("var(--accent)");
  });

  it("피커 항목은 hover·active·키보드 초점을 모두 갖춘다", () => {
    const missing = [":hover", ":active", ":focus-visible"].filter(
      (state) => !app.includes(`.picker__item${state}`),
    );
    expect(missing).toEqual([]);
  });

  it("키보드로 짚고 있는 항목은 눈에도 짚혀 있다", () => {
    expect(appRules).toContain('.picker__item[aria-selected="true"]');
  });

  it("새 노드는 팝인으로 나타나고, 새 연결은 한 번 그려진다", () => {
    expect(appRules).toContain("@keyframes node-pop");
    expect(appRules).toContain("@keyframes edge-draw");
  });

  it("모션을 원치 않는 사용자에게는 그 둘이 움직이지 않고 그냥 있다", () => {
    const reduced = appRules.slice(appRules.indexOf("prefers-reduced-motion: reduce"));
    expect(reduced).toMatch(
      /\.node-card,\s*\.react-flow__edge-path\s*{\s*animation: none;/,
    );
  });
});

// 모션은 데이터의 사실이다 — 관이 흐르는 것은 지금 그 연결로 값이 건너간다는 뜻이다 (Pipe Flow 브리프).
describe("실행 중 데이터가 지나는 연결은 관이 된다", () => {
  /** 선택자 하나에 딸린 선언 블록. */
  function pipeBlock(selector: string): string {
    const at = appRules.indexOf(`${selector} {`);
    return at === -1 ? "" : appRules.slice(at, appRules.indexOf("}", at));
  }

  it("관의 굵기와 방울의 박자는 토큰에서 나온다", () => {
    for (const token of ["--pipe-carrying", "--pipe-carried", "--dur-pipe", "--pipe-drop"]) {
      expect(tokenValue(tokens, token)).toBeDefined();
    }
  });

  it("나르는 중인 관은 굵어지고 실행 중 파랑을 입는다", () => {
    const carrying = pipeBlock(".react-flow__edge.pipe--carrying .react-flow__edge-path");
    expect(carrying).toContain("var(--running)");
    expect(carrying).toContain("var(--pipe-carrying)");
  });

  it("데이터가 지나간 관은 옅은 잔상으로 남는다 — 흘렀던 길이 보인다", () => {
    const carried = pipeBlock(".react-flow__edge.pipe--carried .react-flow__edge-path");
    expect(carried).toContain("var(--running-soft)");
    expect(carried).toContain("var(--pipe-carried)");
  });

  it("관의 그라데이션은 온 쪽이 옅고 가는 쪽이 진하다", () => {
    expect(pipeBlock(".pipe-edge__shade-tail")).toContain("stop-color: var(--running-soft)");
    expect(pipeBlock(".pipe-edge__shade-head")).toContain("stop-color: var(--running)");
  });

  it("방울은 연결이 그린 그 선을 따라 흐른다", () => {
    const drop = pipeBlock(".pipe-edge__drop");
    expect(drop).toContain("offset-path: var(--pipe-path)");
    expect(drop).toContain("var(--running)");
  });

  it("빨리 감으면 방울도 그만큼 빨리 흐른다", () => {
    const drop = pipeBlock(".pipe-edge__drop");
    expect(drop).toMatch(/animation-duration:\s*calc\(var\(--dur-pipe\)\s*\/\s*var\(--run-speed/);
  });

  it("방울들은 서로 다른 간격으로 출발한다 — 톱니가 아니라 물이다", () => {
    expect(pipeBlock(".pipe-edge__drop")).toContain("var(--pipe-lead)");
  });

  it("데이터가 닿는 순간 받는 노드가 한 번 반응한다", () => {
    expect(appRules).toContain("@keyframes pipe-arrival");
    expect(pipeBlock(".react-flow__node.run--running .node-card")).toContain(
      "pipe-arrival",
    );
  });

  it("모션을 원치 않는 사용자에게는 방울 없이 굵기와 방향만 남는다", () => {
    const reduced = appRules.slice(appRules.indexOf("prefers-reduced-motion: reduce"));
    expect(reduced).toMatch(/\.pipe-edge__drop\s*{\s*display: none;/);
    expect(reduced).toContain("pipe--carrying");
  });
});

// 두 실행을 견주는 자리 (DESIGN.md §7 compare-view).
describe("갈라지는 자리는 색만으로 말하지 않는다", () => {
  /** 선택자 하나에 딸린 선언 블록. */
  function compareBlock(selector: string): string {
    const at = appRules.indexOf(`${selector} {`);
    return at === -1 ? "" : appRules.slice(at, appRules.indexOf("}", at));
  }

  it("갈라지는 단계는 warn 바탕과 warn 글자 3층으로 선다", () => {
    const diverged = compareBlock('.compare-column__step[data-part="diverged"]');
    expect(diverged).toContain("var(--warn-soft)");
    expect(diverged).toContain("var(--warn-ink)");
  });

  it("갈라지기 전 구간은 물러나 있고 그 뒤는 또렷하다", () => {
    expect(compareBlock(".compare-column__step")).toContain("var(--ink-soft)");
    expect(compareBlock('.compare-column__step[data-part="after"]')).toContain(
      "var(--ink)",
    );
  });

  it("단계 목록은 열 안에서 구른다 — 카드가 화면 밖으로 자라지 않는다", () => {
    expect(compareBlock(".compare-column__steps")).toContain("overflow-y: auto");
    expect(compareBlock(".compare-view")).toContain("var(--panel-compare)");
  });

  it("견줄 상대가 없는 컨트롤은 눌리지 않는 모습이 된다", () => {
    expect(appRules).toContain(".run-history__compare:disabled");
  });

  it("고른 카드는 브랜드색 고리를 두른다", () => {
    expect(compareBlock('.run-history__item[data-compare="picked"]')).toContain(
      "var(--ring-accent)",
    );
  });

  it("채택한 실행의 표는 상시 노출된다 — 여는 조건이 없다", () => {
    expect(appRules).toContain(".run-history__adopted");
    expect(appRules).not.toContain(".run-history__card:hover .run-history__adopted");
  });
});

// 우측 스택이 붐빌 때도 시험 패널이 카드 한 장 없이 눌리지 않는다 (DESIGN §7 eval-panel 갱신본).
describe("시험 패널은 이웃 카드에 눌려 접히지 않는다", () => {
  function block(selector: string): string {
    const at = appRules.indexOf(`${selector} {`);
    return at === -1 ? "" : appRules.slice(at, appRules.indexOf("}", at));
  }

  it("내부 스크롤과 함께 최소 높이를 토큰으로 지킨다", () => {
    const panel = block(".eval-panel");
    expect(panel).toContain("overflow-y: auto");
    expect(panel).toMatch(/min-height:\s*calc\(var\(--space-6\)/);
  });

  // 지시문 카드는 언제나 고를 수 있다(disabled 없음) — 나머지 세 상태는 손이 있는 자리마다 있어야 한다.
  it("지시문 카드는 hover/active/focus-visible을 모두 말한다", () => {
    const missing = [":hover", ":active", ":focus-visible"].filter(
      (state) => block(`.eval-prompt-card${state}`) === "",
    );
    expect(missing).toEqual([]);
  });

  it("지어 준 제안 카드도 hover/active/focus-visible을 모두 말한다", () => {
    const missing = [":hover", ":active", ":focus-visible"].filter(
      (state) => block(`.eval-suggest-card${state}`) === "",
    );
    expect(missing).toEqual([]);
  });

  it("담기로 고른 제안은 색만이 아니라 고리와 상태로도 말한다", () => {
    expect(appRules).toContain('.eval-suggest-card[aria-pressed="true"]');
    expect(block('.eval-suggest-card[aria-pressed="true"]')).toContain("var(--ring-accent)");
  });

  // 긴 지시문이 패널을 늘리지 않는다 (DESIGN §7 eval-prompt-card).
  it("긴 지시문은 카드 안에서 구른다", () => {
    expect(block(".eval-prompt-card__instruction")).toContain("overflow-y: auto");
  });
});

describe("상호작용과 모션의 품질 게이트", () => {
  const INTERACTIVE = [
    ".doc-menu__export",
    ".run-controls__run",
    ".mode-segment__option",
    ".icon-button",
    ".palette__item",
    ".tray__item",
    ".node-list__name",
    ".control",
    ".gate-card__approve",
    ".inspector__delete",
    ".timeline__play",
    ".event-list__what",
    ".eval-panel__run",
    ".eval-case-form__save",
    ".eval-suggest__ask-action",
    ".eval-suggest__keep",
  ];

  it.each(INTERACTIVE)("%s에 hover/active/focus-visible/disabled가 모두 있다", (base) => {
    const missing = [":hover", ":active", ":focus-visible", ":disabled"].filter(
      (state) => !app.includes(`${base}${state}`),
    );
    expect(missing).toEqual([]);
  });

  it("쓸 수 없는 것은 눌리지 않는 모습이 된다", () => {
    expect(app).toContain("button:disabled");
  });

  // 우리가 그리지 않은 브라우저의 표면도 이 화면의 일부다.
  it("글자 선택·커서·스크롤바까지 같은 팔레트를 입는다", () => {
    expect(appRules).toContain("::selection");
    expect(declarations(app, "caret-color")).not.toEqual([]);
    expect(declarations(app, "scrollbar-color")).not.toEqual([]);
  });

  it("숫자는 자리가 흔들리지 않는다", () => {
    expect(declarations(app, "font-variant-numeric")).not.toEqual([]);
  });

  it("모션은 spring 곡선 토큰을 쓴다", () => {
    expect(tokenValue(tokens, "--ease-spring")).toContain("cubic-bezier");
    expect(app).toContain("var(--ease-spring)");
  });

  it("모션을 원치 않는 사용자에게는 시간이 짧은 fade만 남는다", () => {
    const reduced = tokens.slice(tokens.indexOf("prefers-reduced-motion: reduce"));
    expect(reduced).toContain("--dur-enter: 120ms");
    expect(app).toContain("prefers-reduced-motion: reduce");
  });
});
