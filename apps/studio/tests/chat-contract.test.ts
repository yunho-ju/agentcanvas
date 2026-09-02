// 대화가 찾는 입력 이름은 계약의 것 하나다 — 화면이 제 철자를 따로 갖지 않는다.
// 서버(agentcanvas_contracts.chat)와 화면이 같은 파일을 읽는지 여기서 고정한다.
import { describe, expect, it } from "vitest";
import chatContract from "../../../packages/contracts/json_schema/chat_contract.json";
import { CHAT_SAID_BINDING } from "../src/chat/chatEntry";

describe("chat contract", () => {
  it("takes the said binding from the committed contract, not from a copy", () => {
    expect(CHAT_SAID_BINDING).toBe(chatContract.said_binding);
  });
});
