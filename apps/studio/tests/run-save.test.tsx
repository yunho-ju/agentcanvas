// 실행하면 먼저 저장된다 — 서버는 저장된 판을 돌리므로, 저장하지 못하면 실행할 판도 없다.
// (예전에는 저장 실패에도 브라우저 안에서 실행했다 — 승인을 서버에 보내지 못하는 반쪽 실행이라 폐기했다.)
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import exampleSpec from "../../../examples/basic-agent/agent_spec.json";
import type { SaveOutcome } from "../src/api/specs";
import type { AgentSpec } from "../src/generated/agent_spec";
import { msg, translate } from "../src/i18n/messages";
import { RunControls } from "../src/shell/RunControls";
import { useEditor } from "../src/store/editor";
import { serveRuns, settle } from "./fakeRunServer";
import { asServerAnswer } from "./serverAnswer";

const example = exampleSpec as unknown as AgentSpec;
const SERVER_REVISION = `sha256:${"b".repeat(64)}`;
const trial = { runId: "run_from_server", startedAt: new Date("2026-08-01T12:30:00.000Z") };

function store() {
  return useEditor.getState();
}

/** 서버가 판을 매겨 돌려준다 — 그 판이 실행 기록에 적힌다. */
const savingServer = async (spec: AgentSpec): Promise<SaveOutcome> => ({
  saved: asServerAnswer({ ...spec, version: 4, revision: SERVER_REVISION }),
  issues: [],
});

const sleepingServer = async (): Promise<SaveOutcome> => ({
  failure: msg("save.offline"),
});

function revisionsInTheRun(): string[] {
  return [...new Set(store().runEvents.map((event) => event.spec_revision))];
}

beforeEach(() => {
  useEditor.setState({
    runEvents: [],
    runHistory: [],
    activeRunId: null,
    savedSpec: null,
    feedbackNotice: null,
    saving: false,
    startingRun: false,
  });
  store().loadSpec(example);
});

/**
 * 실행을 누른다 — 이 그래프는 실행에 넣을 값을 묻는다(DESIGN §7 run-input-card).
 * 카드가 서면 필수 값을 적고 넘긴다.
 */
async function tryARun() {
  await userEvent.click(screen.getByRole("button", { name: /실행해 보기/ }));
  const confirm = screen.queryByRole("button", { name: "이 값으로 실행" });
  if (!confirm) return;
  await userEvent.type(screen.getByLabelText(/^question/), "무엇을 볼까");
  await userEvent.click(confirm);
}

describe("서버가 켜져 있을 때의 실행", () => {
  it("실행하기 전에 먼저 저장한다", async () => {
    const sent: AgentSpec[] = [];
    serveRuns(trial);
    useEditor.setState({
      sendSpec: async (spec) => {
        sent.push(spec);
        return savingServer(spec);
      },
    });

    await store().saveThenRun();
    await settle();

    expect(sent).toHaveLength(1);
    expect(store().savedSpec?.revision).toBe(SERVER_REVISION);
  });

  it("서버에 실행을 부탁할 때 어느 판을 돌릴지 적어 보낸다", async () => {
    const asked: string[][] = [];
    useEditor.setState({
      sendSpec: savingServer,
      sendRunStart: async (specId, revision) => {
        asked.push([specId, revision]);
        return { failure: msg("run.start.offline") };
      },
    });

    await store().saveThenRun();

    expect(asked).toEqual([[example.id, SERVER_REVISION]]);
  });

  it("실행 기록의 모든 사건이 서버가 매긴 판을 달고 있다", async () => {
    serveRuns(trial);
    useEditor.setState({ sendSpec: savingServer });

    await store().saveThenRun();
    await settle();

    expect(store().runEvents.length).toBeGreaterThan(0);
    expect(revisionsInTheRun()).toEqual([SERVER_REVISION]);
  });

  it("남는 기록도 저장된 그래프다", async () => {
    serveRuns(trial);
    useEditor.setState({ sendSpec: savingServer });

    await store().saveThenRun();
    await settle();

    expect(store().runHistory).toHaveLength(1);
    expect(store().runHistory[0].specSnapshot.revision).toBe(SERVER_REVISION);
  });
});

describe("서버가 꺼져 있을 때의 실행", () => {
  beforeEach(() => {
    useEditor.setState({ sendSpec: sleepingServer });
  });

  it("실행하지 않는다 — 화면과 다른 그래프가 조용히 도는 일은 없다", async () => {
    const server = serveRuns(trial);

    await store().saveThenRun();
    await settle();

    expect(server.starts).toBe(0);
    expect(store().runEvents).toEqual([]);
    expect(store().runHistory).toEqual([]);
    expect(store().isPlaying).toBe(false);
  });

  it("왜 실행하지 못했는지와 다음 걸음을 말한다", async () => {
    serveRuns(trial);

    await store().saveThenRun();

    const notice = store().feedbackNotice;
    expect(notice?.tone).toBe("warn");
    expect(translate("ko", notice!.message)).toBe(
      "저장하지 못해 실행할 수 없어요 — 서버가 켜져 있는지 보고 다시 눌러 주세요",
    );
  });
});

describe("실행 버튼이 하는 일", () => {
  it("누르면 저장부터 한다 — 사용자는 '실행' 하나만 안다", async () => {
    const sent: AgentSpec[] = [];
    serveRuns(trial);
    useEditor.setState({
      sendSpec: async (spec) => {
        sent.push(spec);
        return savingServer(spec);
      },
    });
    render(<RunControls />);

    await tryARun();
    await settle();

    expect(sent).toHaveLength(1);
    expect(revisionsInTheRun()).toEqual([SERVER_REVISION]);
  });
});

describe("저장이 오가는 동안", () => {
  /** 손으로 놓아 줄 때까지 대답하지 않는 서버. */
  function slowServer() {
    let release: (() => void) | undefined;
    const sent: AgentSpec[] = [];
    return {
      sent,
      answer: () => release?.(),
      send: async (spec: AgentSpec) => {
        sent.push(spec);
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return {
          saved: asServerAnswer({ ...spec, version: 1, revision: SERVER_REVISION }),
          issues: [],
        };
      },
    };
  }

  it("두 번 눌러도 실행은 한 번이고, 거짓 안내를 하지 않는다", async () => {
    const server = slowServer();
    const runs = serveRuns(trial);
    useEditor.setState({ sendSpec: server.send });

    const first = store().saveThenRun();
    const second = store().saveThenRun();
    server.answer();
    await Promise.all([first, second]);
    await settle();

    expect(server.sent).toHaveLength(1);
    expect(runs.starts).toBe(1);
    expect(store().runHistory).toHaveLength(1);
    expect(translate("ko", store().feedbackNotice!.message)).toBe("저장했어요");
  });

  it("오가는 사이에 그래프를 고쳤어도 실행은 서버가 매긴 판으로 돈다", async () => {
    const server = slowServer();
    serveRuns(trial);
    useEditor.setState({ sendSpec: server.send });

    const running = store().saveThenRun();
    // 사용자가 그 사이에 노드를 옮겼다 — 저장한 그래프와 지금 그래프가 다르다.
    store().onNodesChange([
      { id: "triage", type: "position", position: { x: 999, y: 999 }, dragging: false },
    ]);
    server.answer();
    await running;
    await settle();

    expect(revisionsInTheRun()).toEqual([SERVER_REVISION]);
    expect(store().runEvents.length).toBeGreaterThan(0);
  });

  it("기록에 남는 그래프도 서버가 돌린 판이다 — 그 사이 화면에서 고친 것이 아니다", async () => {
    const server = slowServer();
    serveRuns(trial);
    useEditor.setState({ sendSpec: server.send });

    const running = store().saveThenRun();
    store().onNodesChange([
      { id: "triage", type: "position", position: { x: 999, y: 999 }, dragging: false },
    ]);
    server.answer();
    await running;
    await settle();

    const ran = store().runHistory[0].specSnapshot;
    expect(ran.revision).toBe(SERVER_REVISION);
    expect(ran.nodes.find((node) => node.id === "triage")?.position).not.toEqual({
      x: 999,
      y: 999,
    });
  });
});
