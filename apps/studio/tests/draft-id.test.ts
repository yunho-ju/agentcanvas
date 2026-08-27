// 새 초안은 저마다 제 이름을 갖는다 — 이름이 같으면 두 번째 초안이 첫 번째를 덮어쓴다.
import { beforeEach, describe, expect, it } from "vitest";
import type { SaveOutcome } from "../src/api/specs";
import { newDraftSpec, randomDraftId } from "../src/graph/draft";
import type { AgentSpec } from "../src/generated/agent_spec";
import { useEditor } from "../src/store/editor";
import { asServerAnswer } from "./serverAnswer";

function store() {
  return useEditor.getState();
}

/** 서버가 하는 일을 그대로 흉내 내는 자리 — 처음 보는 이름이면 새로 만들고, 아는 이름이면 고친다. */
function serverThatKeeps() {
  const documents = new Map<string, AgentSpec>();
  return {
    documents,
    send: async (spec: AgentSpec): Promise<SaveOutcome> => {
      const version = (documents.get(spec.id)?.version ?? 0) + 1;
      const saved = asServerAnswer({ ...spec, version });
      documents.set(spec.id, saved);
      return { saved, issues: [] };
    },
  };
}

/** 미리 정해 둔 이름을 차례로 내주는 이름표 발행기 — 무작위는 시험 밖의 일이다. */
function idsInTurn(names: string[]): () => string {
  let next = 0;
  return () => names[next++] ?? "draft-none-left";
}

function emptyCanvas() {
  useEditor.setState({
    spec: null,
    nodes: [],
    edges: [],
    tray: [],
    savedSpec: null,
    feedbackNotice: null,
    saving: false,
  });
}

beforeEach(emptyCanvas);

describe("초안에 이름을 붙이는 일", () => {
  it("이름은 밖에서 지어 준다 — 초안을 짓는 일 자체는 무작위를 모른다", () => {
    expect(newDraftSpec(() => "draft-abc123").id).toBe("draft-abc123");
  });

  it("이름표 발행기는 부를 때마다 다른 이름을 내준다", () => {
    const names = new Set(Array.from({ length: 50 }, randomDraftId));

    expect(names.size).toBe(50);
    expect([...names].every((name) => name.startsWith("draft-"))).toBe(true);
  });
});

describe("초안을 둘 만들어 각각 저장하면", () => {
  it("서버에 문서가 둘 생긴다 — 나중 것이 앞 것을 덮지 않는다", async () => {
    const server = serverThatKeeps();
    useEditor.setState({
      sendSpec: server.send,
      makeDraftId: idsInTurn(["draft-first", "draft-second"]),
    });

    store().addNode("llm.agent", { x: 0, y: 0 });
    await store().saveSpec();
    // 새로 시작한다 — 앞의 초안은 서버에 두고 온다.
    emptyCanvas();
    store().addNode("llm.agent", { x: 40, y: 40 });
    await store().saveSpec();

    expect([...server.documents.keys()]).toEqual(["draft-first", "draft-second"]);
    expect(server.documents.get("draft-first")?.version).toBe(1);
    expect(server.documents.get("draft-second")?.version).toBe(1);
  });

  it("이어 붙이며 만든 초안도 제 이름을 받는다", () => {
    useEditor.setState({ makeDraftId: idsInTurn(["draft-picked"]) });

    store().openPicker({ at: { x: 0, y: 0 }, screen: { x: 0, y: 0 }, from: null });
    store().addPickedNode("llm.agent");

    expect(store().spec?.id).toBe("draft-picked");
  });
});
