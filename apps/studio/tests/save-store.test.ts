// 저장은 서버의 일이고, 화면은 그 결과만 안다 — 무엇이 저장됐고 무엇이 아직 아닌가.
import { beforeEach, describe, expect, it } from "vitest";
import exampleSpec from "../../../examples/basic-agent/agent_spec.json";
import type { SaveOutcome } from "../src/api/specs";
import type { AgentSpec } from "../src/generated/agent_spec";
import { msg, translate } from "../src/i18n/messages";
import { useEditor } from "../src/store/editor";
import { saveCaption, savedVersion, unsavedChanges } from "../src/store/saveSlice";
import { asServerAnswer } from "./serverAnswer";

const example = exampleSpec as unknown as AgentSpec;

function store() {
  return useEditor.getState();
}

/** 서버가 그대로 받아 주는 자리 — 판 번호와 revision은 서버가 매긴다. */
function acceptingServer(version = 1, issues: SaveOutcome["issues"] = []) {
  const sent: AgentSpec[] = [];
  return {
    sent,
    send: async (spec: AgentSpec): Promise<SaveOutcome> => {
      sent.push(spec);
      return {
        saved: asServerAnswer({
          ...spec,
          version,
          revision: `sha256:${String(version).repeat(64).slice(0, 64)}`,
        }),
        issues,
      };
    },
  };
}

/** 꺼져 있는 서버. */
const sleepingServer = async (): Promise<SaveOutcome> => ({
  failure: msg("save.offline"),
});

function said(): string {
  const notice = store().feedbackNotice;
  return notice ? translate("ko", notice.message) : "";
}

beforeEach(() => {
  useEditor.setState({ savedSpec: null, feedbackNotice: null, saving: false });
  store().loadSpec(example);
});

describe("아직 아무것도 저장하지 않았을 때", () => {
  it("저장한 판이 없다고 말한다", () => {
    expect(savedVersion(store())).toBeNull();
    expect(translate("ko", saveCaption(store()))).toBe("아직 저장 안 했어요");
  });

  it("저장한 적이 없으면 '저장 안 된 변경'이라 말하지 않는다", () => {
    expect(unsavedChanges(store())).toBe(false);
  });
});

// 서버로 나가는 문에 "이 문서는 이미 서버에 있다"는 사실을 함께 건넨다 (UXQ-8c).
describe("이 문서가 서버에 있는 줄 아는가", () => {
  /** 저장 문이 무엇을 알고 나갔는지 받아 적는 자리. */
  function watchingServer() {
    const knew: boolean[] = [];
    const server = acceptingServer(1);
    return {
      knew,
      send: (spec: AgentSpec, knownOnServer: boolean) => {
        knew.push(knownOnServer);
        return server.send(spec);
      },
    };
  }

  it("한 번도 맡기지 않은 초안은 아직 서버의 것이 아니다", async () => {
    const server = watchingServer();
    useEditor.setState({ sendSpec: server.send });

    await store().saveSpec();

    expect(server.knew).toEqual([false]);
  });

  it("한 번 맡긴 뒤로는 서버에 있는 문서다", async () => {
    const server = watchingServer();
    useEditor.setState({ sendSpec: server.send });

    await store().saveSpec();
    await store().saveSpec();

    expect(server.knew).toEqual([false, true]);
  });

  it("다른 그래프를 열면 그 기억도 앞 문서의 것이었다", async () => {
    const server = watchingServer();
    useEditor.setState({ sendSpec: server.send });
    await store().saveSpec();

    store().loadSpec(example);
    await store().saveSpec();

    expect(server.knew).toEqual([false, false]);
  });
});

describe("저장하는 순간", () => {
  it("서버가 매긴 판 번호를 화면이 그대로 말한다", async () => {
    useEditor.setState({ sendSpec: acceptingServer(1).send });

    await store().saveSpec();

    expect(savedVersion(store())).toBe(1);
    expect(translate("ko", saveCaption(store()))).toBe("저장했어요 · 1번째 판");
    expect(said()).toBe("저장했어요");
    expect(store().feedbackNotice?.tone).toBe("ok");
  });

  it("서버가 준 그래프를 지금의 그래프로 삼는다 — revision도 서버의 것이다", async () => {
    const server = acceptingServer(2);
    useEditor.setState({ sendSpec: server.send });

    await store().saveSpec();

    expect(store().spec?.revision).toBe(`sha256:${"2".repeat(64)}`);
    expect(store().spec?.version).toBe(2);
    expect(server.sent).toHaveLength(1);
  });

  it("손볼 곳이 있어도 저장은 되고, 몇 곳인지 함께 말한다", async () => {
    const issues = [
      { severity: "error", code: "node.unknown_type", message: "무슨 노드죠" },
      { severity: "warning", code: "graph.unreachable", message: "닿지 않아요" },
    ];
    useEditor.setState({ sendSpec: acceptingServer(1, issues).send });

    await store().saveSpec();

    expect(said()).toBe("저장했어요 — 손볼 곳 2곳");
    expect(store().feedbackNotice?.tone).toBe("warn");
    expect(savedVersion(store())).toBe(1);
  });

  it("알아 두면 좋은 이야기(info)는 손볼 곳으로 세지 않는다", async () => {
    // 아무도 안 입은 skill 같은 이야기는 잘못이 아니다 — 저장을 경고로 물들이지 않는다.
    const issues = [
      { severity: "info", code: "skill.unused", message: "아무도 안 입었어요" },
    ];
    useEditor.setState({ sendSpec: acceptingServer(1, issues).send });

    await store().saveSpec();

    expect(said()).toBe("저장했어요");
    expect(store().feedbackNotice?.tone).toBe("ok");
  });

  // 같은 skill이 두 번 든 문서는 잘못이다 (validator skill.duplicate, ERROR) — 세어 말한다.
  it("같은 skill을 두 번 든 문서는 손볼 곳으로 센다", async () => {
    const issues = [
      { severity: "error", code: "skill.duplicate", message: "두 번 들었어요" },
    ];
    useEditor.setState({ sendSpec: acceptingServer(1, issues).send });

    await store().saveSpec();

    expect(said()).toBe("저장했어요 — 손볼 곳 1곳");
    expect(store().feedbackNotice?.tone).toBe("warn");
  });

  it("손볼 곳과 알아 둘 곳이 섞이면 손볼 곳만 센다", async () => {
    const issues = [
      { severity: "error", code: "node.unknown_type", message: "무슨 노드죠" },
      { severity: "info", code: "skill.unused", message: "아무도 안 입었어요" },
    ];
    useEditor.setState({ sendSpec: acceptingServer(1, issues).send });

    await store().saveSpec();

    expect(said()).toBe("저장했어요 — 손볼 곳 1곳");
  });

  it("서버가 꺼져 있으면 그 사실을 말하고, 편집한 것은 그대로 둔다", async () => {
    useEditor.setState({ sendSpec: sleepingServer });
    const before = store().nodes.length;

    await store().saveSpec();

    expect(store().feedbackNotice?.tone).toBe("danger");
    expect(said()).toContain("서버");
    expect(store().nodes).toHaveLength(before);
    expect(savedVersion(store())).toBeNull();
    expect(translate("ko", saveCaption(store()))).toBe("아직 저장 안 했어요");
  });

  it("다른 변경이 먼저 저장되면 로컬 작업과 이전 저장 판을 그대로 둔다", async () => {
    useEditor.setState({ sendSpec: acceptingServer(1).send });
    await store().saveSpec();
    const savedBefore = store().savedSpec;
    const nodesBefore = store().nodes.length;
    store().addNode("llm.agent", { x: 10, y: 10 });
    useEditor.setState({ sendSpec: async () => ({ failure: msg("save.conflict") }) });

    const turn = await store().saveSpec();

    expect(turn).toBe("failed");
    expect(store().feedbackNotice?.message.key).toBe("save.conflict");
    expect(store().feedbackNotice?.tone).toBe("danger");
    expect(store().savedSpec).toBe(savedBefore);
    expect(store().nodes.length).toBeGreaterThan(nodesBefore);
    expect(translate("ko", saveCaption(store()))).toBe("저장 안 된 변경이 있어요");
  });

  it("저장하는 동안에는 저장하는 중이라고 말한다", async () => {
    let release: (() => void) | undefined;
    useEditor.setState({
      sendSpec: async (spec) => {
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return { saved: asServerAnswer({ ...spec, version: 1 }), issues: [] };
      },
    });

    const saving = store().saveSpec();
    expect(store().saving).toBe(true);
    release?.();
    await saving;

    expect(store().saving).toBe(false);
  });
});

describe("저장한 뒤에 손댔는가", () => {
  beforeEach(async () => {
    useEditor.setState({ sendSpec: acceptingServer(1).send });
    await store().saveSpec();
  });

  it("아무것도 고치지 않았으면 저장한 그대로다", () => {
    expect(unsavedChanges(store())).toBe(false);
    expect(translate("ko", saveCaption(store()))).toBe("저장했어요 · 1번째 판");
  });

  it("한 곳이라도 고치면 저장 안 된 변경이 있다고 말한다", () => {
    store().addNode("llm.agent", { x: 10, y: 10 });

    expect(unsavedChanges(store())).toBe(true);
    expect(translate("ko", saveCaption(store()))).toBe("저장 안 된 변경이 있어요");
  });

  it("되돌리기도 편집이다 — 되돌린 뒤에도 달라진 것이 있으면 그렇게 말한다", () => {
    store().addNode("llm.agent", { x: 10, y: 10 });
    store().addNode("llm.agent", { x: 20, y: 20 });

    store().undo();

    expect(unsavedChanges(store())).toBe(true);
  });

  it("다시 저장하면 서버가 매긴 다음 판을 말한다", async () => {
    store().addNode("llm.agent", { x: 10, y: 10 });
    useEditor.setState({ sendSpec: acceptingServer(2).send });

    await store().saveSpec();

    expect(translate("ko", saveCaption(store()))).toBe("저장했어요 · 2번째 판");
    expect(unsavedChanges(store())).toBe(false);
  });

  it("다른 그래프를 열면 저장한 기억도 그 그래프의 것이 아니다", () => {
    store().loadSpec(example);

    expect(savedVersion(store())).toBeNull();
    expect(store().feedbackNotice).toBeNull();
  });
});

describe("서버의 말투와 화면의 말투가 다를 때", () => {
  it("저장하자마자 '달라졌다'고 말하지 않는다 — 같은 말로 옮겨 견준다", async () => {
    useEditor.setState({ sendSpec: acceptingServer(1).send });

    await store().saveSpec();

    // 서버는 조건 없는 연결에도 condition: null을 달아 보낸다. 그 차이는 변경이 아니다.
    const plain = store().savedSpec?.edges.find((edge) => edge.id === "input-triage");
    expect(plain && "condition" in plain).toBe(false);
    expect(unsavedChanges(store())).toBe(false);
  });

  it("서버가 매긴 판·revision·이름은 옮기는 동안에도 그대로다", async () => {
    useEditor.setState({ sendSpec: acceptingServer(3).send });

    await store().saveSpec();

    expect(store().savedSpec?.version).toBe(3);
    expect(store().savedSpec?.revision).toBe(`sha256:${"3".repeat(64)}`);
    expect(store().spec?.revision).toBe(`sha256:${"3".repeat(64)}`);
  });
});

describe("아직 아무 그래프도 열지 않았을 때", () => {
  beforeEach(() => {
    useEditor.setState({ spec: null, nodes: [], edges: [], tray: [], savedSpec: null });
  });

  it("저장할 것이 없으면 서버를 부르지 않는다 — 빈 그래프로 남의 문서를 덮지 않는다", async () => {
    const server = acceptingServer(1);
    useEditor.setState({ sendSpec: server.send });

    const turn = await store().saveSpec();

    expect(server.sent).toEqual([]);
    expect(turn).toBe("blocked");
    expect(store().feedbackNotice?.message.key).toBe("save.none");
    expect(store().spec).toBeNull();
    expect(savedVersion(store())).toBeNull();
  });

  it("빈 캔버스는 저장한 뒤에도 빈 캔버스다 — 문서가 저절로 열리지 않는다", async () => {
    useEditor.setState({ sendSpec: acceptingServer(1).send });

    await store().saveSpec();

    expect(store().spec).toBeNull();
    expect(store().nodes).toEqual([]);
  });
});

describe("같은 내용인데 적힌 모양만 다를 때", () => {
  it("이름 없는 문서를 고쳤다 되돌리면 저장한 그대로다", async () => {
    useEditor.setState({ sendSpec: acceptingServer(1).send });
    await store().saveSpec();

    store().addNode("llm.agent", { x: 10, y: 10 });
    store().undo();

    expect(store().spec?.name ?? null).toBeNull();
    expect(unsavedChanges(store())).toBe(false);
    expect(translate("ko", saveCaption(store()))).toBe("저장했어요 · 1번째 판");
  });

  it("손으로 쓴 파일을 열어 그대로 저장하면 저장한 그대로다", async () => {
    // 사람이 적은 JSON은 계약 모델과 키 순서가 다를 수 있다 — 순서는 내용이 아니다.
    const handWritten = {
      ...example,
      nodes: example.nodes.map((node) => ({
        config: node.config,
        position: node.position,
        type: node.type,
        id: node.id,
      })),
    } as AgentSpec;
    store().loadSpec(handWritten);
    useEditor.setState({ sendSpec: acceptingServer(1).send });

    await store().saveSpec();

    expect(unsavedChanges(store())).toBe(false);
    expect(translate("ko", saveCaption(store()))).toBe("저장했어요 · 1번째 판");
  });
});

describe("이름 칸은 늘 자리를 지킨다", () => {
  it("이름 없는 문서를 고쳐도 이름 칸이 사라지지 않는다 — 서버도 늘 그 자리를 적어 보낸다", () => {
    store().addNode("llm.agent", { x: 10, y: 10 });

    expect("name" in store().exportSpec()).toBe(true);
    expect(store().exportSpec().name ?? null).toBeNull();
  });

  it("이름을 바꿨다 되돌리면 부르던 이름으로 돌아온다", () => {
    store().renameSpec("임상 도우미");
    expect(store().exportSpec().name).toBe("임상 도우미");

    store().undo();

    expect("name" in store().exportSpec()).toBe(true);
    expect(store().exportSpec().name ?? null).toBeNull();
  });
});
