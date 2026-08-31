// 이 대화가 붙잡아 둔 판 — 대화를 시작할 때 집어 두고, 그 뒤로 움직이지 않는다 (G4).
// 판을 고정하는 것은 서버다(CHAT-3a): 화면은 그 사실을 말할 뿐 다시 계산하지 않는다.
import { type Message, msg } from "../i18n/messages";

export interface ChatPin {
  /** 서버가 이 대화에 물려 둔 판 — 화면 문구에는 쓰지 않는다(내부 이름) */
  revision: string;
  /** 그 판이 몇 번째 판이었는가 — 모르면 없음(번호를 지어내지 않는다) */
  version: number | null;
}

/** 지금 어느 판과 이야기하는지 말하는 한 줄 — 판 번호를 모르면 번호 없이 말한다. */
export function chatPinWords(pin: ChatPin): Message {
  return pin.version === null
    ? msg("chat.pin.unknown")
    : msg("chat.pin.version", { version: pin.version });
}
