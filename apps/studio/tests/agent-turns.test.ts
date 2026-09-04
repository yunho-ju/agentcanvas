import { describe, expect, it } from "vitest";
import { msg, translate } from "../src/i18n/messages";
import { turnsCaptions } from "../src/inspector/turnsCaption";

// 엔진이 도구를 부르며 반복하기 전까지 '최대 몇 턴'은 저장되는 값일 뿐이다 —
// 화면은 그 사실을 캡션 끝에 붙여 말한다 (DESIGN §7 agent-turns).
describe("turnsCaptions", () => {
  it("puts the admission on the turns field", () => {
    expect(turnsCaptions()).toEqual([
      { field: "max_turns", message: msg("agent.turns.oneShot") },
    ]);
  });

  it("speaks both languages", () => {
    const caption = turnsCaptions()[0].message;
    expect(translate("ko", caption)).toBe("(이 서버는 아직 한 번에 답해요)");
    expect(translate("en", caption)).toBe("(this server still answers in one go)");
  });
});
