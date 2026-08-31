// 대화 문을 열 수 있는가 — 그리고 못 열면 왜인가 (순수 함수, DESIGN §7 chat-panel).
// 판정의 근거는 캔버스의 지금 그래프가 아니라 **게시된 판**이다: 사람들이 말을 거는 상대는
// 만드는 사람이 고치는 중인 그래프가 아니라 내놓은 그 판이기 때문이다 (CHAT-3b 결정 3).
import type { AgentSpec } from "../generated/agent_spec";
import type { SpecPublication } from "../generated/spec_publication";
import { type Message, type MessageKey, msg } from "../i18n/messages";
import { inputBindingNames } from "../run/runInput";

/** 사람의 말이 실리는 입력 이름 — 계약을 늘리지 않고 이름 관례로 정한다 (결정 1). */
export const CHAT_SAID_BINDING = "message";

/** 지난 대화가 실리는 입력 이름 — 받는 판에만 실어 보낸다 (결정 2). */
export const CHAT_HISTORY_BINDING = "history";

/** 그 판이 대화에서 받아 주는 자리들. */
export interface ChatBindings {
  said: boolean;
  history: boolean;
}

/** 게시된 판이 무엇을 받는가 — 입력 노드가 받기로 한 이름이 곧 대화의 자리다. */
export function chatBindings(spec: AgentSpec): ChatBindings {
  const names = inputBindingNames(spec);
  return {
    said: names.includes(CHAT_SAID_BINDING),
    history: names.includes(CHAT_HISTORY_BINDING),
  };
}

/** 대화 문 앞에서 화면이 아는 사실 — 이것만으로 열지 말지가 정해진다. */
export interface ChatDoor {
  hasDoc: boolean;
  publication: SpecPublication | null;
  /** 손에 든 판의 몸통 — 지금 내놓은 판의 것인지는 이 자리에서 확인한다 */
  publishedSpec: AgentSpec | null;
  /** 그 몸통을 읽어 보려다 못 읽은 까닭 — 못 읽은 것과 아직 안 읽은 것은 다른 자리다 */
  publishedSpecFailure: Message | null;
}

/**
 * 지금 내놓은 판의 몸통 — 손에 든 것이 그 판의 것이 아니면 없는 것으로 본다.
 * 문 판정도 화면도 이 한 자리를 함께 본다 (판단이 두 벌로 갈라지지 않게 한다).
 */
export function publishedBody(
  publication: SpecPublication | null,
  held: AgentSpec | null,
): AgentSpec | null {
  if (publication === null || held === null) return null;
  return held.revision === publication.revision ? held : null;
}

/** 문을 못 여는 까닭 — 각각 다음 걸음이 다르므로 하나로 뭉치지 않는다. */
export type ChatDoorBlock =
  | "noDoc"
  | "notPublished"
  | "checking"
  | "checkFailed"
  | "noMessageInput";

/** 못 여는 까닭과, 그 까닭을 사람에게 말하는 한 문장. */
export interface ChatDoorTrouble {
  block: ChatDoorBlock;
  words: Message;
}

/** 까닭마다 하는 말 — 새 까닭이 생기면 이 표에 한 줄을 더한다 (분기 대신 표). */
const DOOR_WORDS: Record<Exclude<ChatDoorBlock, "checkFailed">, MessageKey> = {
  noDoc: "chat.door.noDoc",
  // 게시가 없다는 말은 대화를 시작하지 못한 자리와 같은 말이다 — 한 사실을 두 목소리로 말하지 않는다.
  notPublished: "chat.start.notPublished",
  checking: "chat.door.checking",
  noMessageInput: "chat.door.noMessageInput",
};

/**
 * 대화 문을 못 여는 까닭 — 열 수 있으면 없음(null)이다.
 * 비활성은 언제나 이유를 말한다 (DESIGN §9): 까닭과 문장이 한 자리에서 함께 나온다.
 */
export function chatDoorTrouble(door: ChatDoor): ChatDoorTrouble | null {
  const block = blockedBy(door);
  if (block === null) return null;
  return {
    block,
    words:
      block === "checkFailed"
        ? msg(checkFailedWords(door.publishedSpecFailure))
        : msg(DOOR_WORDS[block as Exclude<ChatDoorBlock, "checkFailed">]),
  };
}

/** 못 읽은 갈래마다 이 문 스스로의 말 — 서버 문의 문장을 실어 나르지 않는다. */
const CHECK_FAILED_WORDS: Record<string, MessageKey> = {
  "open.offline": "chat.door.checkFailed.offline",
  "open.notFound": "chat.door.checkFailed.gone",
};

/**
 * 판을 못 읽은 까닭을 이 문의 말로 옮긴다 — 갈래를 아는 것만 갈라 말하고, 나머지는 한 갈래다.
 * 서버가 함께 보낸 원문(reason·detail)은 어떤 자리로도 화면에 나오지 않는다 (DESIGN §9):
 * 그래서 서버 문의 문장을 끼워 넣지 않고, 갈래(키)만 보고 우리 말을 고른다.
 */
function checkFailedWords(failure: Message | null): MessageKey {
  return (failure && CHECK_FAILED_WORDS[failure.key]) ?? "chat.door.checkFailed";
}

function blockedBy(door: ChatDoor): ChatDoorBlock | null {
  if (!door.hasDoc) return "noDoc";
  if (door.publication === null) return "notPublished";
  const body = publishedBody(door.publication, door.publishedSpec);
  if (body === null) return door.publishedSpecFailure ? "checkFailed" : "checking";
  return chatBindings(body).said ? null : "noMessageInput";
}
