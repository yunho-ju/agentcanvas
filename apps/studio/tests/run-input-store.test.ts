// 실행에 넣은 값이 서버까지 가는 길, 그리고 그 값을 묻는 카드의 상태.
// 카드가 무엇을 그릴지는 순수 함수가 정하고(run/runInput), 여기 있는 것은 상태 전이뿐이다.
import { beforeEach, describe, expect, it } from "vitest";
import exampleSpec from "../../../examples/basic-agent/agent_spec.json";
import type { AgentSpec } from "../src/generated/agent_spec";
import { msg } from "../src/i18n/messages";
import { useEditor } from "../src/store/editor";
import { serveRuns, settle } from "./fakeRunServer";
import { asServerAnswer } from "./serverAnswer";

const example = exampleSpec as unknown as AgentSpec;
const SERVER_REVISION = `sha256:${"c".repeat(64)}`;
const trial = { runId: "run_with_input", startedAt: new Date("2026-08-01T12:30:00.000Z") };

function store() {
  return useEditor.getState();
}

/** 입력 노드가 아예 없는 그래프 — 실행이 물을 것이 없는 문서다. */
const askingNothing = {
  ...example,
  input_schema: {},
  nodes: example.nodes.filter((node) => node.type !== "core.input"),
  edges: example.edges.filter(
    (edge) => edge.source.node !== "input" && edge.target.node !== "input",
  ),
} as AgentSpec;

/** 서버가 판을 매겨 돌려주는 저장 문. */
function serveSavingServer() {
  useEditor.setState({
    sendSpec: async (spec) => ({
      saved: asServerAnswer({ ...spec, version: 2, revision: SERVER_REVISION }),
      issues: [],
    }),
  });
}

/** 서버가 받아 적은 실행 부탁들. */
function watchStarts(): (Record<string, unknown> | undefined)[] {
  const asked: (Record<string, unknown> | undefined)[] = [];
  useEditor.setState({
    sendRunStart: async (_specId, _revision, input) => {
      asked.push(input);
      return { failure: msg("run.start.offline") };
    },
  });
  return asked;
}

beforeEach(() => {
  store().loadSpec(example);
  serveSavingServer();
});

describe("넣은 값이 서버까지 가는 길", () => {
  it("실행에 넣은 값을 서버에 그대로 넘긴다", async () => {
    const asked = watchStarts();

    await store().saveThenRun({ question: "무엇을 볼까" });

    expect(asked).toEqual([{ question: "무엇을 볼까" }]);
  });

  it("넣은 값이 없으면 아무 값도 넘기지 않는다", async () => {
    const asked = watchStarts();

    await store().saveThenRun();

    expect(asked).toEqual([undefined]);
  });
});

describe("실행에 넣을 값을 묻는 카드", () => {
  it("처음에는 닫혀 있고, 적어 둔 값도 없다", () => {
    expect(store().runInputOpen).toBe(false);
    expect(store().runInputValues).toEqual({});
  });

  it("물을 것이 있는 문서에서 실행을 누르면 아직 실행하지 않고 카드를 연다", async () => {
    const server = serveRuns(trial);

    await store().requestRun();

    expect(store().runInputOpen).toBe(true);
    expect(server.starts).toBe(0);
  });

  it("물을 것이 없는 문서에서는 카드 없이 바로 실행한다", async () => {
    store().loadSpec(askingNothing);
    serveSavingServer();
    const server = serveRuns(trial);

    await store().requestRun();
    await settle();

    expect(store().runInputOpen).toBe(false);
    expect(server.starts).toBe(1);
  });

  // 폼을 여는 버튼은 멱등하다 — 연타는 카드를 닫지 않고 카드에 손을 얹으라고 부탁한다.
  it("열려 있을 때 실행을 다시 누르면 카드는 그대로 서고 초점만 부탁한다", async () => {
    serveRuns(trial);

    await store().requestRun();
    const asked = store().runInputFocusTick;
    await store().requestRun();

    expect(store().runInputOpen).toBe(true);
    expect(store().runInputFocusTick).toBe(asked + 1);
  });

  it("카드를 처음 열 때는 초점을 따로 부탁하지 않는다 — 방금 선 카드다", async () => {
    serveRuns(trial);
    const before = store().runInputFocusTick;

    await store().requestRun();

    expect(store().runInputFocusTick).toBe(before);
  });

  it("적어 넣은 값만 서버로 간다 — 빈 칸은 값이 아니다", async () => {
    const asked = watchStarts();

    await store().requestRun();
    store().setRunInputValue("question", "무엇을 볼까");
    store().setRunInputValue("patient_context", "  ");
    await store().runWithInput();

    expect(asked).toEqual([{ question: "무엇을 볼까" }]);
  });

  it("아무것도 적지 않고 실행하면 값을 넘기지 않는다", async () => {
    const asked = watchStarts();

    await store().requestRun();
    await store().runWithInput();

    expect(asked).toEqual([undefined]);
  });

  it("실행이 시작되면 카드는 닫히고, 적은 값은 남는다", async () => {
    serveRuns(trial);

    await store().requestRun();
    store().setRunInputValue("question", "무엇을 볼까");
    await store().runWithInput();
    await settle();

    expect(store().runInputOpen).toBe(false);
    expect(store().runInputValues).toEqual({ question: "무엇을 볼까" });
  });

  // 카드가 닫히는 것은 실행이 시작됐다는 뜻이다 — 시작하지 못했으면 자리를 지킨다.
  it("저장하지 못해 실행이 시작되지 않으면 카드는 열린 채 남는다", async () => {
    serveRuns(trial);
    useEditor.setState({ sendSpec: async () => ({ failure: msg("save.offline") }) });

    await store().requestRun();
    store().setRunInputValue("question", "무엇을 볼까");
    await store().runWithInput();
    await settle();

    expect(store().runInputOpen).toBe(true);
    expect(store().runInputValues).toEqual({ question: "무엇을 볼까" });
    expect(store().runHistory).toEqual([]);
  });

  it("그만두면 실행하지 않고 값만 남는다", async () => {
    const server = serveRuns(trial);

    await store().requestRun();
    store().setRunInputValue("question", "무엇을 볼까");
    store().closeRunInput();

    expect(store().runInputOpen).toBe(false);
    expect(store().runInputValues).toEqual({ question: "무엇을 볼까" });
    expect(server.starts).toBe(0);
  });

  it("다른 문서를 열면 적어 둔 값도 그 문서의 것이었다", async () => {
    await store().requestRun();
    store().setRunInputValue("question", "무엇을 볼까");

    store().loadSpec(askingNothing);

    expect(store().runInputOpen).toBe(false);
    expect(store().runInputValues).toEqual({});
  });
});
