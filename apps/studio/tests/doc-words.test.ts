// 목록 한 줄이 말하는 저장 시각 — 읽는 사람의 말로 적고, 못 읽는 값은 서버 원문을 흘리지 않는다.
import { describe, expect, it } from "vitest";
import { savedWhen } from "../src/shell/docWords";

const SAVED_AT = "2026-08-01T12:31:00Z";

describe("저장한 때를 적는 일", () => {
  it("사람이 읽는 날짜와 시각으로 적는다 — 기계가 적은 원문을 그대로 두지 않는다", () => {
    const said = savedWhen(SAVED_AT, "ko");

    expect(said).toContain("2026");
    expect(said).not.toContain(SAVED_AT);
    expect(said).not.toContain("T12:31");
  });

  it("언어마다 그 언어의 방식으로 적는다", () => {
    expect(savedWhen(SAVED_AT, "en")).toContain("2026");
    expect(savedWhen(SAVED_AT, "en")).not.toBe(savedWhen(SAVED_AT, "ko"));
  });

  it("읽을 수 없는 값이 오면 쉬운 말로 모른다고 한다 — 원문을 화면에 내보내지 않는다", () => {
    expect(savedWhen("어쩌다 이런 값이", "ko")).toBe("언제 저장했는지 몰라요");
    expect(savedWhen("어쩌다 이런 값이", "en")).toBe("We do not know when");
    expect(savedWhen("", "ko")).toBe("언제 저장했는지 몰라요");
  });
});
