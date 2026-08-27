// 자료형을 사람의 말로 옮기는 표 (CLAUDE.md 용어 원칙 · DESIGN §7 "말은 화면에 보이는 것으로").
// 새 종류가 생기면 이 표에 한 줄을 더한다 — 부르는 쪽은 고치지 않는다.
import { type Message, type MessageKey, msg } from "../i18n/messages";

const TYPE_WORDS = {
  string: "type.text",
  number: "type.number",
  integer: "type.number",
  boolean: "type.yesno",
  array: "type.list",
  object: "type.bundle",
  null: "type.nothing",
} satisfies Record<string, MessageKey>;

/** 그 종류를 부르는 쉬운 말. 표에 없는 종류(여러 종류를 겹친 것 등)는 이름이 없다. */
export function typeWord(type: unknown): Message | undefined {
  if (typeof type !== "string") return undefined;
  const key = TYPE_WORDS[type as keyof typeof TYPE_WORDS];
  return key ? msg(key) : undefined;
}
