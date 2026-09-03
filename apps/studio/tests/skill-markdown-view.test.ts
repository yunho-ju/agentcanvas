// 본문을 읽기용으로 펼치는 순수 함수 — 제목·문단·목록·인용만 다룬다 (DESIGN §7 skills-panel).
// 바깥 의존을 들이지 않는다: 우리가 읽는 것은 우리가 쓴 SKILL.md 본문뿐이다.
import { describe, expect, it } from "vitest";
import { readableBlocks } from "../src/graph/skillMarkdownView";

describe("skill 본문을 읽기용으로 펼친다", () => {
  it("제목은 몇 번째 층인지와 함께 온다", () => {
    expect(readableBlocks("# Answer plainly\n\n## When to use\n")).toEqual([
      { kind: "heading", level: 1, text: "Answer plainly" },
      { kind: "heading", level: 2, text: "When to use" },
    ]);
  });

  it("빈 줄로 나뉜 문단은 각각 한 덩어리다", () => {
    expect(readableBlocks("first line\nstill first\n\nsecond\n")).toEqual([
      { kind: "paragraph", text: "first line still first" },
      { kind: "paragraph", text: "second" },
    ]);
  });

  it("번호 없는 목록과 번호 있는 목록을 가른다", () => {
    expect(readableBlocks("- one\n- two\n\n1. first\n2. second\n")).toEqual([
      { kind: "list", ordered: false, items: ["one", "two"] },
      { kind: "list", ordered: true, items: ["first", "second"] },
    ]);
  });

  it("인용은 인용으로 남는다", () => {
    expect(readableBlocks("> keep it short\n")).toEqual([
      { kind: "quote", text: "keep it short" },
    ]);
  });

  it("빈 글은 아무 덩어리도 만들지 않는다", () => {
    expect(readableBlocks("\n\n")).toEqual([]);
  });
});
