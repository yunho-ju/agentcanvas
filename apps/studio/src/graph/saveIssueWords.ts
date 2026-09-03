// 서버가 저장하며 본 첫 손볼 곳을 화면의 쉬운 말로 옮기는 표 (DESIGN §7 GP-3).
// 새 code가 생기면 이 표에 한 줄을 더한다 — 부르는 쪽은 고치지 않는다. 서버 원문은 쓰지 않는다.
import { type SaveIssue, needsAFix } from "../api/specs";
import { type Message, type MessageKey, msg } from "../i18n/messages";
import type { CardName } from "./cardName";

interface Words {
  key: MessageKey;
  /** 문장이 카드를 이름으로 부르는가 — 부를 이름이 없으면 이 말은 쓸 수 없다 */
  namesACard: boolean;
}

const ISSUE_WORDS = {
  "graph.unreachable_node": { key: "save.issue.unreachable", namesACard: true },
  "node.invalid_config": { key: "save.issue.invalidConfig", namesACard: true },
  "port.schema_mismatch": { key: "save.issue.schemaMismatch", namesACard: false },
  "graph.cycle": { key: "save.issue.cycle", namesACard: false },
  "skill.missing": { key: "save.issue.skillMissing", namesACard: true },
  "node.unknown_binding": { key: "save.issue.unknownBinding", namesACard: true },
} satisfies Record<string, Words>;

export interface SaveIssueWords {
  message: Message;
  /** 데려갈 카드 — 화면에 그 카드가 있을 때만 있다 */
  nodeId: string | null;
}

/**
 * 첫 손볼 곳을 부르는 한 문장. 표에 없는 code이거나 부를 카드 이름이 없으면 없다 —
 * 그때는 부르는 쪽이 세어 말하는 문장으로 물러난다.
 */
export function saveIssueWords(
  issues: SaveIssue[] | undefined,
  nodeNameOf: (nodeId: string) => CardName | null,
): SaveIssueWords | null {
  const first = (issues ?? []).find(needsAFix);
  if (!first) return null;

  if (!Object.hasOwn(ISSUE_WORDS, first.code)) return null;
  const words: Words = ISSUE_WORDS[first.code as keyof typeof ISSUE_WORDS];

  const name = first.node_id ? nodeNameOf(first.node_id) : null;
  if (words.namesACard && name === null) return null;

  return {
    message: name === null ? msg(words.key) : msg(words.key, { node: name }),
    nodeId: name === null ? null : (first.node_id ?? null),
  };
}
