// AI가 지어 준 제안을 다루는 순수 규칙 — 개수 판정·서버 답 읽기·담을 때 이름 붙이기 (EVAL-2).
import { describe, expect, it } from "vitest";
import {
  SUGGEST_MAX,
  SUGGEST_MIN,
  type CaseSuggestion,
  casesFromSuggestions,
  givenText,
  howManyIssue,
  suggestionsOf,
} from "../src/eval/caseSuggestions";

function suggestion(title: string): CaseSuggestion {
  return { title, input: { question: "머리가 아파요" }, expected_phrases: ["병원"] };
}

describe("몇 개를 지어 달라고 할 수 있는가", () => {
  it("1개부터 20개까지는 물어봐도 된다", () => {
    expect(howManyIssue(SUGGEST_MIN)).toBeNull();
    expect(howManyIssue(SUGGEST_MAX)).toBeNull();
  });

  it("0개나 21개는 막고 까닭을 말한다 — 저장·요청까지 미루지 않는다", () => {
    expect(howManyIssue(0)?.key).toBe("eval.suggest.count.range");
    expect(howManyIssue(SUGGEST_MAX + 1)?.key).toBe("eval.suggest.count.range");
  });

  it("아직 다 못 친 빈 칸도 물어볼 수 없는 개수다", () => {
    expect(howManyIssue(undefined)?.key).toBe("eval.suggest.count.range");
  });
});

describe("서버가 지어 보낸 것 읽기", () => {
  it("몇 개를 청했고 몇 개가 왔는지 함께 읽는다", () => {
    const read = suggestionsOf({ asked_for: 5, cases: [suggestion("첫 시험")] });

    expect(read?.askedFor).toBe(5);
    expect(read?.suggestions).toEqual([suggestion("첫 시험")]);
  });

  it("지어 온 제안에는 이름이 없다 — 이름은 담는 순간에 붙는다", () => {
    const read = suggestionsOf({ asked_for: 1, cases: [suggestion("첫 시험")] });

    expect(read?.suggestions[0]).not.toHaveProperty("id");
  });

  it("모양이 아닌 답은 읽지 못했다고 말한다", () => {
    expect(suggestionsOf({ cases: "다섯 개" })).toBeNull();
    expect(suggestionsOf(null)).toBeNull();
  });
});

describe("고른 제안을 담을 케이스로 짓기", () => {
  it("담는 순간 이름이 붙는다 — 이미 쓰인 이름과 겹치지 않는다", () => {
    const cases = casesFromSuggestions([suggestion("첫 시험")], ["case"]);

    expect(cases[0].id).not.toBe("case");
    expect(cases[0].title).toBe("첫 시험");
  });

  it("같은 제목을 두 개 담아도 이름은 저마다 다르다 — 제목 중복은 막지 않는다", () => {
    const cases = casesFromSuggestions([suggestion("같은 제목"), suggestion("같은 제목")], []);

    expect(cases.map((one) => one.title)).toEqual(["같은 제목", "같은 제목"]);
    expect(new Set(cases.map((one) => one.id)).size).toBe(2);
  });

  it("돌리는 횟수는 사람이 정한다 — 지어 온 케이스도 한 번 돌려 한 번 통과가 처음 모습이다", () => {
    const cases = casesFromSuggestions([suggestion("첫 시험")], []);

    expect(cases[0].runs_per_case).toBe(1);
    expect(cases[0].passes_needed).toBe(1);
  });
});

describe("카드 한 줄 요약 — 무엇을 넣는가", () => {
  it("넣을 값들을 사람이 읽을 한 줄로 잇는다", () => {
    expect(givenText({ question: "머리가 아파요", when: "어제부터" })).toBe(
      "머리가 아파요, 어제부터",
    );
  });

  it("넣을 값이 없으면 빈 줄이다 — 없는 것을 있는 척하지 않는다", () => {
    expect(givenText({})).toBe("");
  });
});
