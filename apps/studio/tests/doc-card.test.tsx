// 좌상단 문서 카드 — 지금 무엇을 열어 두고 있는지와 파일을 다루는 길.
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import exampleSpec from "../../../examples/basic-agent/agent_spec.json";
import type { AgentSpec } from "../src/generated/agent_spec";
import { msg } from "../src/i18n/messages";
import type { RevisionHistoryOutcome } from "../src/api/specs";
import { App } from "../src/App";
import { DocCard } from "../src/shell/DocCard";
import { OpenDialog } from "../src/shell/OpenDialog";
import { useEditor } from "../src/store/editor";
import { asServerAnswer } from "./serverAnswer";
import { viewportWidth } from "./viewportWidth";

const example = exampleSpec as unknown as AgentSpec;

function specFile(content: unknown, name = "agent_spec.json") {
  return new File([JSON.stringify(content)], name, { type: "application/json" });
}

let createdBlobs: Blob[] = [];

async function openMenu() {
  render(<DocCard />);
  await userEvent.click(screen.getByRole("button", { name: /문서 메뉴/ }));
}

async function openMenuWithDialog() {
  render(
    <>
      <DocCard />
      <OpenDialog />
    </>,
  );
  await userEvent.click(screen.getByRole("button", { name: /문서 메뉴/ }));
}

beforeEach(() => {
  createdBlobs = [];
  useEditor.setState({
    spec: null,
    nodes: [],
    edges: [],
    connectionHint: null,
    pendingFile: null,
  });
  vi.stubGlobal("URL", {
    ...URL,
    createObjectURL: (blob: Blob) => {
      createdBlobs.push(blob);
      return "blob:spec";
    },
    revokeObjectURL: () => {},
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("무엇을 열어 두고 있는지", () => {
  it("열린 문서의 이름을 그대로 보여준다", () => {
    useEditor.getState().loadSpec({ ...example, name: "임상 도우미" });
    render(<DocCard />);

    expect(screen.getByText("임상 도우미")).toBeInTheDocument();
  });

  it("이름 없는 문서는 내부 이름표 대신 쉬운 말로 부른다", () => {
    // 같은 문서를 열기 목록은 '이름 없는 문서'라 부른다 — 두 화면이 다르게 부르지 않는다.
    useEditor.getState().loadSpec(example);
    render(<DocCard />);

    expect(screen.getByText("이름 없는 문서")).toBeInTheDocument();
    expect(screen.queryByText(example.id)).toBeNull();
  });

  it("이름 짓는 칸에도 내부 이름표가 새지 않는다", async () => {
    useEditor.setState({ spec: null, nodes: [], edges: [], tray: [] });
    render(<DocCard />);
    act(() => useEditor.getState().addNode("llm.agent", { x: 0, y: 0 }));
    const draftId = useEditor.getState().spec?.id ?? "";

    await userEvent.click(screen.getByRole("button", { name: /이름 바꾸기/ }));

    const field = screen.getByRole("textbox", { name: "문서 이름" });
    expect(field).toHaveValue("");
    expect(document.body.textContent).not.toContain(draftId);
  });

  it("아직 아무 파일도 열지 않았으면 새 초안이라고 말한다", () => {
    render(<DocCard />);

    expect(screen.getByText("새 초안")).toBeInTheDocument();
  });

  it("메뉴는 부를 때만 열린다", async () => {
    render(<DocCard />);
    expect(screen.queryByLabelText("파일 열기")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /문서 메뉴/ }));

    expect(screen.getByLabelText("파일 열기")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /문서 메뉴/ })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
  });

  it("다시 부르면 접힌다", async () => {
    await openMenu();

    await userEvent.click(screen.getByRole("button", { name: /문서 메뉴/ }));

    expect(screen.queryByLabelText("파일 열기")).not.toBeInTheDocument();
  });
});

// DESIGN §1 상단 레이어 — 900px 아래에서 되돌리기는 사라지지 않고 이 메뉴로 들어온다.
describe("자리가 좁으면 되돌리기가 문서 메뉴로 들어온다", () => {
  function menuItems() {
    return screen
      .getAllByRole("button")
      .filter((button) => button.className.startsWith("doc-menu__"))
      .map((button) => button.textContent);
  }

  it("넓은 화면의 메뉴에는 되돌리기가 없다 — 상단에 그대로 있기 때문이다", async () => {
    viewportWidth(1440);

    await openMenu();

    expect(screen.queryByRole("button", { name: "되돌리기" })).toBeNull();
  });

  it("좁은 화면에서는 메뉴의 첫 두 항목이 되돌리기·다시하기다", async () => {
    viewportWidth(880);

    await openMenu();

    expect(menuItems().slice(0, 2)).toEqual(["되돌리기", "다시하기"]);
  });

  it("메뉴 안에서도 같은 편집을 되돌린다", async () => {
    viewportWidth(880);
    useEditor.getState().loadSpec(example);
    act(() => useEditor.getState().addNode("llm.agent", { x: 0, y: 0 }));

    await openMenu();
    await userEvent.click(screen.getByRole("button", { name: "되돌리기" }));

    expect(useEditor.getState().nodes).toHaveLength(example.nodes.length);
  });

  // 명령을 눌러 그 항목이 잠기면 초점이 허공에 떨어진다 — 이 파일의 초점 복귀 규율과 같은 대우.
  it("되돌리고 나서 그 항목이 잠기면 손은 문서 메뉴 버튼으로 돌아온다", async () => {
    viewportWidth(880);
    useEditor.getState().loadSpec(example);
    act(() => useEditor.getState().addNode("llm.agent", { x: 0, y: 0 }));

    await openMenu();
    await userEvent.click(screen.getByRole("button", { name: "되돌리기" }));

    expect(screen.getByRole("button", { name: "되돌리기" })).toBeDisabled();
    expect(document.activeElement).not.toBe(document.body);
    expect(screen.getByRole("button", { name: /문서 메뉴/ })).toHaveFocus();
  });

  it("아직 되돌릴 것이 남아 있으면 손은 그 항목에 그대로 있다", async () => {
    viewportWidth(880);
    useEditor.getState().loadSpec(example);
    act(() => {
      useEditor.getState().addNode("llm.agent", { x: 0, y: 0 });
      useEditor.getState().addNode("llm.agent", { x: 40, y: 40 });
    });

    await openMenu();
    await userEvent.click(screen.getByRole("button", { name: "되돌리기" }));

    expect(screen.getByRole("button", { name: "되돌리기" })).toHaveFocus();
  });

  it("메뉴 안에서도 되돌릴 것이 없으면 그 까닭을 말한다", async () => {
    viewportWidth(880);
    useEditor.getState().loadSpec(example);

    await openMenu();

    expect(screen.getByRole("button", { name: "되돌리기" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "되돌리기" })).toHaveAttribute(
      "title",
      "되돌릴 편집이 없다",
    );
  });
});

describe("opening a file", () => {
  it("puts the spec from the chosen file on the canvas", async () => {
    await openMenu();

    await userEvent.upload(screen.getByLabelText("파일 열기"), specFile(example));

    expect(useEditor.getState().nodes.map((node) => node.id)).toEqual(
      example.nodes.map((node) => node.id),
    );
  });

  it("does not replace unsaved work before the user answers", async () => {
    useEditor.getState().loadSpec(example);
    useEditor.setState({ savedSpec: useEditor.getState().exportSpec() });
    act(() => useEditor.getState().addNode("llm.agent", { x: 10, y: 10 }));
    const before = useEditor.getState().exportSpec();

    await openMenuWithDialog();
    await userEvent.upload(
      screen.getByLabelText("파일 열기"),
      specFile({ ...example, id: "file-candidate" }),
    );

    const dialog = await screen.findByRole("alertdialog", { name: "파일을 열까요" });
    expect(dialog).toHaveTextContent("아직 저장하지 않은 작업이 있어요");
    expect(useEditor.getState().exportSpec()).toEqual(before);

    await userEvent.click(within(dialog).getByRole("button", { name: "돌아가기" }));

    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(useEditor.getState().exportSpec()).toEqual(before);
    expect(screen.getByRole("button", { name: /문서 메뉴/ })).toHaveFocus();
  });

  it("opens the candidate only after the user chooses to discard the work", async () => {
    useEditor.getState().loadSpec(example);
    useEditor.setState({ savedSpec: useEditor.getState().exportSpec() });
    act(() => useEditor.getState().addNode("llm.agent", { x: 10, y: 10 }));

    await openMenuWithDialog();
    await userEvent.upload(
      screen.getByLabelText("파일 열기"),
      specFile({ ...example, id: "file-candidate" }),
    );
    const dialog = await screen.findByRole("alertdialog", { name: "파일을 열까요" });

    await userEvent.click(within(dialog).getByRole("button", { name: /그냥 열기/ }));

    expect(useEditor.getState().spec?.id).toBe("file-candidate");
    expect(useEditor.getState().pendingFile).toBeNull();
    expect(useEditor.getState().savedSpec).toBeNull();
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("refuses a file that does not match the contract and says what is wrong", async () => {
    await openMenu();
    const { revision: _revision, ...broken } = example;

    await userEvent.upload(screen.getByLabelText("파일 열기"), specFile(broken));

    expect(useEditor.getState().spec).toBeNull();
    expect(await screen.findByRole("alert")).toHaveTextContent("revision");
  });

  it("refuses a file that is not JSON at all", async () => {
    await openMenu();
    const file = new File(["{ not json"], "a.json", { type: "application/json" });

    await userEvent.upload(screen.getByLabelText("파일 열기"), file);

    expect(useEditor.getState().spec).toBeNull();
    expect(await screen.findByRole("alert")).toBeInTheDocument();
  });
});

describe("문서의 판 기록", () => {
  const firstRevision = `sha256:${"b".repeat(64)}`;
  const secondRevision = `sha256:${"a".repeat(64)}`;
  const rows = [
    { version: 4, revision: firstRevision, created_at: "2026-08-02T12:31:00Z" },
    { version: 3, revision: secondRevision, created_at: "2026-08-01T12:31:00Z" },
  ];

  async function openHistory(fetchRevisions: () => Promise<RevisionHistoryOutcome>) {
    useEditor.getState().loadSpec(example);
    useEditor.setState({ fetchRevisions });
    await openMenu();
    await userEvent.click(screen.getByRole("button", { name: "판 기록" }));
  }

  it("문서가 없으면 판 기록을 열 수 없고 이유를 title로 말한다", async () => {
    await openMenu();

    const action = screen.getByRole("button", { name: "판 기록" });
    expect(action).toBeDisabled();
    expect(action).toHaveAttribute("title", "문서를 먼저 열어야 판 기록을 볼 수 있어요");
  });

  it("loading에서 rows로 바뀌고 서버 순서와 short revision만 보여준다", async () => {
    let complete: (outcome: RevisionHistoryOutcome) => void = () => {};
    const fetchRevisions = vi.fn(
      () => new Promise<RevisionHistoryOutcome>((resolve) => (complete = resolve)),
    );

    await openHistory(fetchRevisions);

    expect(screen.getByRole("status")).toHaveTextContent("판 기록을 불러오는 중이에요");
    complete({ revisions: rows });

    const list = await screen.findByRole("list");
    const renderedRows = within(list).getAllByRole("listitem");
    expect(renderedRows).toHaveLength(2);
    expect(renderedRows[0]).toHaveTextContent("4번째 판");
    expect(renderedRows[1]).toHaveTextContent("3번째 판");
    expect(renderedRows[0]).toHaveTextContent("sha256:bbbbbbbb…");
    expect(document.body.textContent).not.toContain(firstRevision);
    expect(document.body.textContent).not.toContain(secondRevision);
    expect(screen.getByText("sha256:bbbbbbbb…")).not.toHaveAttribute("title");
    expect(fetchRevisions).toHaveBeenCalledWith(example.id);
  });

  it("게시된 판의 줄에만 '게시됨' 배지가 붙는다 (읽기 표시일 뿐)", async () => {
    useEditor.setState({
      publication: {
        spec_id: example.id,
        revision: secondRevision,
        published_at: "2026-08-29T09:00:00+00:00",
      },
    });

    await openHistory(async () => ({ revisions: rows }));

    const list = await screen.findByRole("list");
    const renderedRows = within(list).getAllByRole("listitem");
    // rows[1]이 게시된 판(secondRevision) — 그 줄에만 배지가 있고 다른 줄엔 없다.
    expect(within(renderedRows[1]).getByText("게시됨")).toBeInTheDocument();
    expect(within(renderedRows[0]).queryByText("게시됨")).toBeNull();
  });

  it("빈 판 기록을 빈 상태로 말한다", async () => {
    await openHistory(async () => ({ revisions: [] }));

    expect(await screen.findByText("아직 저장된 판이 없어요")).toBeInTheDocument();
    expect(screen.queryByRole("list")).toBeNull();
  });

  it("실패 상태와 다시 해보기를 보여주고 원문을 숨긴다", async () => {
    const fetchRevisions = vi
      .fn<() => Promise<RevisionHistoryOutcome>>()
      .mockResolvedValue({ failure: msg("revisionHistory.offline") });

    await openHistory(fetchRevisions);

    expect(await screen.findByRole("alert")).toHaveTextContent("서버에 닿지 못했어요");
    await userEvent.click(screen.getByRole("button", { name: "다시 해보기" }));
    await waitFor(() => expect(fetchRevisions).toHaveBeenCalledTimes(2));
  });

  it("판 기록을 열면 메뉴는 닫힌다 — 팝오버는 한 번에 하나다 (DESIGN §7 doc-card)", async () => {
    await openHistory(async () => ({ revisions: rows }));

    expect(await screen.findByRole("heading", { name: "판 기록" })).toBeInTheDocument();
    expect(screen.queryByLabelText("파일 열기")).not.toBeInTheDocument();
  });

  it("판 기록이 열린 채 메뉴 버튼을 누르면 판 기록은 물러나고 메뉴가 선다", async () => {
    await openHistory(async () => ({ revisions: rows }));
    await screen.findByRole("heading", { name: "판 기록" });

    await userEvent.click(screen.getByRole("button", { name: /문서 메뉴/ }));

    expect(screen.getByLabelText("파일 열기")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "판 기록" })).toBeNull();
  });

  it("닫으면 문서 메뉴 버튼으로 초점이 돌아온다", async () => {
    await openHistory(async () => ({ revisions: rows }));
    await screen.findByRole("list");

    await userEvent.click(screen.getByRole("button", { name: "판 기록 닫기" }));

    expect(screen.getByRole("button", { name: /문서 메뉴/ })).toHaveFocus();
    expect(screen.queryByRole("heading", { name: "판 기록" })).toBeNull();
  });
});

// 잠깐 뜬 팝오버는 Esc로 닫힌다 — 체인보다 먼저다 (DESIGN §1 팝오버 예외, §7 doc-card).
// 어떤 길로 닫혔든 초점은 문서 메뉴 버튼으로 돌아온다 — 초점을 허공에 두지 않는다.
describe("팝오버를 Esc로 닫기", () => {
  function menuButton() {
    return screen.getByRole("button", { name: /문서 메뉴/ });
  }

  // 손이 메뉴를 떠나 캔버스에 있어도 Esc는 그 팝오버를 닫고, 손은 연 자리로 돌아온다
  // — 초점을 허공에 두지 않는다 (브리프 케이스 "메뉴 열림, 초점 캔버스").
  it("초점이 메뉴를 떠나 있어도 Esc가 메뉴를 닫고 손은 문서 메뉴 버튼으로 돌아온다", async () => {
    render(<App />);
    await userEvent.click(menuButton());
    expect(screen.getByLabelText("파일 열기")).toBeInTheDocument();
    const canvas = screen.getByRole("application", { name: /캔버스/ });
    canvas.focus();
    expect(canvas).toHaveFocus();

    await userEvent.keyboard("{Escape}");

    expect(screen.queryByLabelText("파일 열기")).not.toBeInTheDocument();
    expect(menuButton()).toHaveFocus();
  });

  it("판 기록이 열려 있으면 Esc가 판 기록을 닫고 손은 문서 메뉴 버튼으로 돌아온다", async () => {
    useEditor.getState().loadSpec(example);
    useEditor.setState({ fetchRevisions: async () => ({ revisions: [] }) });
    render(<App />);
    await userEvent.click(menuButton());
    await userEvent.click(screen.getByRole("button", { name: "판 기록" }));
    expect(await screen.findByRole("heading", { name: "판 기록" })).toBeInTheDocument();

    await userEvent.keyboard("{Escape}");

    expect(screen.queryByRole("heading", { name: "판 기록" })).toBeNull();
    expect(menuButton()).toHaveFocus();
  });
});

describe("exporting", () => {
  it("cannot export before a spec is open", async () => {
    await openMenu();

    expect(screen.getByRole("button", { name: "내보내기" })).toBeDisabled();
  });

  it("downloads the canvas as an AgentSpec JSON file", async () => {
    useEditor.getState().loadSpec(example);
    await openMenu();

    await userEvent.click(screen.getByRole("button", { name: "내보내기" }));

    expect(createdBlobs).toHaveLength(1);
    expect(JSON.parse(await createdBlobs[0].text())).toEqual(example);
  });

  it("reports schema problems instead of downloading a broken spec", async () => {
    useEditor.getState().loadSpec({ ...example, nodes: [] });
    useEditor.setState({ spec: { ...example, revision: "not-a-revision" } });
    await openMenu();

    await userEvent.click(screen.getByRole("button", { name: "내보내기" }));

    expect(createdBlobs).toHaveLength(0);
    expect(await screen.findByRole("alert")).toHaveTextContent("revision");
  });
});

describe("tidying the canvas", () => {
  it("lines the nodes up in one step", async () => {
    useEditor.getState().loadSpec(example);
    await openMenu();

    await userEvent.click(screen.getByRole("button", { name: "정리하기" }));

    expect(useEditor.getState().nodes[0].position).not.toEqual(example.nodes[0].position);
    expect(useEditor.getState().undoStack).toHaveLength(1);
  });

  it("has nothing to tidy before a file is open", async () => {
    await openMenu();

    expect(screen.getByRole("button", { name: "정리하기" })).toBeDisabled();
  });
});

// ── 저장 (CP-2) ────────────────────────────────────────────────────────────
describe("서버에 맡긴 것과 아직 맡기지 않은 것", () => {
  /** 그대로 받아 주는 서버 — 판 번호는 서버가 매긴다. */
  function acceptingServer(version = 1, issues: { message: string }[] = []) {
    return async (spec: AgentSpec) => ({
      saved: asServerAnswer({ ...spec, version }),
      issues: issues.map((issue) => ({
        severity: "error",
        code: "x",
        message: issue.message,
      })),
    });
  }

  const sleepingServer = async () => ({ failure: msg("save.offline") });

  beforeEach(() => {
    useEditor.setState({ savedSpec: null, feedbackNotice: null, saving: false });
    useEditor.getState().loadSpec(example);
  });

  it("아직 저장하지 않았다고 늘 보이는 자리에 적어 둔다", () => {
    render(<DocCard />);

    expect(screen.getByText("아직 저장 안 했어요")).toBeInTheDocument();
  });

  it("메뉴에서 저장하면 서버가 매긴 판을 적어 준다", async () => {
    useEditor.setState({ sendSpec: acceptingServer(1) });
    await openMenu();

    await userEvent.click(screen.getByRole("button", { name: "저장" }));

    expect(await screen.findByText("저장했어요 · 1번째 판")).toBeInTheDocument();
    expect(useEditor.getState().feedbackNotice?.tone).toBe("ok");
  });

  it("저장한 뒤에 고치면 저장 안 된 변경이 있다고 말한다", async () => {
    useEditor.setState({ sendSpec: acceptingServer(2) });
    await openMenu();
    await userEvent.click(screen.getByRole("button", { name: "저장" }));
    await screen.findByText("저장했어요 · 2번째 판");

    act(() => useEditor.getState().addNode("llm.agent", { x: 10, y: 10 }));

    expect(screen.getByText("저장 안 된 변경이 있어요")).toBeInTheDocument();
  });

  it("서버에 닿지 못해도 캡션은 예전 그대로다", async () => {
    useEditor.setState({ sendSpec: sleepingServer });
    await openMenu();

    await userEvent.click(screen.getByRole("button", { name: "저장" }));

    expect(await screen.findByText("아직 저장 안 했어요")).toBeInTheDocument();
    expect(useEditor.getState().feedbackNotice?.tone).toBe("danger");
    expect(useEditor.getState().nodes).toHaveLength(example.nodes.length);
  });

  it("손볼 곳이 남은 채로 저장하면 몇 곳인지 함께 말한다", async () => {
    useEditor.setState({ sendSpec: acceptingServer(1, [{ message: "무슨 노드죠" }]) });
    await openMenu();

    await userEvent.click(screen.getByRole("button", { name: "저장" }));

    await screen.findByText("저장했어요 · 1번째 판");
    expect(useEditor.getState().feedbackNotice?.tone).toBe("warn");
  });
});

// ── 문서 이름 (CP-2) ───────────────────────────────────────────────────────
describe("문서 이름을 그 자리에서 고치는 일", () => {
  beforeEach(() => {
    useEditor.setState({ savedSpec: null, feedbackNotice: null });
    useEditor.getState().loadSpec(example);
  });

  async function startRenaming() {
    render(<DocCard />);
    await userEvent.click(screen.getByRole("button", { name: /이름 바꾸기/ }));
    return screen.getByRole("textbox", { name: /문서 이름/ });
  }

  it("이름을 누르면 같은 자리에서 고칠 수 있다", async () => {
    const field = await startRenaming();

    // 아직 이름이 없는 문서라 칸은 비어 있다 — 내부 이름표를 미리 채워 두지 않는다.
    expect(field).toHaveValue("");
    expect(field).toHaveFocus();
  });

  it("Enter를 누르면 새 이름이 문서에 적힌다", async () => {
    const field = await startRenaming();

    await userEvent.clear(field);
    await userEvent.type(field, "임상 도우미{Enter}");

    expect(useEditor.getState().spec?.name).toBe("임상 도우미");
    expect(screen.getByText("임상 도우미")).toBeInTheDocument();
  });

  it("이름을 바꾼 것도 되돌릴 수 있는 편집이다", async () => {
    const field = await startRenaming();
    await userEvent.clear(field);
    await userEvent.type(field, "임상 도우미{Enter}");

    act(() => useEditor.getState().undo());

    expect(useEditor.getState().spec?.name ?? null).toBeNull();
  });

  it("이름을 바꾸면 저장 안 된 변경이 된다", async () => {
    useEditor.setState({
      sendSpec: async (spec: AgentSpec) => ({
        saved: asServerAnswer({ ...spec, version: 1 }),
        issues: [],
      }),
    });
    await act(async () => {
      await useEditor.getState().saveSpec();
    });
    const field = await startRenaming();

    await userEvent.clear(field);
    await userEvent.type(field, "임상 도우미{Enter}");

    expect(screen.getByText("저장 안 된 변경이 있어요")).toBeInTheDocument();
  });

  it("Esc를 누르면 고치던 것을 무르고 이름은 그대로다", async () => {
    const field = await startRenaming();
    await userEvent.clear(field);
    await userEvent.type(field, "다른 이름{Escape}");

    expect(useEditor.getState().spec?.name ?? null).toBeNull();
    expect(screen.getByRole("button", { name: /이름 바꾸기/ })).toBeInTheDocument();
  });

  it("빈 이름은 받지 않는다 — 있던 이름으로 돌아간다", async () => {
    const field = await startRenaming();

    await userEvent.clear(field);
    await userEvent.type(field, "   {Enter}");

    expect(useEditor.getState().spec?.name ?? null).toBeNull();
    expect(useEditor.getState().undoStack).toHaveLength(0);
    expect(screen.getByText("이름 없는 문서")).toBeInTheDocument();
  });
});

describe("맡길 것이 없거나 이미 맡기는 중일 때", () => {
  it("아직 아무 그래프도 없으면 저장을 누를 수 없고, 그 까닭을 말한다", async () => {
    useEditor.setState({ spec: null, nodes: [], edges: [], savedSpec: null });
    await openMenu();

    const save = screen.getByRole("button", { name: "저장" });
    expect(save).toBeDisabled();
    expect(save).toHaveAttribute("title", "아직 저장할 그래프가 없어요");
  });

  it("저장이 오가는 동안에는 다시 누를 수 없다", async () => {
    useEditor.getState().loadSpec(example);
    useEditor.setState({ saving: true });
    await openMenu();

    const save = screen.getByRole("button", { name: "저장" });
    expect(save).toBeDisabled();
    expect(save).toHaveAttribute("title", "저장하는 중이에요");
  });
});

describe("이름을 고치는 중에 저장하면", () => {
  it("고치던 이름을 먼저 확정하고 저장한다", async () => {
    const sent: AgentSpec[] = [];
    useEditor.getState().loadSpec(example);
    useEditor.setState({
      savedSpec: null,
      sendSpec: async (spec: AgentSpec) => {
        sent.push(spec);
        return { saved: asServerAnswer({ ...spec, version: 1 }), issues: [] };
      },
    });
    render(<App />);
    await userEvent.click(screen.getByRole("button", { name: /이름 바꾸기/ }));
    const field = screen.getByRole("textbox", { name: "문서 이름" });
    await userEvent.clear(field);
    await userEvent.type(field, "임상 도우미");

    await userEvent.keyboard("{Meta>}s{/Meta}");

    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0].name).toBe("임상 도우미");
    expect(useEditor.getState().spec?.name).toBe("임상 도우미");
  });

  it("고치던 칸에서 손을 떼면 무르고 이름은 그대로다", async () => {
    useEditor.getState().loadSpec(example);
    render(<DocCard />);
    await userEvent.click(screen.getByRole("button", { name: /이름 바꾸기/ }));
    const field = screen.getByRole("textbox", { name: "문서 이름" });
    await userEvent.clear(field);
    await userEvent.type(field, "다른 이름");

    field.blur();

    expect(useEditor.getState().spec?.name ?? null).toBeNull();
    expect(await screen.findByRole("button", { name: /이름 바꾸기/ })).toBeInTheDocument();
  });
});

// 편집이 끝나면 손은 시작한 자리로 돌아온다 — 초점이 허공에 떨어지면 키가 앱에 닿지 않는다.
describe("이름 편집이 끝난 뒤 손이 놓이는 자리", () => {
  beforeEach(() => {
    useEditor.setState({ savedSpec: null, feedbackNotice: null });
    useEditor.getState().loadSpec(example);
  });

  async function startRenaming() {
    render(<DocCard />);
    await userEvent.click(screen.getByRole("button", { name: /이름 바꾸기/ }));
    return screen.getByRole("textbox", { name: "문서 이름" });
  }

  function nameButton() {
    return screen.getByRole("button", { name: /이름 바꾸기/ });
  }

  it("Enter로 확정하면 문서명으로 돌아온다", async () => {
    const field = await startRenaming();

    await userEvent.type(field, "{Enter}");

    expect(nameButton()).toHaveFocus();
  });

  it("Esc로 무르면 문서명으로 돌아온다", async () => {
    const field = await startRenaming();

    await userEvent.type(field, "{Escape}");

    expect(nameButton()).toHaveFocus();
  });

  it("손을 떼어 무른 뒤에도 문서명으로 돌아온다", async () => {
    const field = await startRenaming();

    field.blur();

    await waitFor(() => expect(nameButton()).toHaveFocus());
  });
});

describe("문서 카드 — 게시 (CHAT-2)", () => {
  function loadSavedDoc() {
    useEditor.getState().loadSpec(example);
    const saved = useEditor.getState().exportSpec();
    useEditor.setState({
      savedSpec: saved,
      publication: null,
      publishedVersion: null,
      feedbackNotice: null,
      sendPublish: async () => ({
        publication: {
          spec_id: saved.id,
          revision: saved.revision,
          published_at: "2026-08-29T09:00:00+00:00",
        },
      }),
      sendUnpublish: async () => ({ ok: true }),
      askPublication: async () => ({ publication: null }),
    });
    return saved;
  }

  it("게시 전에는 '이 판 게시하기'가 있고 게시 표식이 없다", async () => {
    loadSavedDoc();
    await openMenu();

    expect(screen.getByText("이 판 게시하기")).toBeInTheDocument();
    expect(screen.queryByText(/게시했어요/)).toBeNull();
  });

  it("저장 안 된 변경이 있으면 게시 항목이 막히고 이유를 말한다", async () => {
    loadSavedDoc();
    useEditor.getState().renameSpec("바뀐 이름");
    await openMenu();

    const item = screen.getByText("이 판 게시하기");
    expect(item).toBeDisabled();
    expect(item).toHaveAttribute("title", "먼저 저장해야 게시할 수 있어요");
  });

  it("게시하면 표식이 뜨고 메뉴가 바꿔 게시·내리기로 바뀐다", async () => {
    loadSavedDoc();
    await openMenu();

    await userEvent.click(screen.getByText("이 판 게시하기"));

    expect(screen.getByText("지금 판을 게시했어요")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /문서 메뉴/ }));
    expect(screen.getByText("다른 판으로 바꿔 게시하기")).toBeInTheDocument();
    expect(screen.getByText("게시 내리기")).toBeInTheDocument();
  });

  it("게시 후 새 판으로 저장하면 표식이 '지금 보는 판과 달라요'로 바뀐다", async () => {
    const saved = loadSavedDoc();
    await openMenu();
    await userEvent.click(screen.getByText("이 판 게시하기"));

    // 만드는 쪽이 캔버스를 고쳐 새 판으로 저장했다 — 게시 pointer는 옛 판 그대로.
    act(() => {
      useEditor.setState({
        savedSpec: { ...saved, version: 2, revision: `sha256:${"a".repeat(64)}` },
      });
    });

    expect(
      screen.getByText("3번째 판을 게시했어요 — 지금 보는 판과 달라요"),
    ).toBeInTheDocument();
  });

  it("게시를 내리면 표식이 사라지고 메뉴가 '이 판 게시하기'로 돌아온다", async () => {
    loadSavedDoc();
    await openMenu();
    await userEvent.click(screen.getByText("이 판 게시하기"));

    await userEvent.click(screen.getByRole("button", { name: /문서 메뉴/ }));
    await userEvent.click(screen.getByText("게시 내리기"));

    expect(screen.queryByText(/게시했어요/)).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: /문서 메뉴/ }));
    expect(screen.getByText("이 판 게시하기")).toBeInTheDocument();
  });
});
