// 캔버스 오른쪽 클릭 메뉴 (DESIGN §7 context-menu, CM-1).
// 새 조작을 만들지 않는다 — 항목은 이미 있는 store 행동을 부르는 입구일 뿐이다.
import { act, createEvent, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import exampleSpec from "../../../examples/basic-agent/agent_spec.json";
import { App } from "../src/App";
import { contextMenuAnchor, keyboardMenuPoint } from "../src/canvas/contextMenuAnchor";
import { contextMenuItems } from "../src/canvas/contextMenuItems";
import type { AgentSpec } from "../src/generated/agent_spec";
import { translate } from "../src/i18n/messages";
import { fakeRun } from "../src/run/fakeRun";
import type { ContextTarget } from "../src/store/contextMenuSlice";
import { useEditor } from "../src/store/editor";

const example = exampleSpec as unknown as AgentSpec;

function store() {
  return useEditor.getState();
}

const ko = (key: string) => translate("ko", { key } as Parameters<typeof translate>[1]);

function menu() {
  return screen.queryByRole("menu", { name: ko("context.label") });
}

function itemNames(): string[] {
  return screen
    .getAllByRole("menuitem")
    .map((item) => item.textContent ?? "");
}

function item(name: string): HTMLElement {
  return screen.getByRole("menuitem", { name });
}

function pane(): HTMLElement {
  return document.querySelector<HTMLElement>(".react-flow__pane") as HTMLElement;
}

function drawnCard(id: string): HTMLElement {
  return document.querySelector<HTMLElement>(
    `.react-flow__node[data-id="${id}"]`,
  ) as HTMLElement;
}

function drawnEdge(id: string): SVGGElement {
  return document.querySelector<SVGGElement>(
    `.react-flow__edge[data-id="${id}"]`,
  ) as SVGGElement;
}

const measuredCards = { width: 208, height: 90 };
const noSize = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetWidth");

/**
 * jsdom은 무엇도 재지 못해 캔버스 라이브러리가 선을 그리지 않는다 — 카드가 크기를 말하게 하고
 * 크기가 달라졌다고 알린다(vitest.setup의 ResizeObserver 대역). 그래야 선 위에서 메뉴를 열 수 있다.
 */
function drawTheEdges() {
  for (const [name, size] of [
    ["offsetWidth", measuredCards.width],
    ["offsetHeight", measuredCards.height],
  ] as const) {
    Object.defineProperty(HTMLElement.prototype, name, {
      configurable: true,
      get: () => size,
    });
  }
  const observers = (
    globalThis as unknown as {
      __resizeObservers?: Set<(entries: unknown[], observer: unknown) => void>;
    }
  ).__resizeObservers;
  act(() => {
    const entries = Array.from(document.querySelectorAll(".react-flow__node")).map(
      (target) => ({ target, contentRect: measuredCards }),
    );
    observers?.forEach((tell) => tell(entries, {}));
  });
}

afterEach(() => {
  if (noSize) Object.defineProperty(HTMLElement.prototype, "offsetWidth", noSize);
});

/** 화면이 자리를 아는 척하게 한다 — jsdom은 모든 네모를 0으로 잰다. */
function standsAt(element: Element, box: { x: number; y: number; width: number; height: number }) {
  element.getBoundingClientRect = () =>
    ({
      x: box.x,
      y: box.y,
      left: box.x,
      top: box.y,
      right: box.x + box.width,
      bottom: box.y + box.height,
      width: box.width,
      height: box.height,
      toJSON: () => ({}),
    }) as DOMRect;
}

/** 오른쪽 클릭 한 번 — 브라우저 기본 메뉴를 막았는지 보려고 이벤트를 손에 쥔 채 보낸다. */
function rightClick(element: HTMLElement, at = { x: 300, y: 220 }) {
  const event = createEvent.contextMenu(element, { clientX: at.x, clientY: at.y });
  fireEvent(element, event);
  return event;
}

/** Shift+F10처럼 손이 아니라 키보드가 부른 메뉴 — 가리키는 점이 없다. */
function keyboardMenuOn(element: Element) {
  const event = createEvent.contextMenu(element, { clientX: 0, clientY: 0, detail: 0 });
  fireEvent(element, event);
  return event;
}

function watchARun() {
  act(() =>
    useEditor.setState({
      runEvents: fakeRun(example, {
        runId: "run_context",
        startedAt: new Date("2026-08-01T12:30:00.000Z"),
      }),
    }),
  );
}

beforeEach(() => {
  useEditor.setState({ runEvents: [], runHistory: [], activeRunId: null, breakpoints: [] });
  store().loadSpec(example);
  store().closeContextMenu();
});

describe("빈 곳에서 연 메뉴", () => {
  it("오른쪽 클릭에 여기서 할 수 있는 일이 뜬다 — 브라우저 기본 메뉴 대신", () => {
    render(<App />);

    const event = rightClick(pane());

    expect(event.defaultPrevented).toBe(true);
    expect(menu()).toBeInTheDocument();
    expect(itemNames()).toEqual([
      ko("context.addHere"),
      ko("context.fitAll"),
      ko("doc.arrange"),
    ]);
  });

  it("열리자마자 첫 항목에 손이 가 있다", () => {
    render(<App />);

    rightClick(pane());

    expect(item(ko("context.addHere"))).toHaveFocus();
  });

  it("'여기에 노드 놓기'는 누른 그 자리에 피커를 연다", async () => {
    render(<App />);
    rightClick(pane(), { x: 420, y: 260 });
    const opened = store().contextMenu;

    await userEvent.click(item(ko("context.addHere")));

    expect(store().picker?.at).toEqual(opened?.at);
    expect(store().picker?.screen).toEqual(opened?.screen);
    expect(store().picker?.from).toBeNull();
    expect(menu()).not.toBeInTheDocument();
    // 자리를 이어받은 피커가 손도 가져간다 — 메뉴가 닫히며 초점을 캔버스로 끌어오지 않는다.
    expect(screen.getByRole("combobox")).toHaveFocus();
  });
});

describe("노드에서 연 메뉴", () => {
  it("메뉴가 말하는 노드는 화면에서도 골라져 있다", () => {
    render(<App />);

    rightClick(drawnCard("clinical-agent"));

    expect(store().nodes.find((node) => node.selected)?.id).toBe("clinical-agent");
    expect(itemNames()).toEqual([
      ko("context.openSettings"),
      ko("breakpoint.toggle"),
      ko("context.detach"),
    ]);
  });

  it("'빼기'는 바로 빼지 않고 무엇이 망가지는지 먼저 묻는다", async () => {
    render(<App />);
    rightClick(drawnCard("clinical-agent"));

    await userEvent.click(item(ko("context.detach")));

    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    expect(store().nodes.some((node) => node.id === "clinical-agent")).toBe(true);
  });

  it("멈춤이 꽂힌 노드에서는 푸는 말이 되고, 누르면 풀린다", async () => {
    act(() => useEditor.setState({ breakpoints: ["triage"] }));
    render(<App />);
    rightClick(drawnCard("triage"));

    expect(itemNames()[1]).toBe(ko("context.breakpoint.clear"));
    await userEvent.click(item(ko("context.breakpoint.clear")));

    expect(store().breakpoints).toEqual([]);
  });
});

describe("선에서 연 메뉴", () => {
  it("선 위에서 오른쪽 클릭하면 그 선이 골라지고 두 항목이 뜬다", () => {
    render(<App />);
    drawTheEdges();

    const event = rightClick(drawnEdge("input-triage") as unknown as HTMLElement);

    expect(event.defaultPrevented).toBe(true);
    expect(store().edges.find((edge) => edge.selected)?.id).toBe("input-triage");
    expect(itemNames()).toEqual([
      ko("context.editCondition"),
      ko("context.removeEdge"),
    ]);
  });

  it("'선 지우기'는 그 선을 지우고, 되돌리기로 되살아난다", async () => {
    render(<App />);
    drawTheEdges();
    rightClick(drawnEdge("input-triage") as unknown as HTMLElement);

    await userEvent.click(item(ko("context.removeEdge")));
    expect(store().edges.some((edge) => edge.id === "input-triage")).toBe(false);

    act(() => store().undo());

    expect(store().edges.some((edge) => edge.id === "input-triage")).toBe(true);
  });
});

describe("실행을 보는 동안", () => {
  it("그래프를 바꾸는 항목은 잠기고 그 까닭을 말한다", () => {
    render(<App />);
    watchARun();

    rightClick(drawnCard("clinical-agent"));
    expect(item(ko("context.detach"))).toBeDisabled();
    expect(item(ko("context.detach"))).toHaveAttribute("title", ko("run.locked"));
    expect(item(ko("context.openSettings"))).toBeEnabled();

    rightClick(pane());
    expect(item(ko("context.addHere"))).toBeDisabled();
    expect(item(ko("context.addHere"))).toHaveAttribute("title", ko("run.locked"));
  });
});

describe("메뉴가 물러나는 길", () => {
  it("Esc는 메뉴를 닫고 손을 그 노드로 돌려보낸다", async () => {
    render(<App />);
    rightClick(drawnCard("clinical-agent"));

    await userEvent.keyboard("{Escape}");

    expect(menu()).not.toBeInTheDocument();
    expect(drawnCard("clinical-agent").querySelector(".node-card")).toHaveFocus();
  });

  it("바깥을 누르면 물러난다", async () => {
    render(<App />);
    rightClick(pane());

    await userEvent.click(document.body);

    expect(menu()).not.toBeInTheDocument();
  });

  it("노드 피커가 열리면 자리를 내준다 — 한 번에 하나만 뜬다", () => {
    render(<App />);
    rightClick(pane());

    act(() =>
      store().openPicker({ at: { x: 0, y: 0 }, screen: { x: 0, y: 0 }, from: null }),
    );

    expect(store().contextMenu).toBeNull();
    expect(menu()).not.toBeInTheDocument();
  });

  it("문서 메뉴가 열려도 자리를 내준다", () => {
    render(<App />);
    rightClick(pane());

    act(() => store().toggleDocMenu());

    expect(store().contextMenu).toBeNull();
  });

  it("판 기록이 열려도 자리를 내준다", () => {
    render(<App />);
    rightClick(pane());

    act(() => store().openRevisionHistory());

    expect(store().contextMenu).toBeNull();
  });

  it("이 메뉴가 열릴 때 먼저 떠 있던 것들이 물러난다", () => {
    render(<App />);
    act(() => {
      store().openPicker({ at: { x: 0, y: 0 }, screen: { x: 0, y: 0 }, from: null });
      store().toggleDocMenu();
    });

    rightClick(pane());

    expect(store().picker).toBeNull();
    expect(store().docPopover).toBe("closed");
    expect(menu()).toBeInTheDocument();
  });

  it("글자를 치는 중에도 Esc는 이 메뉴의 것이다", async () => {
    render(<App />);
    act(() => store().select("node", "clinical-agent"));
    const field = screen.getAllByRole("textbox")[0];
    rightClick(drawnCard("clinical-agent"));
    act(() => field.focus());

    await userEvent.keyboard("{Escape}");

    expect(menu()).not.toBeInTheDocument();
  });
});

describe("키보드만으로 항목 사이를 오간다", () => {
  it("↑↓는 끝에서 반대편으로 돌고 Home/End는 양 끝으로 간다", async () => {
    render(<App />);
    rightClick(pane());

    await userEvent.keyboard("{ArrowDown}");
    expect(item(ko("context.fitAll"))).toHaveFocus();

    await userEvent.keyboard("{ArrowUp}{ArrowUp}");
    expect(item(ko("doc.arrange"))).toHaveFocus();

    await userEvent.keyboard("{Home}");
    expect(item(ko("context.addHere"))).toHaveFocus();

    await userEvent.keyboard("{End}");
    expect(item(ko("doc.arrange"))).toHaveFocus();
  });
});

describe("대상별 항목 표", () => {
  const nothingRunning = { running: false, breakpoints: [] };

  function keysFor(target: ContextTarget): string[] {
    return contextMenuItems(
      { target, screen: { x: 0, y: 0 }, at: { x: 0, y: 0 } },
      nothingRunning,
    ).map((entry) => entry.key);
  }

  it("대상마다 순서까지 정해진 항목이 나온다", () => {
    expect(keysFor({ kind: "pane" })).toEqual([
      "context.addHere",
      "context.fitAll",
      "doc.arrange",
    ]);
    expect(keysFor({ kind: "node", id: "triage" })).toEqual([
      "context.openSettings",
      "breakpoint.toggle",
      "context.detach",
    ]);
    expect(keysFor({ kind: "edge", id: "input-triage" })).toEqual([
      "context.editCondition",
      "context.removeEdge",
    ]);
  });

  it("어느 대상에서 열어도 할 수 있는 일이 있다 — 표가 모든 종류를 덮는다", () => {
    const everyKind: ContextTarget[] = [
      { kind: "pane" },
      { kind: "node", id: "triage" },
      { kind: "edge", id: "input-triage" },
    ];

    for (const target of everyKind) {
      expect(keysFor(target).length).toBeGreaterThan(0);
    }
  });

  it("멈춤이 꽂힌 노드에서만 푸는 말이 된다", () => {
    expect(
      contextMenuItems(
        {
          target: { kind: "node", id: "triage" },
          screen: { x: 0, y: 0 },
          at: { x: 0, y: 0 },
        },
        { running: false, breakpoints: ["triage"] },
      ).map((entry) => entry.key),
    ).toContain("context.breakpoint.clear");
  });
});

// jsdom은 자리를 재지 못한다 — 실제로 창 안에 서는지는 브라우저 QA(probe_context_menu)가 본다.
describe("메뉴가 서는 자리", () => {
  const surface = { width: 1000, height: 800 };
  const size = { width: 200, height: 120 };

  it("누른 지점의 아래·오른쪽에 한 칸 띄워 선다", () => {
    expect(contextMenuAnchor({ x: 300, y: 200 }, surface, size, 4)).toEqual({
      left: 304,
      top: 204,
    });
  });

  it("가장자리에 걸리면 누른 지점의 안쪽으로 뒤집는다", () => {
    expect(contextMenuAnchor({ x: 950, y: 760 }, surface, size, 4)).toEqual({
      left: 950 - 4 - 200,
      top: 760 - 4 - 120,
    });
  });

  it("아직 재지 못한 화면에서는 자리를 지어내지 않는다", () => {
    expect(contextMenuAnchor({ x: 950, y: 760 }, { width: 0, height: 0 }, size, 4)).toEqual({
      left: 954,
      top: 764,
    });
  });

  it("뒤집어도 화면 왼쪽·위로는 넘어가지 않는다", () => {
    expect(contextMenuAnchor({ x: 40, y: 30 }, { width: 100, height: 90 }, size, 4)).toEqual({
      left: 4,
      top: 4,
    });
  });

  it("포인터가 없는 손짓은 대상의 왼쪽 아래를 가리킨다", () => {
    expect(
      keyboardMenuPoint(
        { left: 120, top: 200, width: 208, height: 90 },
        { left: 0, top: 0, width: 1000, height: 800 },
      ),
    ).toEqual({ x: 120, y: 290 });
  });

  it("가리킬 대상이 없으면 캔버스 한가운데다 — 구석에 세우지 않는다", () => {
    expect(
      keyboardMenuPoint(null, { left: 10, top: 20, width: 1000, height: 800 }),
    ).toEqual({ x: 510, y: 420 });
  });
});

// 키보드로 부른 메뉴(Shift+F10)는 포인터 좌표가 없다 — 대상이 자리를 말한다 (DESIGN §7).
describe("키보드로 부른 메뉴", () => {
  it("노드에서는 그 카드의 왼쪽 아래에 선다", () => {
    render(<App />);
    const card = drawnCard("clinical-agent");
    standsAt(card.querySelector(".node-card") as Element, {
      x: 300,
      y: 400,
      width: 208,
      height: 90,
    });

    keyboardMenuOn(card);

    expect(store().contextMenu?.screen).toEqual({ x: 300, y: 490 });
  });

  it("빈 곳에서는 캔버스 한가운데에 선다", () => {
    render(<App />);
    const canvas = screen.getByRole("application", { name: ko("canvas.label") });
    standsAt(canvas, { x: 0, y: 0, width: 1200, height: 800 });

    keyboardMenuOn(pane());

    expect(store().contextMenu?.screen).toEqual({ x: 600, y: 400 });
  });
});

describe("메뉴가 펴진 카드", () => {
  it("그 카드의 설명 툴팁은 물러난다 — 한 자리에 두 카드를 겹치지 않는다", () => {
    render(<App />);
    const card = drawnCard("clinical-agent");
    expect(card.querySelector('[role="tooltip"]')).toBeInTheDocument();

    rightClick(card);

    expect(card.querySelector('[role="tooltip"]')).not.toBeInTheDocument();
    expect(drawnCard("triage").querySelector('[role="tooltip"]')).toBeInTheDocument();
  });
});
