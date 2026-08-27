// 받아 줄 자리가 하나도 없는 드래그에 말을 건다 (C5) — 조용한 실패 금지 (DESIGN §9).
import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import exampleSpec from "../../../examples/basic-agent/agent_spec.json";
import { type HeldPort, heldPortOf, useLandingHint } from "../src/canvas/useLandingHint";
import type { AgentSpec } from "../src/generated/agent_spec";
import { msg, translate } from "../src/i18n/messages";
import { useEditor } from "../src/store/editor";

const example = exampleSpec as unknown as AgentSpec;

function store() {
  return useEditor.getState();
}

/** 캔버스 좌표를 화면 좌표로 옮기는 자 — 시험에서는 자리를 그대로 옮긴 것으로 본다. */
const asScreen = (at: { x: number; y: number }) => at;

function Dragging({ held }: { held: HeldPort | null }) {
  useLandingHint(held, asScreen);
  return null;
}

function heldPort(nodeId: string, portId: string): HeldPort {
  return { nodeId, portId, side: "source", x: 30, y: 40 };
}

function said(): string {
  const hint = store().connectionHint;
  return hint ? translate("ko", hint.message) : "";
}

beforeEach(() => {
  store().loadSpec(example);
});

// 캔버스 라이브러리가 말하는 "지금 끌고 있는 연결"을 우리 말로 옮기는 자리.
describe("지금 무엇을 쥐고 있는가", () => {
  const handle = { nodeId: "triage", id: "route", type: "source" as const };

  it("끌고 있는 포트와 그 자리를 그대로 옮긴다", () => {
    expect(
      heldPortOf({ inProgress: true, fromHandle: handle, from: { x: 7, y: 9 } }),
    ).toEqual({ nodeId: "triage", portId: "route", side: "source", x: 7, y: 9 });
  });

  it("끌고 있지 않으면 쥔 것도 없다", () => {
    expect(
      heldPortOf({ inProgress: false, fromHandle: handle, from: { x: 7, y: 9 } }),
    ).toBeNull();
    expect(
      heldPortOf({ inProgress: true, fromHandle: null, from: { x: 7, y: 9 } }),
    ).toBeNull();
  });

  it("이름 없는 손잡이는 포트가 아니다", () => {
    expect(
      heldPortOf({
        inProgress: true,
        fromHandle: { ...handle, id: null },
        from: { x: 7, y: 9 },
      }),
    ).toBeNull();
  });
});

describe("연결을 끌기 시작했을 때", () => {
  it("받아 줄 자리가 하나도 없으면 이유와 다음 걸음을 말한다", () => {
    useEditor.setState({ nodes: store().nodes.slice(0, 1), edges: [] });

    render(<Dragging held={heldPort("input", "question")} />);

    expect(said()).toContain("question");
    expect(store().connectionHint?.tone).toBe("warn");
    expect(store().connectionHint?.at).toEqual({ x: 30, y: 40 });
  });

  it("영어로 읽는 사람에게도 다음 걸음을 말한다", () => {
    useEditor.setState({ nodes: store().nodes.slice(0, 1), edges: [] });

    render(<Dragging held={heldPort("input", "question")} />);
    const hint = store().connectionHint;

    expect(hint && translate("en", hint.message)).toContain("empty");
  });

  it("갈 수 있는 자리가 있으면 아무 말도 하지 않는다", () => {
    render(<Dragging held={heldPort("input", "patient_context")} />);

    expect(store().connectionHint).toBeNull();
  });

  it("아무도 끌고 있지 않으면 아무 말도 하지 않는다", () => {
    render(<Dragging held={null} />);

    expect(store().connectionHint).toBeNull();
  });

  // 초대가 예고한 일이 시작됐다 — 할 일을 다 한 말은 남지 않는다 (DESIGN §7).
  it("연결을 쥐는 순간 떠 있던 안내는 물러난다", () => {
    store().showConnectionHint({
      message: msg("hint.firstLink"),
      tone: "warn",
      at: { x: 1, y: 2 },
    });

    render(<Dragging held={heldPort("input", "patient_context")} />);

    expect(store().connectionHint).toBeNull();
  });

  it("같은 포트를 쥐고 있는 동안 한 번만 말한다", () => {
    useEditor.setState({ nodes: store().nodes.slice(0, 1), edges: [] });
    const { rerender } = render(<Dragging held={heldPort("input", "question")} />);

    store().clearConnectionHint();
    rerender(<Dragging held={heldPort("input", "question")} />);

    expect(store().connectionHint).toBeNull();
  });

  it("다른 포트를 새로 쥐면 그 포트에 대해 다시 말한다", () => {
    useEditor.setState({ nodes: store().nodes.slice(0, 2), edges: [] });
    const { rerender } = render(<Dragging held={heldPort("triage", "route")} />);
    store().clearConnectionHint();

    rerender(<Dragging held={heldPort("triage", "passthrough")} />);

    expect(said()).toContain("passthrough");
  });
});
