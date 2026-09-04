// 도구를 부르며 여러 번 시도한 실행은 시도 단위로 읽힌다 (DESIGN §7 event-list run-turns).
// 머리말은 줄이 아니라 제목이다 — 누를 수 없고, 누르는 자리는 여전히 사건 줄뿐이다.
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import exampleSpec from "../../../examples/basic-agent/agent_spec.json";
import type { AgentSpec } from "../src/generated/agent_spec";
import type { RunEvent } from "../src/generated/run_event";
import { EventList } from "../src/run/EventList";
import { useEditor } from "../src/store/editor";
import { currentSeq } from "../src/store/runSlice";

const example = exampleSpec as unknown as AgentSpec;
const RUN = "run_turns";
const AGENT = "clinical-agent";
const TOOL = "search_article";
const AT = "2026-09-04T12:30:00.000Z";

function event(
  seq: number,
  event_type: RunEvent["event_type"],
  fields: Partial<RunEvent> = {},
): RunEvent {
  return {
    run_id: RUN,
    seq,
    event_type,
    timestamp: AT,
    spec_revision: example.revision,
    node_id: AGENT,
    payload: {},
    ...fields,
  };
}

// 사람 확인을 거쳐 이어진 실행 — 엔진의 차례 그대로.
const events: RunEvent[] = [
  event(0, "node.started"),
  event(1, "llm.requested", { turn: 0, payload: { closing: false } }),
  event(2, "llm.completed", {
    turn: 0,
    payload: { tool_calls: [{ call_id: "call-0", name: TOOL, arguments: {} }] },
  }),
  event(3, "human.approval_requested", { turn: 0, payload: { tool_name: TOOL } }),
  event(4, "run.paused"),
  event(5, "run.resumed"),
  event(6, "tool.requested", {
    turn: 0,
    payload: { call_id: "call-0", tool_name: TOOL, resource_ref: "clinical-reference" },
  }),
  event(7, "tool.completed", { turn: 0, payload: { call_id: "call-0", ok: true } }),
  event(8, "llm.requested", { turn: 1, payload: { closing: false } }),
  event(9, "llm.completed", { turn: 1, payload: { text: "천식이 의심돼요", tool_calls: [] } }),
];

const HEAD = "1번째 시도 — 'search_article' 도구를 불렀어요";

function watch() {
  act(() => {
    useEditor.setState({
      runEvents: events,
      activeRunId: RUN,
      runOffsetMs: 0,
      runHistory: [{ id: RUN, at: new Date(AT), order: 1, events, specSnapshot: example }],
    });
  });
  return render(<EventList />);
}

beforeEach(() => {
  useEditor.getState().loadSpec(example);
});

describe("시도 묶음이 선 실행 보기", () => {
  it("시도마다 무엇을 했는지 머리말 한 줄로 말한다", () => {
    watch();

    expect(screen.getByText(HEAD)).toBeInTheDocument();
    expect(screen.getByText("2번째 시도 — 답했어요")).toBeInTheDocument();
  });

  it("도구의 쉬운 설명은 머리말 아래 보조 표기로 붙는다", () => {
    const { container } = watch();

    expect(container.querySelector(".event-list__turn-tool")?.textContent).toBe(
      "물어본 것과 관련 있는 진료 지침 글을 찾아 목록으로 돌려준다.",
    );
  });

  it("사람 확인으로 끊겼다 이어져도 머리말은 한 번만 선다", () => {
    watch();

    expect(screen.getAllByText(HEAD)).toHaveLength(1);
  });

  it("이어진 뒷부분의 줄도 그 시도 안으로 들여쓴다", () => {
    watch();

    const resumed = screen
      .getByText("'clinical-agent' 노드가 'search_article' 도구를 불렀다")
      .closest("li");
    expect(resumed?.className).toContain("event-list__row--in-turn");
  });

  it("머리말은 누를 수 없고 지금 보는 줄도 아니다", () => {
    const { container } = watch();

    const head = container.querySelector(".event-list__turn-head");
    expect(head?.tagName).not.toBe("BUTTON");
    expect(head?.querySelector("button")).toBeNull();
    expect(head?.hasAttribute("aria-current")).toBe(false);
  });

  it("누를 수 있는 자리는 사건 줄만큼만 있다", () => {
    watch();

    expect(screen.getAllByRole("button")).toHaveLength(events.length);
  });

  it("시도에 들지 않은 줄은 들여쓰지 않는다", () => {
    watch();

    const first = screen.getByText("'clinical-agent' 노드가 일을 시작했다").closest("li");
    expect(first?.className).not.toContain("event-list__row--in-turn");
  });

  it("묶인 줄을 눌러도 재생 위치는 누른 그 줄이다", async () => {
    watch();

    await userEvent.click(
      within(
        screen
          .getByText("'clinical-agent' 노드가 'search_article' 도구를 불렀다")
          .closest("li") as HTMLElement,
      ).getByRole("button"),
    );

    expect(currentSeq(useEditor.getState())).toBe(6);
  });
});
