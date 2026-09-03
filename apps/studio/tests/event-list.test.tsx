import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import exampleSpec from "../../../examples/basic-agent/agent_spec.json";
import type { AgentSpec } from "../src/generated/agent_spec";
import { EVENT_STEP_MS } from "../src/run/fakeRun";
import { EventList } from "../src/run/EventList";
import { useEditor } from "../src/store/editor";
import { currentSeq } from "../src/store/runSlice";
import { runOnServer, settle } from "./fakeRunServer";

const example = exampleSpec as unknown as AgentSpec;
const trial = { runId: "run_example", startedAt: new Date("2026-08-01T12:30:00.000Z") };

function store() {
  return useEditor.getState();
}

async function startRun() {
  await act(async () => {
    await runOnServer(trial);
  });
}

function itemFor(text: string | RegExp) {
  const item = screen.getByText(text).closest("li");
  if (!item) throw new Error("the event is not on the list");
  return item;
}

beforeEach(() => {
  store().loadSpec(example);
});

describe("the list of what happened during the run", () => {
  it("stays out of the way while the user is editing", () => {
    render(<EventList />);

    expect(screen.queryByRole("list")).not.toBeInTheDocument();
  });

  it("tells the story in the order it happened, in plain words", async () => {
    await startRun();
    // 예시 그래프는 사람 확인 밸브에서 한 번 멈춘다 — 승인해야 끝까지의 이야기가 남는다.
    await act(async () => {
      store().tickRun(EVENT_STEP_MS * 1000);
      await store().approveGate();
      await settle();
    });
    render(<EventList />);

    const said = screen.getAllByRole("listitem").map((item) => item.textContent ?? "");
    expect(said[0]).toContain("실행을 시작했다");
    expect(said.at(-1)).toContain("실행을 모두 마쳤다");
    expect(said.some((line) => line.includes("'triage' 노드가 일을 시작했다"))).toBe(true);
  });

  it("keeps the original event name as a note beside the plain words", async () => {
    await startRun();
    render(<EventList />);

    expect(within(itemFor("'triage' 노드가 일을 시작했다")).getByText("node.started"))
      .toBeInTheDocument();
  });

  it("marks the moment the canvas is showing right now", async () => {
    await startRun();
    render(<EventList />);

    expect(
      within(itemFor("실행을 시작했다")).getByRole("button"),
    ).toHaveAttribute("aria-current", "true");
  });

  it("winds the run to the event the user picks", async () => {
    await startRun();
    render(<EventList />);

    await userEvent.click(
      within(itemFor("'triage' 노드가 일을 시작했다")).getByRole("button"),
    );

    expect(
      store().runEvents.find((event) => event.seq === currentSeq(store()))?.node_id,
    ).toBe("triage");
  });

  it("selects the node the picked event belongs to", async () => {
    await startRun();
    render(<EventList />);

    await userEvent.click(
      within(itemFor("'triage' 노드가 일을 시작했다")).getByRole("button"),
    );

    expect(store().nodes.filter((node) => node.selected).map((node) => node.id)).toEqual([
      "triage",
    ]);
  });

  it("opens up what the picked event carried", async () => {
    await startRun();
    render(<EventList />);

    await userEvent.click(
      within(itemFor("'triage' 노드가 인공지능에게 물어봤다")).getByRole("button"),
    );

    expect(
      within(itemFor("'triage' 노드가 인공지능에게 물어봤다")).getByText(
        /model_ref: "model:\/\/default"/,
      ),
    ).toBeInTheDocument();
  });

  it("shows what an event carried only for the event on screen", async () => {
    await startRun();
    render(<EventList />);

    expect(screen.getAllByRole("definition")).toHaveLength(1);
  });
});

// 도구가 진짜로 일한 실행을 사람이 목록에서 읽는다 (API_TOOLS P3a — 결과를 볼 수 있는가).
describe("도구가 일한 실행을 읽는 목록", () => {
  const asked = {
    node_id: "lookup",
    resource_ref: "clinical-reference",
    tool_name: "search_article",
  };

  function toolRun(last: Record<string, unknown>) {
    const at = new Date("2026-08-01T12:30:00.000Z");
    const base = {
      run_id: "run_tools",
      timestamp: at.toISOString(),
      spec_revision: example.revision,
      node_id: "lookup",
    };
    return [
      { ...base, seq: 0, event_type: "run.started", node_id: null, payload: {} },
      { ...base, seq: 1, event_type: "node.started", payload: { node_type: "tool.mcp" } },
      {
        ...base,
        seq: 2,
        event_type: "tool.policy_checked",
        payload: { ...asked, allowed: true },
      },
      {
        ...base,
        seq: 3,
        event_type: "tool.requested",
        payload: { ...asked, input: { query: "asthma" } },
      },
      { ...base, seq: 4, event_type: "tool.completed", payload: { ...asked, ...last } },
    ];
  }

  /** 쉬운 말 본문만 읽는다 — 원문 payload는 지금 보고 있는 줄에만 붙는 보조 표기다. */
  function watch(events: unknown[]) {
    act(() => {
      useEditor.setState({
        runEvents: events as never,
        activeRunId: "run_tools",
        runOffsetMs: EVENT_STEP_MS * 100,
      });
    });
    const { container } = render(<EventList />);
    return [...container.querySelectorAll(".event-list__summary")].map(
      (said) => said.textContent ?? "",
    );
  }

  it("무엇을 부르고 무엇을 받았는지, 크기까지 한 줄로 읽는다", () => {
    const said = watch(
      toolRun({
        ok: true,
        result: { articles: [] },
        original_chars: 120,
        loaded_chars: 120,
      }),
    );

    expect(said.some((line) => line.includes("'search_article' 도구를 불렀다"))).toBe(
      true,
    );
    expect(
      said.some((line) => line.includes("원문 120자 중 120자를 실었다")),
    ).toBe(true);
  });

  it("retrieve로 골라 실은 답은 절감이 화면에 뜬다 (API_TOOLS P3d, 등급 B)", () => {
    const said = watch(
      toolRun({
        ok: true,
        result: { diagnosis: "asthma..." },
        original_chars: 9000,
        loaded_chars: 420,
        query: "asthma cough",
        retrieved: [{ chunk: "diagnosis", score: 3.1 }],
      }),
    );

    // 실제 EventList 컴포넌트가 두 수가 갈린 절감을 화면 한 줄에 보여 준다.
    expect(
      said.some((line) => line.includes("원문 9000자 중 420자를 실었다")),
    ).toBe(true);
  });

  it("digest로 요약해 실은 답도 절감이 화면에 뜬다 (API_TOOLS P3e, 등급 B)", () => {
    const said = watch(
      toolRun({
        ok: true,
        result: "a brief summary of the answer",
        original_chars: 12400,
        loaded_chars: 29,
        digest: { model_ref: "model://summary", max_chars: 500 },
      }),
    );

    // 실제 EventList 컴포넌트가 요약의 큰 절감을 화면 한 줄에 보여 준다.
    expect(
      said.some((line) => line.includes("원문 12400자 중 29자를 실었다")),
    ).toBe(true);
  });

  it("도구가 마치지 못했으면 끝맺음 줄도 초록불로 말하지 않는다", () => {
    const closed = [
      ...toolRun({
        ok: false,
        error: { reason: "timeout", message: "waited too long" },
        original_chars: 0,
        loaded_chars: 0,
      }),
      {
        run_id: "run_tools",
        seq: 5,
        event_type: "run.completed",
        timestamp: "2026-08-01T12:30:00.000Z",
        spec_revision: example.revision,
        node_id: null,
        payload: { node_count: 2 },
      },
    ];

    const said = watch(closed);

    const last = said.at(-1) ?? "";
    expect(last).not.toBe("실행을 모두 마쳤다");
    expect(last).toMatch(/도구/);
  });

  it("도구가 다 마친 실행은 끝맺음 줄이 예전 그대로다", () => {
    const closed = [
      ...toolRun({
        ok: true,
        result: { articles: [] },
        original_chars: 12,
        loaded_chars: 12,
      }),
      {
        run_id: "run_tools",
        seq: 5,
        event_type: "run.completed",
        timestamp: "2026-08-01T12:30:00.000Z",
        spec_revision: example.revision,
        node_id: null,
        payload: { node_count: 2 },
      },
    ];

    expect((watch(closed).at(-1) ?? "")).toBe("실행을 모두 마쳤다");
  });

  it("도구가 마치지 못한 실행은 그 사실과 다음 걸음을 읽는다", () => {
    const said = watch(
      toolRun({
        ok: false,
        error: { reason: "timeout", message: "waited too long" },
        original_chars: 0,
        loaded_chars: 0,
      }),
    );

    const line = said.find((one) => one.includes("일을 마치지 못했다"));
    expect(line).toBeDefined();
    expect(line).toContain("기다렸는데");
    expect(line).not.toContain("waited too long");
  });
});

// 입은 skill이 실행에서 실제로 따라졌는지 사람이 읽는다 (SK-2 — 결과를 볼 수 있는가).
describe("그 걸음이 따른 skill", () => {
  function askedWith(payload: Record<string, unknown>) {
    return [
      {
        run_id: "run_skills",
        seq: 0,
        event_type: "llm.requested",
        timestamp: "2026-08-01T12:30:00.000Z",
        spec_revision: example.revision,
        node_id: "triage",
        payload,
      },
    ];
  }

  function watching(events: unknown[]) {
    act(() => {
      useEditor.setState({
        runEvents: events as never,
        activeRunId: "run_skills",
        runOffsetMs: 0,
      });
    });
    return render(<EventList />);
  }

  const FOLLOWED = ["skill://plain-answer@1", "skill://cite-sources@1"];

  it("따른 skill이 있으면 그 이름을 쉬운 말 한 줄로 읽는다", () => {
    watching(askedWith({ model_ref: "model://default", skill_refs: FOLLOWED }));

    // 처음 나오는 낱말에는 뜻풀이가 함께 온다 (쉬운 말 원칙).
    expect(
      screen.getByText(
        "따르는 skill(일하는 방법을 적어 둔 글): plain-answer, cite-sources",
      ),
    ).toBeInTheDocument();
  });

  it("쉬운 말로 말한 것을 원문 이름표로 또 말하지 않는다", () => {
    const { container } = watching(
      askedWith({ model_ref: "model://default", skill_refs: FOLLOWED }),
    );

    const detail = container.querySelector(".event-list__payload")?.textContent ?? "";
    expect(detail).not.toContain("skill://");
    // 나머지 원문은 그대로 남는다 — 이 줄만 대신 말해진 것이다.
    expect(detail).toContain('model_ref: "model://default"');
  });

  it("따른 skill이 없는 걸음에는 그 줄이 아예 없다", () => {
    watching(askedWith({ model_ref: "model://default" }));

    expect(screen.queryByText(/따르는 skill/)).not.toBeInTheDocument();
  });
});
