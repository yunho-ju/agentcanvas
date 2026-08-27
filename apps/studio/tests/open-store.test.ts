// 서버에 저장해 둔 문서를 다시 여는 일 — 목록을 묻고, 되묻고, 열고, 주소에 남긴다.
import { beforeEach, describe, expect, it } from "vitest";
import exampleSpec from "../../../examples/basic-agent/agent_spec.json";
import type { DocListOutcome, SaveOutcome, SavedDoc } from "../src/api/specs";
import type { AgentSpec } from "../src/generated/agent_spec";
import { msg, translate } from "../src/i18n/messages";
import { useEditor } from "../src/store/editor";
import { askingBeforeOpen, docListIsOpen, fileOpenIsAsking } from "../src/store/openSlice";
import { saveCaption, savedVersion, unsavedChanges } from "../src/store/saveSlice";
import { asServerAnswer } from "./serverAnswer";

const example = exampleSpec as unknown as AgentSpec;

function store() {
  return useEditor.getState();
}

const listed: SavedDoc[] = [
  {
    id: "clinical-assistant",
    name: "임상 도우미",
    version: 2,
    revision: `sha256:${"a".repeat(64)}`,
    saved_at: "2026-08-01T12:31:00Z",
  },
  {
    id: "draft-abc12345",
    name: null,
    version: 1,
    revision: `sha256:${"b".repeat(64)}`,
    saved_at: "2026-08-01T12:20:00Z",
  },
];

/** 목록과 문서를 내주는 서버, 그리고 무엇을 물었는지 적어 두는 수첩. */
function serverWith(documents: SavedDoc[] = listed, hasMore = false) {
  const asked: string[] = [];
  return {
    asked,
    fetchDocs: async (): Promise<DocListOutcome> => {
      asked.push("list");
      return { documents, hasMore };
    },
    fetchDoc: async (id: string): Promise<SaveOutcome> => {
      asked.push(`doc:${id}`);
      return {
        saved: asServerAnswer({ ...example, id, name: "임상 도우미", version: 5 }),
        issues: [],
      };
    },
  };
}

/** 주소창 대신 기억해 두는 자리. */
function addressBar(start: string | null = null) {
  let doc = start;
  return {
    docId: () => doc,
    remember: (id: string | null) => {
      doc = id;
    },
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((fulfill) => {
    resolve = fulfill;
  });
  return { promise, resolve };
}

beforeEach(() => {
  useEditor.setState({
    docList: null,
    pendingFile: null,
    savedSpec: null,
    feedbackNotice: null,
    saving: false,
  });
  store().loadSpec(example);
  const server = serverWith();
  useEditor.setState({
    fetchDocs: server.fetchDocs,
    fetchDoc: server.fetchDoc,
    address: addressBar(),
  });
});

describe("문서 목록을 여는 순간", () => {
  it("처음 열면 응답을 기다리는 상태를 먼저 들고 온다", async () => {
    const pending = deferred<DocListOutcome>();
    useEditor.setState({ fetchDocs: () => pending.promise });

    const opening = store().showDocList();

    expect(store().docList).toMatchObject({
      documents: null,
      loading: true,
      failure: null,
    });

    pending.resolve({ documents: listed, hasMore: false });
    await opening;

    expect(store().docList?.loading).toBe(false);
  });

  it("서버가 준 차례 그대로 목록을 들고 온다", async () => {
    await store().showDocList();

    expect(docListIsOpen(store())).toBe(true);
    expect(store().docList?.documents?.map((doc) => doc.id)).toEqual([
      "clinical-assistant",
      "draft-abc12345",
    ]);
    expect(store().docList?.loading).toBe(false);
    expect(store().docList?.failure).toBeNull();
  });

  it("뒤에 더 있다는 서버의 말을 그대로 담아 둔다", async () => {
    const cutOff = serverWith(listed, true);
    useEditor.setState({ fetchDocs: cutOff.fetchDocs });

    await store().showDocList();

    expect(store().docList?.hasMore).toBe(true);
  });

  it("아직 저장한 문서가 없으면 빈 목록으로 온다 — 실패가 아니다", async () => {
    const empty = serverWith([]);
    useEditor.setState({ fetchDocs: empty.fetchDocs });

    await store().showDocList();

    expect(store().docList?.documents).toEqual([]);
    expect(store().docList?.failure).toBeNull();
  });

  it("목록을 못 불러오면 까닭을 들고 대화상자는 열린 채로 둔다", async () => {
    useEditor.setState({
      fetchDocs: async () => ({ failure: msg("open.list.offline") }),
    });

    await store().showDocList();

    expect(docListIsOpen(store())).toBe(true);
    expect(store().docList?.documents).toBeNull();
    expect(store().docList?.loading).toBe(false);
    expect(translate("ko", store().docList!.failure!)).toContain("서버");
  });

  it("다시 해보면 다시 묻는다 — 이번에 오면 까닭은 지운다", async () => {
    useEditor.setState({
      fetchDocs: async () => ({ failure: msg("open.list.offline") }),
    });
    await store().showDocList();
    const server = serverWith();
    useEditor.setState({ fetchDocs: server.fetchDocs });

    await store().reloadDocList();

    expect(store().docList?.failure).toBeNull();
    expect(store().docList?.documents).toHaveLength(2);
    expect(store().docList?.loading).toBe(false);
  });

  it("다시 해보는 동안에는 기존 목록을 보존하고 기다림을 표시한다", async () => {
    await store().showDocList();
    const pending = deferred<DocListOutcome>();
    useEditor.setState({ fetchDocs: () => pending.promise });

    const reloading = store().reloadDocList();

    expect(store().docList).toMatchObject({
      documents: listed,
      loading: true,
      failure: null,
    });

    pending.resolve({ documents: [listed[1]], hasMore: false });
    await reloading;

    expect(store().docList?.documents).toEqual([listed[1]]);
    expect(store().docList?.loading).toBe(false);
  });

  it("닫으면 목록도 함께 접힌다", async () => {
    await store().showDocList();

    store().closeDocList();

    expect(docListIsOpen(store())).toBe(false);
    expect(store().docList).toBeNull();
  });

  it("목록을 닫은 뒤 늦게 온 응답은 다시 채우지 않는다", async () => {
    const pending = deferred<DocListOutcome>();
    useEditor.setState({ fetchDocs: () => pending.promise });

    const loading = store().showDocList();
    expect(docListIsOpen(store())).toBe(true);

    store().closeDocList();
    pending.resolve({ documents: listed, hasMore: false });
    await loading;

    expect(store().docList).toBeNull();
  });

  it("목록을 재시도하면 먼저 시작한 늦은 응답은 새 목록을 덮지 않는다", async () => {
    const first = deferred<DocListOutcome>();
    const second = deferred<DocListOutcome>();
    let calls = 0;
    useEditor.setState({
      fetchDocs: () => {
        calls += 1;
        return calls === 1 ? first.promise : second.promise;
      },
    });

    const firstLoad = store().showDocList();
    const secondLoad = store().reloadDocList();
    second.resolve({ documents: [listed[1]], hasMore: false });
    await secondLoad;
    first.resolve({ documents: listed, hasMore: false });
    await firstLoad;

    expect(store().docList?.documents?.map((doc) => doc.id)).toEqual([listed[1].id]);
  });
});

describe("목록에서 문서를 고르면", () => {
  // 지금 보는 문서는 이미 서버에 맡겨 둔 그대로다 — 잃을 것이 없으니 되묻지 않는다.
  beforeEach(() => {
    useEditor.setState({ savedSpec: store().exportSpec() });
  });

  it("그 문서가 캔버스에 열리고, 저장한 판을 그대로 말한다", async () => {
    await store().showDocList();

    await store().chooseDoc("draft-abc12345");

    expect(store().spec?.id).toBe("draft-abc12345");
    expect(savedVersion(store())).toBe(5);
    expect(unsavedChanges(store())).toBe(false);
    expect(translate("ko", saveCaption(store()))).toBe("저장했어요 · 5번째 판");
    expect(docListIsOpen(store())).toBe(false);
  });

  it("주소에 그 문서가 남는다 — 새로고침해도 같은 문서로 돌아온다", async () => {
    const address = addressBar();
    useEditor.setState({ address });
    await store().showDocList();

    await store().chooseDoc("draft-abc12345");

    expect(address.docId()).toBe("draft-abc12345");
  });

  it("보던 실행과 견주던 기록은 새 문서의 것이 아니다", async () => {
    await store().showDocList();
    useEditor.setState({ runHistory: [], compareSelection: ["a"] });

    await store().chooseDoc("draft-abc12345");

    expect(store().compareSelection).toEqual([]);
    expect(store().runEvents).toEqual([]);
  });

  it("문서를 가져오지 못하면 열지 않고 까닭을 말한다", async () => {
    useEditor.setState({ fetchDoc: async () => ({ failure: msg("open.notFound") }) });
    await store().showDocList();

    await store().chooseDoc("draft-abc12345");

    expect(docListIsOpen(store())).toBe(true);
    expect(translate("ko", store().docList!.failure!)).toContain("찾지 못했어요");
    expect(store().spec?.id).toBe(example.id);
  });

  it("문서 목록을 닫은 뒤 늦게 온 문서는 캔버스에 앉히지 않는다", async () => {
    const pending = deferred<SaveOutcome>();
    useEditor.setState({ fetchDoc: () => pending.promise });
    await store().showDocList();

    const opening = store().chooseDoc("draft-abc12345");
    store().closeDocList();
    pending.resolve({
      saved: asServerAnswer({ ...example, id: "draft-abc12345", version: 5 }),
      issues: [],
    });
    await opening;

    expect(store().spec?.id).toBe(example.id);
    expect(store().savedSpec?.id).toBe(example.id);
    expect(store().docList).toBeNull();
  });

  it("되묻기에서 그냥 열기를 누른 뒤 Esc하면 늦은 문서를 버린다", async () => {
    const pending = deferred<SaveOutcome>();
    const server = serverWith();
    useEditor.setState({ fetchDoc: () => pending.promise, fetchDocs: server.fetchDocs });
    store().addNode("llm.agent", { x: 10, y: 10 });
    await store().showDocList();
    await store().chooseDoc("draft-abc12345");

    const opening = store().openDocAnyway("draft-abc12345");
    store().cancelOpening();
    pending.resolve({
      saved: asServerAnswer({ ...example, id: "draft-abc12345", version: 5 }),
      issues: [],
    });
    await opening;

    expect(store().spec?.id).toBe(example.id);
    expect(store().docList?.asking).toBeNull();
    expect(store().docList).not.toBeNull();
  });

  it("새 문서를 다시 고르면 먼저 시작한 늦은 응답은 이기지 못한다", async () => {
    const first = deferred<SaveOutcome>();
    const second = deferred<SaveOutcome>();
    useEditor.setState({
      fetchDoc: (id: string) => (id === "first" ? first.promise : second.promise),
    });

    const openingFirst = store().openDocAnyway("first");
    const openingSecond = store().openDocAnyway("second");
    second.resolve({
      saved: asServerAnswer({ ...example, id: "second", version: 2 }),
      issues: [],
    });
    await openingSecond;
    first.resolve({
      saved: asServerAnswer({ ...example, id: "first", version: 1 }),
      issues: [],
    });
    await openingFirst;

    expect(store().spec?.id).toBe("second");
    expect(store().savedSpec?.id).toBe("second");
  });

  it("주소 복귀가 늦어도 그 사이에 연 새 문서를 덮지 않는다", async () => {
    const restoring = deferred<SaveOutcome>();
    const opened = deferred<SaveOutcome>();
    useEditor.setState({
      address: addressBar("restoring"),
      fetchDoc: (id: string) => (id === "restoring" ? restoring.promise : opened.promise),
    });

    const restoringWork = store().restoreDocFromAddress();
    const openingWork = store().openDocAnyway("opened");
    opened.resolve({
      saved: asServerAnswer({ ...example, id: "opened", version: 2 }),
      issues: [],
    });
    await openingWork;
    restoring.resolve({
      saved: asServerAnswer({ ...example, id: "restoring", version: 1 }),
      issues: [],
    });
    await restoringWork;

    expect(store().spec?.id).toBe("opened");
    expect(store().address.docId()).toBe("opened");
  });

  it("지금 보는 문서를 다시 고르면 다시 읽지 않고 대화상자만 닫는다", async () => {
    const server = serverWith();
    useEditor.setState({ fetchDocs: server.fetchDocs, fetchDoc: server.fetchDoc });
    await store().showDocList();
    useEditor.setState({ runHistory: [{ id: "run-1" }] as never });

    await store().chooseDoc(example.id);

    expect(server.asked).toEqual(["list"]);
    expect(store().runHistory).toHaveLength(1);
    expect(docListIsOpen(store())).toBe(false);
  });

  it("지금 보는 문서라도 저장하지 않은 작업이 있으면 최신 판을 열지 되묻는다", async () => {
    const server = serverWith();
    useEditor.setState({ fetchDocs: server.fetchDocs, fetchDoc: server.fetchDoc });
    store().addNode("llm.agent", { x: 10, y: 10 });
    await store().showDocList();

    await store().chooseDoc(example.id);

    expect(askingBeforeOpen(store())).toBe(example.id);
    expect(server.asked).toEqual(["list"]);
    expect(docListIsOpen(store())).toBe(true);
  });
});

describe("한 번도 저장하지 않은 채로 다른 문서를 열려 하면", () => {
  it("만든 것이 있으면 되묻는다 — 말없이 버리지 않는다", async () => {
    const server = serverWith();
    useEditor.setState({ spec: null, nodes: [], edges: [], tray: [], savedSpec: null });
    useEditor.setState({ fetchDocs: server.fetchDocs, fetchDoc: server.fetchDoc });
    store().addNode("llm.agent", { x: 0, y: 0 });
    await store().showDocList();

    await store().chooseDoc("draft-abc12345");

    expect(askingBeforeOpen(store())).toBe("draft-abc12345");
    expect(server.asked).toEqual(["list"]);
    expect(store().nodes).toHaveLength(1);
  });

  it("파일로 열어 둔 그래프도 저장 전이면 되묻는다", async () => {
    useEditor.setState({ savedSpec: null });
    await store().showDocList();

    await store().chooseDoc("draft-abc12345");

    expect(askingBeforeOpen(store())).toBe("draft-abc12345");
    expect(store().spec?.id).toBe(example.id);
  });

  it("빈 캔버스에는 버릴 것이 없다 — 곧바로 연다", async () => {
    useEditor.setState({ spec: null, nodes: [], edges: [], tray: [], savedSpec: null });
    await store().showDocList();

    await store().chooseDoc("draft-abc12345");

    expect(askingBeforeOpen(store())).toBeNull();
    expect(store().spec?.id).toBe("draft-abc12345");
  });
});

describe("파일을 열 때 저장하지 않은 작업을 지키는 일", () => {
  const candidate = { ...example, id: "file-candidate" };

  it("깨끗한 캔버스에서는 파일을 곧바로 연다", () => {
    useEditor.setState({ savedSpec: store().exportSpec() });

    store().requestFileOpen(candidate);

    expect(store().spec?.id).toBe(candidate.id);
    expect(fileOpenIsAsking(store())).toBe(false);
    expect(store().savedSpec).toBeNull();
  });

  it("저장하지 않은 캔버스에서는 파일을 후보로만 둔다", () => {
    store().requestFileOpen(candidate);

    expect(store().spec?.id).toBe(example.id);
    expect(store().pendingFile).toEqual(candidate);
    expect(fileOpenIsAsking(store())).toBe(true);
  });

  it("그냥 열기를 고르면 후보를 적용하고 되묻기를 닫는다", () => {
    store().requestFileOpen(candidate);

    store().openFileAnyway();

    expect(store().spec?.id).toBe(candidate.id);
    expect(store().pendingFile).toBeNull();
    expect(store().savedSpec).toBeNull();
  });

  it("돌아가기를 고르면 현재 캔버스와 후보를 그대로 지킨다", () => {
    store().requestFileOpen(candidate);

    store().cancelFileOpen();

    expect(store().spec?.id).toBe(example.id);
    expect(store().pendingFile).toBeNull();
  });

  it("저장하고 열기는 저장이 성공한 뒤에만 후보를 적용한다", async () => {
    useEditor.setState({
      sendSpec: async (spec: AgentSpec) => ({
        saved: asServerAnswer({ ...spec, version: 9 }),
        issues: [],
      }),
    });
    store().requestFileOpen(candidate);

    await store().saveThenOpenFile();

    expect(store().spec?.id).toBe(candidate.id);
    expect(store().pendingFile).toBeNull();
  });

  it("저장에 실패하면 현재 캔버스와 후보를 지킨다", async () => {
    useEditor.setState({ sendSpec: async () => ({ failure: msg("save.offline") }) });
    store().requestFileOpen(candidate);

    await store().saveThenOpenFile();

    expect(store().spec?.id).toBe(example.id);
    expect(store().pendingFile).toEqual(candidate);
  });

  it("저장 중 되묻기를 취소하면 늦은 저장 뒤에도 후보를 적용하지 않는다", async () => {
    const saving = deferred<SaveOutcome>();
    useEditor.setState({ sendSpec: () => saving.promise });
    store().requestFileOpen(candidate);

    const opening = store().saveThenOpenFile();
    store().cancelFileOpen();
    saving.resolve({ saved: asServerAnswer({ ...example, version: 9 }), issues: [] });
    await opening;

    expect(store().spec?.id).toBe(example.id);
    expect(store().pendingFile).toBeNull();
  });
});

describe("저장하지 않은 작업이 있는데 다른 문서를 열려 하면", () => {
  beforeEach(async () => {
    useEditor.setState({
      sendSpec: async (spec: AgentSpec) => ({
        saved: asServerAnswer({ ...spec, version: 9 }),
        issues: [],
      }),
    });
    // 저장한 적이 있고, 그 뒤로 손댔다.
    await store().saveSpec();
    store().addNode("llm.agent", { x: 10, y: 10 });
    await store().showDocList();
  });

  it("바로 열지 않고 같은 카드 안에서 되묻는다", async () => {
    const server = serverWith();
    useEditor.setState({ fetchDoc: server.fetchDoc });

    await store().chooseDoc("draft-abc12345");

    expect(askingBeforeOpen(store())).toBe("draft-abc12345");
    expect(server.asked).toEqual([]);
    expect(docListIsOpen(store())).toBe(true);
  });

  it("돌아가기를 고르면 묻던 것만 물러난다", async () => {
    await store().chooseDoc("draft-abc12345");

    store().cancelOpening();

    expect(askingBeforeOpen(store())).toBeNull();
    expect(docListIsOpen(store())).toBe(true);
  });

  it("그냥 열기를 고르면 저장하지 않고 연다", async () => {
    await store().chooseDoc("draft-abc12345");

    await store().openDocAnyway("draft-abc12345");

    expect(store().spec?.id).toBe("draft-abc12345");
    expect(docListIsOpen(store())).toBe(false);
  });

  it("같은 문서의 최신 판을 그냥 열기로 고르면 서버에서 다시 읽는다", async () => {
    const server = serverWith();
    useEditor.setState({ fetchDoc: server.fetchDoc });
    await store().chooseDoc(example.id);

    await store().openDocAnyway(example.id);

    expect(server.asked).toEqual(["doc:clinical-assistant"]);
    expect(store().spec?.name).toBe("임상 도우미");
    expect(savedVersion(store())).toBe(5);
    expect(docListIsOpen(store())).toBe(false);
  });

  it("저장하고 열기는 저장이 된 뒤에만 연다", async () => {
    await store().chooseDoc("draft-abc12345");

    await store().saveThenOpenDoc("draft-abc12345");

    expect(store().spec?.id).toBe("draft-abc12345");
    expect(docListIsOpen(store())).toBe(false);
  });

  it("저장하지 못하면 열지 않고 그 까닭을 말한다", async () => {
    useEditor.setState({ sendSpec: async () => ({ failure: msg("save.offline") }) });
    await store().chooseDoc("draft-abc12345");

    await store().saveThenOpenDoc("draft-abc12345");

    expect(store().spec?.id).toBe(example.id);
    expect(docListIsOpen(store())).toBe(true);
    expect(askingBeforeOpen(store())).toBe("draft-abc12345");
    expect(store().feedbackNotice?.tone).toBe("danger");
  });

  it("저장 후 열기 중 되묻기를 취소하면 문서 GET을 시작하지 않는다", async () => {
    const saving = deferred<SaveOutcome>();
    let fetchCount = 0;
    useEditor.setState({
      sendSpec: () => saving.promise,
      fetchDoc: async () => {
        fetchCount += 1;
        return {
          saved: asServerAnswer({ ...example, id: "draft-abc12345", version: 5 }),
          issues: [],
        };
      },
    });

    await store().chooseDoc("draft-abc12345");
    const opening = store().saveThenOpenDoc("draft-abc12345");
    store().cancelOpening();
    saving.resolve({ saved: asServerAnswer({ ...example, version: 9 }), issues: [] });
    await opening;

    expect(fetchCount).toBe(0);
    expect(store().spec?.id).toBe(example.id);
    expect(store().docList?.asking).toBeNull();
  });
});

describe("주소에 적힌 문서로 돌아오는 일", () => {
  it("같은 주소 복귀가 겹치면 pending GET 하나를 공유하고 한 번만 앉힌다", async () => {
    const pending = deferred<SaveOutcome>();
    let fetchCount = 0;
    const remembered: (string | null)[] = [];
    useEditor.setState({
      spec: null,
      nodes: [],
      edges: [],
      tray: [],
      savedSpec: null,
      address: {
        docId: () => "clinical-assistant",
        remember: (id: string | null) => remembered.push(id),
      },
      fetchDoc: () => {
        fetchCount += 1;
        return pending.promise;
      },
    });

    const first = store().restoreDocFromAddress();
    const second = store().restoreDocFromAddress();

    expect(fetchCount).toBe(1);
    pending.resolve({
      saved: asServerAnswer({ ...example, id: "clinical-assistant", version: 5 }),
      issues: [],
    });
    await Promise.all([first, second]);

    expect(fetchCount).toBe(1);
    expect(remembered).toEqual(["clinical-assistant"]);
    expect(store().spec?.id).toBe("clinical-assistant");
  });

  it("주소가 A에서 B로 바뀌면 GET을 합치지 않고 최신 세대만 앉힌다", async () => {
    const first = deferred<SaveOutcome>();
    const second = deferred<SaveOutcome>();
    let currentId: string | null = "first";
    const requested: string[] = [];
    useEditor.setState({
      spec: null,
      nodes: [],
      edges: [],
      tray: [],
      savedSpec: null,
      address: {
        docId: () => currentId,
        remember: (id: string | null) => {
          currentId = id;
        },
      },
      fetchDoc: (id: string) => {
        requested.push(id);
        return id === "first" ? first.promise : second.promise;
      },
    });

    const openingFirst = store().restoreDocFromAddress();
    currentId = "second";
    const openingSecond = store().restoreDocFromAddress();

    expect(requested).toEqual(["first", "second"]);
    second.resolve({
      saved: asServerAnswer({ ...example, id: "second", version: 2 }),
      issues: [],
    });
    await openingSecond;
    first.resolve({
      saved: asServerAnswer({ ...example, id: "first", version: 1 }),
      issues: [],
    });
    await openingFirst;

    expect(store().spec?.id).toBe("second");
    expect(currentId).toBe("second");
  });

  it("settle 뒤 같은 주소를 다시 복귀하면 새 GET을 만든다", async () => {
    let fetchCount = 0;
    const address = addressBar("clinical-assistant");
    useEditor.setState({
      address,
      fetchDoc: async () => {
        fetchCount += 1;
        return {
          saved: asServerAnswer({ ...example, id: "clinical-assistant", version: fetchCount }),
          issues: [],
        };
      },
    });

    await store().restoreDocFromAddress();
    await store().restoreDocFromAddress();

    expect(fetchCount).toBe(2);
  });

  it("실패한 pending도 settle 뒤 retry에서 새 GET을 만든다", async () => {
    let fetchCount = 0;
    const address = addressBar("nowhere");
    useEditor.setState({
      address,
      fetchDoc: async () => {
        fetchCount += 1;
        return { failure: msg("open.notFound") };
      },
    });

    await store().restoreDocFromAddress();
    address.remember("nowhere");
    await store().restoreDocFromAddress();

    expect(fetchCount).toBe(2);
  });

  it("저장한 문서도 주소에 남는다 — 새로고침하면 방금 저장한 것으로 돌아온다", async () => {
    const address = addressBar();
    useEditor.setState({
      address,
      sendSpec: async (spec: AgentSpec) => ({
        saved: asServerAnswer({ ...spec, version: 1 }),
        issues: [],
      }),
    });

    await store().saveSpec();

    expect(address.docId()).toBe(example.id);
  });

  it("저장하지 못했으면 주소에 아무것도 적지 않는다", async () => {
    const address = addressBar();
    useEditor.setState({
      address,
      sendSpec: async () => ({ failure: msg("save.offline") }),
    });

    await store().saveSpec();

    expect(address.docId()).toBeNull();
  });

  it("주소가 가리키는 문서를 다시 연다", async () => {
    useEditor.setState({ address: addressBar("clinical-assistant") });
    useEditor.setState({ spec: null, nodes: [], edges: [], savedSpec: null });

    await store().restoreDocFromAddress();

    expect(store().spec?.id).toBe("clinical-assistant");
    expect(translate("ko", saveCaption(store()))).toBe("저장했어요 · 5번째 판");
  });

  it("주소에 아무 문서도 없으면 서버에 묻지 않는다", async () => {
    const server = serverWith();
    useEditor.setState({ fetchDoc: server.fetchDoc, address: addressBar(null) });

    await store().restoreDocFromAddress();

    expect(server.asked).toEqual([]);
  });

  it("모르는 문서를 가리키면 빈 초안으로 시작하고 한 번 알린다", async () => {
    const address = addressBar("nowhere");
    useEditor.setState({
      address,
      fetchDoc: async () => ({ failure: msg("open.notFound") }),
    });
    useEditor.setState({ spec: null, nodes: [], edges: [], savedSpec: null });

    await store().restoreDocFromAddress();

    expect(store().spec).toBeNull();
    expect(translate("ko", store().feedbackNotice!.message)).toContain("찾지 못했어요");
    expect(store().feedbackNotice?.tone).toBe("danger");
    // 없는 문서를 가리키는 주소는 정리한다 — 새로고침마다 같은 말을 되풀이하지 않는다.
    expect(address.docId()).toBeNull();
  });
});
