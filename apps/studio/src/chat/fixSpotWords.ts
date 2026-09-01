// 고칠 자리가 하는 말 — 뱃지 한 줄(결론)과 그 아래 한마디(다음 걸음), 목록 위 요약 한 줄.
// 파생 규칙(fixSpots)과 자리를 나눈다: 규칙이 늘면 이 표에 한 줄이 늘 뿐 규칙은 그대로다.
// 숫자·백분율·점수를 말하지 않고(요약 pill 규율), 서버 원문(도구 error.message·reason 원명)도 쓰지 않는다.
import type { Locale } from "../i18n/locale";
import { type Message, type MessageKey, msg, translate } from "../i18n/messages";
import { toolTroubleWords } from "../run/eventWords";
import type { FixSpot, FixSpotKind } from "./fixSpots";

/** 갈래마다 한 줄 — 새 갈래는 표에 한 줄을 더한다(분기 금지). */
type FixSpotSaying = {
  [Kind in FixSpotKind]: (spot: Extract<FixSpot, { kind: Kind }>) => Message;
};

/** 이름이 적혀 있지 않은 옛 사건은 이름을 지어내지 않고 그렇다고 말한다. */
function named(name: string | null, unknown: MessageKey): Message | string {
  return name ?? msg(unknown);
}

/**
 * 뱃지에 설 한 줄 — 결론이 먼저다.
 * 도구가 어그러진 자리는 어느 연결·어느 도구·무슨 갈래인지까지 **상시 보이게** 말한다
 * (DESIGN §7 chat-panel 뱃지 ②): 손대야 알 수 있는 곳(title)에만 두지 않는다.
 */
const BADGE: FixSpotSaying = {
  heldForCheck: () => msg("chat.fix.heldForCheck"),
  toolFailed: (spot) =>
    msg("chat.fix.toolFailed", {
      resource: named(spot.resource, "chat.fix.resource.unnamed"),
      tool: named(spot.tool, "chat.fix.tool.unnamed"),
      why: toolTroubleWords(spot.trouble),
    }),
  unfinished: () => msg("chat.fix.unfinished"),
  abandoned: () => msg("chat.fix.abandoned"),
  askedAgain: () => msg("chat.fix.askedAgain"),
};

const HINT: FixSpotSaying = {
  heldForCheck: () => msg("chat.fix.heldForCheck.hint"),
  toolFailed: () => msg("chat.fix.toolFailed.hint"),
  unfinished: () => msg("chat.fix.unfinished.hint"),
  abandoned: () => msg("chat.fix.abandoned.hint"),
  askedAgain: () => msg("chat.fix.askedAgain.hint"),
};

/** 요약 줄에 설 짧은 이름 — 여러 갈래를 한 줄에 늘어놓기 위한 말이다. */
const SHORT: Record<FixSpotKind, MessageKey> = {
  heldForCheck: "chat.fix.short.heldForCheck",
  toolFailed: "chat.fix.short.toolFailed",
  unfinished: "chat.fix.short.unfinished",
  abandoned: "chat.fix.short.abandoned",
  askedAgain: "chat.fix.short.askedAgain",
};

/** 표에서 그 갈래의 말을 고른다 — 고른 뒤에는 그 갈래의 자리 하나만 건넨다. */
function sayingFor(table: FixSpotSaying, spot: FixSpot): Message {
  return (table[spot.kind] as (one: FixSpot) => Message)(spot);
}

export function fixSpotWords(spot: FixSpot): Message {
  return sayingFor(BADGE, spot);
}

/** 그 자리에서 무엇을 할 수 있는지 한마디 — 까닭으로 끝내지 않는다. */
export function fixSpotHint(spot: FixSpot): Message {
  return sayingFor(HINT, spot);
}

/**
 * 목록 위 요약 한 줄 — 어떤 갈래의 자리가 있는지만 말한다 (브리프 N1, 결론이 먼저).
 * 개수도 백분율도 말하지 않는다: 같은 갈래가 열 번 나와도 화면이 하는 말은 "그 자리가 있다"이다.
 * 하나도 없으면 줄을 세우지 않는다(빈 줄로 자리를 차지하지 않는다).
 */
export function fixSpotSummary(spots: FixSpot[], locale: Locale): string | null {
  const kinds = [...new Set(spots.map((spot) => spot.kind))];
  if (kinds.length === 0) return null;
  return translate(
    locale,
    msg("chat.fix.summary", {
      spots: kinds.map((kind) => translate(locale, msg(SHORT[kind]))).join(" · "),
    }),
  );
}
