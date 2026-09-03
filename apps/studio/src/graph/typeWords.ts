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

type WordKey = (typeof TYPE_WORDS)[keyof typeof TYPE_WORDS];
type Suffix<T> = T extends `type.${infer Kind}` ? Kind : never;

/** 표에 있는 종류를 화면이 부르는 이름 — 쉬운 말 이름표(`type.<kind>`)의 뒷부분이다. */
export type TypeKind = Suffix<WordKey>;

function kindOfWordKey(key: WordKey): TypeKind {
  return key.slice("type.".length) as TypeKind;
}

/** 이름 -> 자료형 (표의 반대 방향). 같은 말을 쓰는 자료형이 여럿이면 표에서 먼저 나온 것이 대표다. */
const TYPE_BY_KIND = Object.entries(TYPE_WORDS).reduce(
  (table, [type, key]) => (kindOfWordKey(key) in table
    ? table
    : { ...table, [kindOfWordKey(key)]: type }),
  {} as Record<TypeKind, string>,
);

/** 표가 아는 종류들, 표에 적힌 차례대로 (같은 말을 쓰는 자료형은 한 번만). */
export const TYPE_KINDS = Object.keys(TYPE_BY_KIND) as TypeKind[];

/** 그 종류를 부르는 쉬운 말. 표에 없는 종류(여러 종류를 겹친 것 등)는 이름이 없다. */
export function typeWord(type: unknown): Message | undefined {
  if (typeof type !== "string") return undefined;
  const key = TYPE_WORDS[type as keyof typeof TYPE_WORDS];
  return key ? msg(key) : undefined;
}

/** 화면이 그 종류를 부르는 이름 — 표에 없는 자료형은 부를 이름이 없다. */
export function typeKind(type: unknown): TypeKind | undefined {
  if (typeof type !== "string") return undefined;
  const key = TYPE_WORDS[type as keyof typeof TYPE_WORDS];
  return key ? kindOfWordKey(key) : undefined;
}

/** 그 이름으로 부르는 자료형 — 같은 말을 쓰는 자료형이 여럿이면 표의 첫 줄이다. */
export function typeOfKind(kind: TypeKind): string {
  return TYPE_BY_KIND[kind];
}
