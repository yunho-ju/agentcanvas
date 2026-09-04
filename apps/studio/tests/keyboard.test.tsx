import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import exampleSpec from "../../../examples/basic-agent/agent_spec.json";
import { App } from "../src/App";
import {
  type ShortcutContext,
  findShortcut,
  shortcutName,
} from "../src/canvas/shortcuts";
import type { AgentSpec } from "../src/generated/agent_spec";
import { type EditorState, selectedNode, useEditor } from "../src/store/editor";
import { asServerAnswer } from "./serverAnswer";
import { currentSeq, isRunning } from "../src/store/runSlice";
import { runOnServer } from "./fakeRunServer";

const example = exampleSpec as unknown as AgentSpec;

function store() {
  return useEditor.getState();
}

async function focusCanvas() {
  const canvas = screen.getByRole("application", { name: /캔버스/ });
  canvas.focus();
  return canvas;
}

beforeEach(() => {
  window.history.replaceState(null, "", window.location.pathname);
  store().loadSpec(example);
});

describe("초점이 멈추는 자리", () => {
  it("카드 하나에 한 번만 멈춘다 — 설명을 여는 카드가 그 자리다", () => {
    const { container } = render(<App />);
    const wrapper = container.querySelector(".react-flow__node");

    expect(wrapper).not.toHaveAttribute("tabindex");
    expect(wrapper?.querySelector(".node-card")).toHaveAttribute("tabindex", "0");
  });
});

describe("moving between nodes with the keyboard", () => {
  it("selects the first node when the user presses an arrow key", async () => {
    render(<App />);
    await focusCanvas();

    await userEvent.keyboard("{ArrowDown}");

    expect(selectedNode(store())?.id).toBe(example.nodes[0].id);
  });

  it("walks forward and back through the nodes", async () => {
    render(<App />);
    await focusCanvas();

    await userEvent.keyboard("{ArrowDown}{ArrowDown}");
    expect(selectedNode(store())?.id).toBe(example.nodes[1].id);

    await userEvent.keyboard("{ArrowUp}");
    expect(selectedNode(store())?.id).toBe(example.nodes[0].id);
  });

  it("walks with Tab once a node is selected", async () => {
    render(<App />);
    await focusCanvas();

    await userEvent.keyboard("{ArrowRight}");
    await userEvent.keyboard("{Tab}");

    expect(selectedNode(store())?.id).toBe(example.nodes[1].id);
  });

  it("lets go of the selection on Escape", async () => {
    render(<App />);
    await focusCanvas();

    await userEvent.keyboard("{ArrowDown}{Escape}");

    expect(selectedNode(store())).toBeUndefined();
  });

  // 물러나는 키(Esc)만 손이 어디에 있든 듣는다 — 나머지 키는 손이 놓인 곳의 것이다.
  it("leaves the editing keys to whatever the hand is resting on", async () => {
    render(<App />);
    await focusCanvas();
    await userEvent.keyboard("{ArrowDown}");
    screen.getByRole("button", { name: "노드 추가" }).focus();

    await userEvent.keyboard("{Delete}");

    expect(selectedNode(store())?.id).toBe(example.nodes[0].id);
  });
});

describe("saving with the keyboard", () => {
  it("puts the graph on the server with the save key", async () => {
    const sent: unknown[] = [];
    useEditor.setState({
      sendSpec: async (spec) => {
        sent.push(spec);
        return { saved: asServerAnswer({ ...spec, version: 1 }), issues: [] };
      },
    });
    render(<App />);
    await focusCanvas();

    await userEvent.keyboard("{Meta>}s{/Meta}");

    await waitFor(() => expect(sent).toHaveLength(1));
  });
});

describe("editing with the keyboard", () => {
  it("deletes the selected node", async () => {
    render(<App />);
    await focusCanvas();

    await userEvent.keyboard("{ArrowDown}{Delete}{Enter}");

    expect(store().nodes.map((node) => node.id)).not.toContain(example.nodes[0].id);
  });

  it("keeps the node when the user backs out of the warning with Escape", async () => {
    render(<App />);
    await focusCanvas();

    await userEvent.keyboard("{ArrowDown}{Delete}{Escape}");

    expect(store().nodes.map((node) => node.id)).toContain(example.nodes[0].id);
    expect(store().pendingDetach).toBeNull();
  });

  it("moves the focus into the warning so the answer keys reach it", async () => {
    render(<App />);
    await focusCanvas();

    await userEvent.keyboard("{ArrowDown}{Delete}");

    expect(screen.getByRole("alertdialog").contains(document.activeElement)).toBe(true);
  });

  it("gives the focus back to the canvas once the warning is gone", async () => {
    render(<App />);
    const canvas = await focusCanvas();

    await userEvent.keyboard("{ArrowDown}{Delete}{Escape}");

    expect(document.activeElement).toBe(canvas);
  });

  it("lets Enter press the button the user tabbed to inside the warning", async () => {
    render(<App />);
    await focusCanvas();
    await userEvent.keyboard("{ArrowDown}{Delete}");

    screen.getByRole("button", { name: "취소" }).focus();
    await userEvent.keyboard("{Enter}");

    expect(store().pendingDetach).toBeNull();
    expect(store().nodes.map((node) => node.id)).toContain(example.nodes[0].id);
  });

  it("moves the focus into the settings panel on Enter", async () => {
    render(<App />);
    act(() => store().select("node", "clinical-agent"));
    await focusCanvas();

    await userEvent.keyboard("{Enter}");

    const panel = screen.getByRole("complementary", { name: "설정" });
    expect(panel.contains(document.activeElement)).toBe(true);
  });

  it("takes back the last edit with the undo shortcut", async () => {
    render(<App />);
    await focusCanvas();

    await userEvent.keyboard("{ArrowDown}{Delete}{Enter}");
    await userEvent.keyboard("{Meta>}z{/Meta}");

    expect(store().nodes.map((node) => node.id)).toContain(example.nodes[0].id);
  });

  it("puts the edit back with the redo shortcut", async () => {
    render(<App />);
    await focusCanvas();

    await userEvent.keyboard("{ArrowDown}{Delete}{Enter}");
    await userEvent.keyboard("{Meta>}z{/Meta}");
    await userEvent.keyboard("{Meta>}{Shift>}z{/Shift}{/Meta}");

    expect(store().nodes.map((node) => node.id)).not.toContain(example.nodes[0].id);
  });
});

describe("outside the canvas the keyboard belongs to the browser", () => {
  /** 캔버스 밖의 버튼 하나 — 독의 아이콘은 언제나 화면에 있다. */
  function dockButton() {
    return screen.getByRole("button", { name: "보관함" });
  }

  it("lets Enter press the button that has focus", async () => {
    render(<App />);
    act(() => store().select("node", "clinical-agent"));
    await userEvent.click(screen.getByRole("button", { name: "노드 추가" }));
    const before = store().nodes.length;

    screen.getByRole("button", { name: /AI 에이전트/ }).focus();
    await userEvent.keyboard("{Enter}");

    expect(store().nodes).toHaveLength(before + 1);
  });

  it("lets Tab move on from a button", async () => {
    render(<App />);
    act(() => store().select("node", "clinical-agent"));

    const button = dockButton();
    button.focus();
    await userEvent.tab();

    expect(button).not.toHaveFocus();
  });

  it("does not delete the selected node from a button", async () => {
    render(<App />);
    act(() => store().select("node", "clinical-agent"));

    dockButton().focus();
    await userEvent.keyboard("{Delete}");

    expect(store().nodes.map((node) => node.id)).toContain("clinical-agent");
  });

  it("does not walk to another node from a button", async () => {
    render(<App />);
    act(() => store().select("node", "clinical-agent"));

    dockButton().focus();
    await userEvent.keyboard("{ArrowDown}");

    expect(selectedNode(store())?.id).toBe("clinical-agent");
  });

  it("still takes the last edit back from anywhere in the app", async () => {
    render(<App />);
    act(() => store().addNode("llm.agent", { x: 0, y: 0 }));
    const before = store().nodes.length;

    dockButton().focus();
    await userEvent.keyboard("{Meta>}z{/Meta}");

    expect(store().nodes).toHaveLength(before - 1);
  });
});

describe("while the user is typing in a field", () => {
  it("does not treat Backspace as a delete of the selected node", async () => {
    render(<App />);
    act(() => store().select("node", "clinical-agent"));

    const field = screen.getByLabelText(/사용할 모델/);
    field.focus();
    await userEvent.keyboard("{Backspace}");

    expect(store().nodes.map((node) => node.id)).toContain("clinical-agent");
  });

  it("leaves the undo shortcut to the text field itself", async () => {
    render(<App />);
    act(() => store().select("node", "clinical-agent"));
    act(() => store().addNode("llm.agent", { x: 0, y: 0 }));
    const before = store().nodes.length;

    screen.getByLabelText(/사용할 모델/).focus();
    await userEvent.keyboard("{Meta>}z{/Meta}");

    expect(store().nodes).toHaveLength(before);
  });

  it("does not walk to another node with the arrow keys", async () => {
    render(<App />);
    act(() => store().select("node", "clinical-agent"));

    screen.getByLabelText(/사용할 모델/).focus();
    await userEvent.keyboard("{ArrowDown}");

    expect(selectedNode(store())?.id).toBe("clinical-agent");
  });
});

describe("keys while a run is on screen", () => {
  const trial = {
    runId: "run_example",
    startedAt: new Date("2026-08-01T12:30:00.000Z"),
  };

  async function watchRun() {
    render(<App />);
    await act(async () => {
      await runOnServer(trial);
    });
    await focusCanvas();
  }

  it("stops the run with the space bar", async () => {
    await watchRun();

    await userEvent.keyboard("[Space]");

    expect(store().isPlaying).toBe(false);
  });

  it("starts it moving again with the space bar", async () => {
    await watchRun();

    await userEvent.keyboard("[Space][Space]");

    expect(store().isPlaying).toBe(true);
  });

  it("steps one event forward with the right arrow", async () => {
    await watchRun();

    await userEvent.keyboard("{ArrowRight}");

    expect(currentSeq(store())).toBe(1);
  });

  it("steps one event back with the left arrow", async () => {
    await watchRun();

    await userEvent.keyboard("{ArrowRight}{ArrowRight}{ArrowLeft}");

    expect(currentSeq(store())).toBe(1);
  });

  it("leaves the node selection alone while stepping through the run", async () => {
    await watchRun();

    await userEvent.keyboard("{ArrowRight}");

    expect(selectedNode(store())).toBeUndefined();
  });

  it("does not take a node out while the run is on screen", async () => {
    await watchRun();
    act(() => store().select("node", "triage"));

    await userEvent.keyboard("{Delete}");

    expect(store().nodes.map((node) => node.id)).toContain("triage");
    expect(store().pendingDetach).toBeNull();
  });

  it("closes the run with Escape", async () => {
    await watchRun();

    await userEvent.keyboard("{Escape}");

    expect(isRunning(store())).toBe(false);
  });

  // 한 걸음(←/→)도 손이다 (DESIGN §7 event-list) — 같은 시각의 사건에서도 옮겨 간 그 줄이 가운데 줄이다.
  it("옮겨 간 줄이 같은 시각의 사건에서도 가운데 줄로 보인다", async () => {
    await watchRun();
    const startedAt = new Date("2026-08-01T12:30:00.000Z");
    /** 가운데 세 사건의 시각이 똑같은 실행 — 시각만으로는 옮겨 간 줄을 되찾을 수 없다. */
    const tiedEvents = [0, 100, 100, 100, 200].map((offsetMs, index) => ({
      seq: index,
      run_id: "run_tied",
      event_type: (
        ["run.started", "node.started", "node.completed", "node.started", "run.completed"] as const
      )[index],
      timestamp: new Date(startedAt.getTime() + offsetMs).toISOString(),
      spec_revision: example.revision,
      ...(index === 1 || index === 2 ? { node_id: "input" } : {}),
      ...(index === 3 ? { node_id: "triage" } : {}),
      payload: {},
    }));
    act(() => {
      useEditor.setState({
        runEvents: tiedEvents,
        activeRunId: "run_tied",
        runHistory: [
          {
            id: "run_tied",
            at: startedAt,
            order: 1,
            events: tiedEvents,
            specSnapshot: example,
          },
        ],
      });
      store().goToEvent(1);
    });
    await focusCanvas();

    await userEvent.keyboard("{ArrowRight}");

    const shownRows = within(screen.getByRole("region", { name: "실행 기록" }))
      .getAllByRole("button")
      .filter((button) => button.getAttribute("aria-current") === "true");
    expect(shownRows).toHaveLength(1);
    expect(within(shownRows[0]).getByText("'input' 노드가 일을 마쳤다")).toBeInTheDocument();
  });
});

// Cmd+S는 언제나 앱의 것이다 — 저장할 수 없는 자리에서도 브라우저 대화상자를 열지 않는다.
describe("saving when saving is not possible", () => {
  const saveKey = shortcutName({
    key: "s",
    metaKey: true,
    ctrlKey: false,
    shiftKey: false,
  });

  /** 무엇 하나 저장할 수 없는 자리 — 실행을 보는 중이고, 빼기 물음도 떠 있다. */
  const nowhereToSave = {
    onCanvas: false,
    editing: true,
    hasSelection: false,
    previewing: true,
    onPreview: false,
    running: true,
    panelOpen: true,
    comparing: true,
    pickerOpen: true,
    runInputAsking: true,
    onRunInputField: true,
    gateAsking: true,
    gateConfirming: true,
    onGateField: true,
    docListOpen: true,
    askingBeforeOpen: true,
    fileOpenAsking: true,
    toolWrapOpen: true,
    onToolWrapField: true,
    skillImportOpen: true,
    onSkillImportField: true,
    architectAsking: true,
    chatOpen: true,
    onChatField: true,
    chatDeleteAsking: true,
    chatGateAsking: true,
    chatGateConfirming: true,
    chatSwitchAsking: true,
    docPopoverOpen: true,
    contextMenuOpen: true,
  };

  it("저장할 수 없는 자리에서도 그 키는 앱이 받는다 — 브라우저가 가져가지 않는다", () => {
    expect(findShortcut(saveKey, nowhereToSave)).toBeDefined();
  });

  it("왜 지금 저장할 수 없는지 한 번 말한다 — 조용히 넘어가지 않는다", async () => {
    useEditor.setState({ savedSpec: null, feedbackNotice: null, spec: null, nodes: [] });
    render(<App />);
    await focusCanvas();

    await userEvent.keyboard("{Meta>}s{/Meta}");

    await waitFor(() =>
      expect(useEditor.getState().feedbackNotice?.message.key).toBe("save.none"),
    );
  });

  it("실행을 보는 중에도 까닭을 말한다", async () => {
    useEditor.getState().loadSpec(example);
    useEditor.setState({ feedbackNotice: null });
    await act(async () => {
      await runOnServer({ runId: "run_1", startedAt: new Date("2026-08-01T12:30:00.000Z") });
    });
    render(<App />);
    await focusCanvas();

    await userEvent.keyboard("{Meta>}s{/Meta}");

    await waitFor(() =>
      expect(useEditor.getState().feedbackNotice?.message.key).toBe("save.locked.running"),
    );
  });
});

// 한 번의 Esc는 한 가지만 물린다 (DESIGN §1) — 문서 열기가 낀 자리의 순서.
describe("문서 열기가 떠 있을 때 Esc가 물러나는 순서", () => {
  const nothingOpen: ShortcutContext = {
    onCanvas: true,
    editing: false,
    hasSelection: false,
    previewing: false,
    onPreview: false,
    running: false,
    panelOpen: false,
    comparing: false,
    pickerOpen: false,
    contextMenuOpen: false,
    runInputAsking: false,
    onRunInputField: false,
    gateAsking: false,
    gateConfirming: false,
    onGateField: false,
    docListOpen: false,
    askingBeforeOpen: false,
    fileOpenAsking: false,
    toolWrapOpen: false,
    onToolWrapField: false,
    skillImportOpen: false,
    onSkillImportField: false,
    architectAsking: false,
    chatOpen: false,
    onChatField: false,
    chatDeleteAsking: false,
    chatGateAsking: false,
    chatGateConfirming: false,
    chatSwitchAsking: false,
    docPopoverOpen: false,
  };

  /** Esc 한 번이 무엇을 물렸는지 — 걸음은 하나뿐이어야 한다. */
  function whatEscapeDid(context: Partial<ShortcutContext>): string[] {
    const done: string[] = [];
    const editor = {
      closePicker: () => done.push("picker"),
      closeDocPopover: () => done.push("doc.popover"),
      closeRunInput: () => done.push("run.input"),
      cancelDetach: () => done.push("detach"),
      cancelReject: () => done.push("gate.reject"),
      cancelOpening: () => done.push("open.ask"),
      cancelFileOpen: () => done.push("file.ask"),
      setGateCardOpen: () => done.push("gate.card"),
      closeDocList: () => done.push("docList"),
      closeToolWrap: () => done.push("toolWrap"),
      cancelDeleteChat: () => done.push("chat.ask"),
      cancelChatRejectGate: () => done.push("chat.gate.reject"),
      setChatGateCardOpen: () => done.push("chat.gate.card"),
      leaveChatMode: () => done.push("chat"),
      cancelSwitchPastChat: () => done.push("chat.switch.ask"),
      clearCompare: () => done.push("compare"),
      stopRun: () => done.push("run"),
      clearSelection: () => done.push("selection"),
    } as unknown as EditorState;

    findShortcut("Escape", { ...nothingOpen, ...context })?.({
      editor,
      focusInspector: () => undefined,
      closePanel: () => done.push("panel"),
      blurField: () => done.push("field.blur"),
    });
    return done;
  }

  it("되묻는 물음이 목록보다 먼저 물러난다", () => {
    expect(
      whatEscapeDid({
        askingBeforeOpen: true,
        docListOpen: true,
        panelOpen: true,
        hasSelection: true,
      }),
    ).toEqual(["open.ask"]);
  });

  it("파일 열기 되묻기도 목록보다 먼저 물러난다", () => {
    expect(
      whatEscapeDid({
        fileOpenAsking: true,
        docListOpen: true,
        panelOpen: true,
        hasSelection: true,
      }),
    ).toEqual(["file.ask"]);
  });

  // 폼 필드에 손이 있으면 Esc는 그 손만 뗀다 — 카드는 닫지 않는다 (DESIGN §7 승인 폼).
  it("승인 폼 필드에서는 초점만 거두고 카드는 그대로 둔다", () => {
    expect(
      whatEscapeDid({
        onGateField: true,
        editing: true,
        gateAsking: true,
        running: true,
        hasSelection: true,
      }),
    ).toEqual(["field.blur"]);
  });

  it("필드에서 손을 뗀 다음의 Esc는 카드를 닫는다 — 한 걸음씩이다", () => {
    expect(whatEscapeDid({ gateAsking: true, running: true })).toEqual(["gate.card"]);
  });

  // 실행 입력 카드는 되묻는 물음 뒤, gate 카드보다 먼저 물러난다 (DESIGN §1 ①′).
  it("되묻는 물음이 실행 입력 카드보다 먼저 물러난다", () => {
    expect(
      whatEscapeDid({ askingBeforeOpen: true, runInputAsking: true }),
    ).toEqual(["open.ask"]);
  });

  it("실행 입력 카드가 gate 카드보다 먼저 물러난다", () => {
    expect(whatEscapeDid({ runInputAsking: true, gateAsking: true })).toEqual([
      "run.input",
    ]);
  });

  it("실행 입력 칸에 손이 있으면 초점만 거두고 카드는 그대로 둔다", () => {
    expect(
      whatEscapeDid({ onRunInputField: true, editing: true, runInputAsking: true }),
    ).toEqual(["field.blur"]);
  });

  it("열린 gate 카드가 목록보다 먼저 물러난다", () => {
    expect(whatEscapeDid({ gateAsking: true, docListOpen: true })).toEqual(["gate.card"]);
  });

  it("목록은 독 패널·비교·선택보다 먼저 물러난다", () => {
    expect(
      whatEscapeDid({
        docListOpen: true,
        panelOpen: true,
        comparing: true,
        hasSelection: true,
      }),
    ).toEqual(["docList"]);
  });

  it("목록이 닫혀 있으면 순서는 예전 그대로다", () => {
    expect(whatEscapeDid({ panelOpen: true, hasSelection: true })).toEqual(["panel"]);
  });

  // 대화 패널은 목록 다음, 독 패널보다 먼저 물러난다 (DESIGN §1 ③′).
  it("지우기 되묻기가 대화 패널보다 먼저 물러난다", () => {
    expect(whatEscapeDid({ chatDeleteAsking: true, chatOpen: true })).toEqual([
      "chat.ask",
    ]);
  });

  it("적던 말에 손이 있으면 초점만 거두고 대화는 그대로 둔다", () => {
    expect(whatEscapeDid({ onChatField: true, editing: true, chatOpen: true })).toEqual([
      "field.blur",
    ]);
  });

  // 대화 안의 밸브도 실행 화면과 같은 순서로 물러난다 (DESIGN §1 ①·②).
  it("대화 안의 되묻기가 그 카드보다 먼저 물러난다", () => {
    expect(
      whatEscapeDid({ chatGateConfirming: true, chatGateAsking: true, chatOpen: true }),
    ).toEqual(["chat.gate.reject"]);
  });

  it("열린 확인 카드가 대화 패널보다 먼저 물러난다 — 답을 강요하지 않고 멈춘 채 둔다", () => {
    expect(whatEscapeDid({ chatGateAsking: true, chatOpen: true })).toEqual([
      "chat.gate.card",
    ]);
  });

  // L2 — 지난 대화 목록 뷰에는 적던 말도 확인 카드도 없으므로 Esc는 이 걸음에 곧장 닿는다.
  it("카드를 닫은 다음의 Esc가 대화를 닫는다 — 한 걸음씩이다", () => {
    expect(whatEscapeDid({ chatOpen: true })).toEqual(["chat"]);
  });

  // 지난 대화 목록 뷰의 Esc (CHAT-4b L2) — 목록만 따로 닫는 걸음을 만들지 않는다.
  it("전환을 되묻는 물음이 대화 패널보다 먼저 물러난다", () => {
    expect(whatEscapeDid({ chatSwitchAsking: true, chatOpen: true })).toEqual([
      "chat.switch.ask",
    ]);
  });

  // 잠깐 뜬 팝오버는 언제나 맨 위에 있으므로 가장 먼저 물러난다 (DESIGN §1 팝오버 예외).
  it("문서 메뉴가 열려 있으면 Esc는 선택을 풀지 않고 그 팝오버만 닫는다", () => {
    expect(whatEscapeDid({ docPopoverOpen: true, hasSelection: true })).toEqual([
      "doc.popover",
    ]);
  });

  it("글자를 치는 중이어도 열린 팝오버가 먼저 물러난다", () => {
    expect(whatEscapeDid({ docPopoverOpen: true, editing: true })).toEqual([
      "doc.popover",
    ]);
  });

  it("실행 입력 카드가 떠 있어도 팝오버가 먼저 물러난다 — 한 걸음씩이다", () => {
    expect(whatEscapeDid({ docPopoverOpen: true, runInputAsking: true })).toEqual([
      "doc.popover",
    ]);
  });

  it("대화 패널은 문서 목록 다음, 독 패널보다 먼저 물러난다", () => {
    expect(whatEscapeDid({ chatOpen: true, docListOpen: true })).toEqual(["docList"]);
    expect(whatEscapeDid({ chatOpen: true, panelOpen: true, hasSelection: true })).toEqual([
      "chat",
    ]);
  });
});

// 초점이 앱 밖(body)으로 떨어져도 앱의 키는 앱의 것이다 — 조용히 죽지 않는다.
describe("keys when nothing in the app holds the focus", () => {
  function letGoOfTheFocus() {
    (document.activeElement as HTMLElement | null)?.blur();
    expect(document.activeElement).toBe(document.body);
  }

  it("이름을 확정한 바로 다음에도 저장 키가 듣는다", async () => {
    const sent: unknown[] = [];
    store().loadSpec(example);
    useEditor.setState({
      savedSpec: null,
      feedbackNotice: null,
      sendSpec: async (spec) => {
        sent.push(spec);
        return { saved: asServerAnswer({ ...spec, version: 1 }), issues: [] };
      },
    });
    render(<App />);
    await userEvent.click(screen.getByRole("button", { name: /이름 바꾸기/ }));
    await userEvent.type(screen.getByRole("textbox", { name: "문서 이름" }), "새 이름{Enter}");
    letGoOfTheFocus();

    await userEvent.keyboard("{Meta>}s{/Meta}");

    await waitFor(() => expect(sent).toHaveLength(1));
  });

  it("초점이 허공에 있어도 Esc 체인이 돈다", async () => {
    store().loadSpec(example);
    render(<App />);
    act(() => store().select("node", "triage"));
    letGoOfTheFocus();

    await userEvent.keyboard("{Escape}");

    expect(selectedNode(store())).toBeUndefined();
  });

  it("초점이 허공에 있어도 되돌리기가 듣는다", async () => {
    store().loadSpec(example);
    render(<App />);
    act(() => store().addNode("llm.agent", { x: 10, y: 10 }));
    const grown = store().nodes.length;
    letGoOfTheFocus();

    await userEvent.keyboard("{Meta>}z{/Meta}");

    expect(store().nodes).toHaveLength(grown - 1);
  });
});

// 붙여 넣는 칸은 글을 적는 자리다 — 그 칸의 Esc는 그 칸의 것이고, 카드는 한 걸음 뒤에 닫힌다
// (DESIGN §1 ①′ — gate-card·run-input-card와 같은 규칙).
describe("붙여 넣어 만드는 카드에서 Esc가 물러나는 순서", () => {
  async function openTheCard() {
    render(<App />);
    await userEvent.click(screen.getByRole("button", { name: "연결" }));
    await userEvent.click(screen.getByRole("button", { name: "새 연결" }));
    return screen.getByRole("textbox", { name: "붙여 넣은 내용" });
  }

  it("적던 칸에서 한 번 누르면 손만 떼고 카드는 그대로 서 있다", async () => {
    const box = await openTheCard();
    expect(box).toHaveFocus();

    await userEvent.keyboard("{Escape}");

    expect(box).not.toHaveFocus();
    expect(screen.getByRole("dialog", { name: "무엇을 연결할까요" })).toBeInTheDocument();
  });

  it("한 번 더 누르면 카드가 물러난다 — 독 패널은 그대로 열려 있다", async () => {
    await openTheCard();

    await userEvent.keyboard("{Escape}");
    await userEvent.keyboard("{Escape}");

    expect(
      screen.queryByRole("dialog", { name: "무엇을 연결할까요" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "연결" })).toBeInTheDocument();
  });
});
