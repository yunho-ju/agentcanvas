// 실패로 끝난 실행은 히스토리 카드에서도 그렇게 말한다 (DESIGN §7 run-history 실패 뱃지).
// 종결 상태는 따로 저장하지 않는다 — 그 실행의 이벤트에서 파생한 사실이다.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import exampleSpec from "../../../examples/basic-agent/agent_spec.json";
import type { AgentSpec } from "../src/generated/agent_spec";
import type { RunEvent } from "../src/generated/run_event";
import { RunHistoryStrip } from "../src/run/RunHistoryStrip";
import { endedInFailure } from "../src/run/player";
import { useEditor } from "../src/store/editor";
import { runOnServer } from "./fakeRunServer";

const example = exampleSpec as unknown as AgentSpec;

function store() {
  return useEditor.getState();
}

/** 그 실행이 실패로 닫혔다고 해 둔다 — 기록에 남는 것은 이벤트뿐이다. */
function endWithFailure(runId: string) {
  const record = store().runHistory.find((item) => item.id === runId);
  if (!record) throw new Error(`no run called ${runId}`);
  const last = record.events.at(-1);
  if (!last) throw new Error("the run left no events");
  const failed: RunEvent = {
    ...last,
    seq: last.seq + 1,
    event_type: "run.failed",
    payload: { reason: "provider_error" },
  };
  useEditor.setState({
    runHistory: store().runHistory.map((item) =>
      item.id === runId ? { ...item, events: [...item.events, failed] } : item,
    ),
  });
}

beforeEach(() => {
  useEditor.setState({ runEvents: [], runHistory: [], activeRunId: null });
  store().loadSpec(example);
});

describe("실패로 끝난 실행의 카드", () => {
  it("실패했다고 늘 말한다", async () => {
    await runOnServer({ runId: "run_1", startedAt: new Date("2026-08-01T12:30:00Z") });
    endWithFailure("run_1");
    render(<RunHistoryStrip />);

    expect(screen.getByText("실패")).toBeInTheDocument();
  });

  it("끝까지 잘 간 실행에는 그 말이 없다", async () => {
    await runOnServer({ runId: "run_1", startedAt: new Date("2026-08-01T12:30:00Z") });
    render(<RunHistoryStrip />);

    expect(screen.queryByText("실패")).not.toBeInTheDocument();
  });

  it("실패 실행에는 시험으로 남기기가 있고, 기존 초안이 있으면 잠근다", async () => {
    await runOnServer({ runId: "run_1", startedAt: new Date("2026-08-01T12:30:00Z") });
    endWithFailure("run_1");
    useEditor.setState({
      caseDraft: {
        id: null,
        title: "내 초안",
        input: {},
        expectedText: "기대 문구",
        runsPerCase: 1,
        passesNeeded: 1,
      },
    });
    render(<RunHistoryStrip />);

    const promote = screen.getByRole("button", { name: "시험으로 남기기" });
    expect(promote).toBeDisabled();
    expect(promote).toHaveAttribute("title", "먼저 열어 둔 시험 초안을 저장하거나 닫아 주세요");
  });

  it("완료 실행에는 시험으로 남기기가 없다", async () => {
    await runOnServer({ runId: "run_1", startedAt: new Date("2026-08-01T12:30:00Z") });
    render(<RunHistoryStrip />);

    expect(screen.queryByRole("button", { name: "시험으로 남기기" })).not.toBeInTheDocument();
  });
});

describe("실패로 닫혔는가라는 물음", () => {
  it("실패 사건으로 닫힌 실행에만 그렇다고 답한다", () => {
    const at = "2026-08-01T12:30:00.000Z";
    const base = {
      run_id: "run_1",
      timestamp: at,
      spec_revision: `sha256:${"a".repeat(64)}`,
      payload: {},
    };
    const started = { ...base, seq: 1, event_type: "run.started" } as RunEvent;
    const failed = { ...base, seq: 2, event_type: "run.failed" } as RunEvent;
    const completed = { ...base, seq: 2, event_type: "run.completed" } as RunEvent;

    expect(endedInFailure([started, failed])).toBe(true);
    expect(endedInFailure([started, completed])).toBe(false);
    expect(endedInFailure([started])).toBe(false);
    expect(endedInFailure([])).toBe(false);
  });
});

describe("실패 뱃지가 입은 옷", () => {
  const app = readFileSync(join(process.cwd(), "src/app.css"), "utf-8");

  function cssBlock(selector: string): string {
    const at = app.indexOf(`${selector} {`);
    return at === -1 ? "" : app.slice(at, app.indexOf("}", at));
  }

  it("문제의 색을 세 겹으로 입는다 — 바탕·글자·기호", () => {
    expect(cssBlock(".run-history__failed")).toContain("var(--danger-soft)");
    expect(cssBlock(".run-history__failed")).toContain("var(--danger-ink)");
    expect(app).toContain(".run-history__failed-mark");
  });

  it("숨었다 나타나지 않는다 — 문제는 늘 보인다", () => {
    expect(app).not.toContain(":hover .run-history__failed");
  });
});
