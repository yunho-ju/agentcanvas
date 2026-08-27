// 연결을 끄는 동안 포트가 스스로를 어떻게 보여줄지 (디자인 언어 §1.5 포트 라벨).
// 정보가 가장 필요한 순간 — 이을 수 있는 포트는 라벨과 함께 밝아지고, 나머지는 물러난다.
import { describe, expect, it } from "vitest";
import { type PortAddress, portLinkState } from "../src/canvas/portLink";

const out = (nodeId: string, portId = "response"): PortAddress => ({
  nodeId,
  portId,
  side: "source",
});
const into = (nodeId: string, portId = "messages"): PortAddress => ({
  nodeId,
  portId,
  side: "target",
});

const anything = () => true;
const nothing = () => false;

describe("아무도 연결을 끌고 있지 않을 때", () => {
  it("포트는 조용히 점으로만 있다", () => {
    expect(portLinkState(null, into("b"), anything)).toBe("idle");
  });
});

describe("연결을 끄는 동안", () => {
  it("끌기 시작한 포트 자신은 밝다", () => {
    expect(portLinkState(out("a"), out("a"), nothing)).toBe("compatible");
  });

  it("이을 수 있는 반대편 포트는 라벨과 함께 밝아진다", () => {
    expect(portLinkState(out("a"), into("b"), anything)).toBe("compatible");
  });

  it("계약이 거절하는 포트는 물러난다", () => {
    expect(portLinkState(out("a"), into("b"), nothing)).toBe("incompatible");
  });

  it("같은 노드의 다른 포트에는 잇지 않는다", () => {
    expect(portLinkState(out("a"), into("a"), anything)).toBe("incompatible");
  });

  it("출력끼리·입력끼리는 잇지 않는다", () => {
    expect(portLinkState(out("a"), out("b"), anything)).toBe("incompatible");
    expect(portLinkState(into("a"), into("b"), anything)).toBe("incompatible");
  });

  it("입력에서 끌기 시작하면 방향을 뒤집어 묻는다", () => {
    const asked: PortAddress[][] = [];
    portLinkState(into("b"), out("a"), (source, target) => {
      asked.push([source, target]);
      return true;
    });
    expect(asked).toEqual([[out("a"), into("b")]]);
  });

  it("출력에서 끌기 시작하면 그 포트가 보내는 쪽이다", () => {
    const asked: PortAddress[][] = [];
    portLinkState(out("a"), into("b"), (source, target) => {
      asked.push([source, target]);
      return true;
    });
    expect(asked).toEqual([[out("a"), into("b")]]);
  });
});
