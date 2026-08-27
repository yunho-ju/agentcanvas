// 연결을 끄는 동안 포트 하나가 어떤 모습이어야 하는가 (디자인 언어 §1.5).
// 계약 판정(checkConnection)은 밖에서 주입받는다 — 이 파일은 순수한 규칙만 안다.

export interface PortAddress {
  nodeId: string;
  portId: string;
  /** 보내는 쪽(source)인가 받는 쪽(target)인가 */
  side: "source" | "target";
}

/** idle: 평소의 점 · compatible: 라벨과 함께 밝게 · incompatible: 물러남 */
export type PortLinkState = "idle" | "compatible" | "incompatible";

export function portLinkState(
  from: PortAddress | null,
  port: PortAddress,
  canLink: (source: PortAddress, target: PortAddress) => boolean,
): PortLinkState {
  if (!from) return "idle";
  // 끌기 시작한 포트 자신은 언제나 밝다 — 지금 손에 쥔 것이 무엇인지 보여야 한다.
  if (from.nodeId === port.nodeId && from.portId === port.portId && from.side === port.side) {
    return "compatible";
  }
  if (from.nodeId === port.nodeId || from.side === port.side) return "incompatible";

  const [source, target] = from.side === "source" ? [from, port] : [port, from];
  return canLink(source, target) ? "compatible" : "incompatible";
}
