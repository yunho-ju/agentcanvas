// 캔버스 위에 뜬 층이 자기가 가린 띠를 store에 알린다 (DESIGN §7 palette — 보이는 네모는 덮개를 뺀 것이다).
import { beforeEach, describe, expect, it } from "vitest";
import { example } from "./exampleWithTool";
import { useEditor } from "../src/store/editor";

function store() {
  return useEditor.getState();
}

beforeEach(() => {
  useEditor.getState().loadSpec(example);
  useEditor.getState().noteCover("dock", null);
});

describe("noteCover", () => {
  it("같은 값을 다시 알리면 상태를 새로 만들지 않는다", () => {
    store().noteCover("dock", { side: "left", size: 333 });
    const first = store().covers;

    store().noteCover("dock", { side: "left", size: 333 });

    expect(store().covers).toBe(first);
  });

  it("null을 알리면 그 층의 덮개가 사라진다", () => {
    store().noteCover("dock", { side: "left", size: 333 });

    store().noteCover("dock", null);

    expect(store().covers.dock).toBeUndefined();
  });

  it("여러 층을 각자의 id로 따로 기억한다", () => {
    store().noteCover("dock", { side: "left", size: 333 });
    store().noteCover("layer-right", { side: "right", size: 352 });

    expect(store().covers).toEqual({
      dock: { side: "left", size: 333 },
      "layer-right": { side: "right", size: 352 },
    });
  });
});
