// '최대 몇 턴'이 약속하는 것은 엔진이 지키는 것뿐이다 (DESIGN §7 agent-turns).
// 엔진이 도구를 부르며 반복하게 되는 날, 이 파일은 그 커밋에서 함께 사라진다.
import { msg } from "../i18n/messages";
import type { ConfigCaption } from "./schemaForm";

const TURNS_FIELD = "max_turns";

/** 지금 이 서버는 한 번에 답한다 — 조건이 아니라 사실이라 언제나 붙는다. */
export function turnsCaptions(): ConfigCaption[] {
  return [{ field: TURNS_FIELD, message: msg("agent.turns.oneShot") }];
}
