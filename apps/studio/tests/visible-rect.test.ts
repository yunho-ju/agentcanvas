// 캔버스 위에 뜬 층(독·인스펙터·실행 독)이 가린 만큼을 뺀 네모 (DESIGN §7 palette — 보이는 네모는 덮개를 뺀 것이다).
import { describe, expect, it } from "vitest";
import { visibleRect } from "../src/graph/visibleRect";

const surface = { x: 0, y: 0, width: 1440, height: 900 };

describe("visibleRect", () => {
  it("덮개가 없으면 면 전체가 그대로 보이는 네모다", () => {
    expect(visibleRect(surface, [])).toEqual(surface);
  });

  it("왼쪽 덮개만큼 x가 밀리고 폭이 줄어든다", () => {
    expect(visibleRect(surface, [{ side: "left", size: 333 }])).toEqual({
      x: 333,
      y: 0,
      width: 1440 - 333,
      height: 900,
    });
  });

  it("오른쪽 덮개만큼 폭만 줄어든다", () => {
    expect(visibleRect(surface, [{ side: "right", size: 352 }])).toEqual({
      x: 0,
      y: 0,
      width: 1440 - 352,
      height: 900,
    });
  });

  it("아래 덮개만큼 높이만 줄어든다", () => {
    expect(visibleRect(surface, [{ side: "bottom", size: 120 }])).toEqual({
      x: 0,
      y: 0,
      width: 1440,
      height: 900 - 120,
    });
  });

  it("같은 변에 덮개가 여럿이면 가장 큰 것만 뺀다 — 겹치는 층이라 더하지 않는다", () => {
    expect(
      visibleRect(surface, [
        { side: "left", size: 264 },
        { side: "left", size: 333 },
      ]),
    ).toEqual({ x: 333, y: 0, width: 1440 - 333, height: 900 });
  });

  it("덮개가 면보다 커서 폭이 음수가 되면 0으로 자른다", () => {
    expect(visibleRect(surface, [{ side: "left", size: 2000 }])).toEqual({
      x: 2000,
      y: 0,
      width: 0,
      height: 900,
    });
  });
});
