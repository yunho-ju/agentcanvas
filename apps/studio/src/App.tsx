import { useEffect, useRef, useState } from "react";
import "./app.css";
import { Canvas } from "./canvas/Canvas";
import { StatusBar } from "./canvas/StatusBar";
import { Dock } from "./shell/Dock";
import { DocCard } from "./shell/DocCard";
import { HistoryControls } from "./shell/HistoryControls";
import { ModeSegment } from "./shell/ModeSegment";
import { OpenDialog } from "./shell/OpenDialog";
import { ToolWrapCard } from "./resources/ToolWrapCard";
import { SkillImportCard } from "./skills/SkillImportCard";
import { RunControls } from "./shell/RunControls";
import { TopWidthNotice } from "./shell/TopWidthNotice";
import { useDockPanel } from "./shell/useDockPanel";
import {
  findShortcut,
  isCanvasFocused,
  isChatFieldFocused,
  isEditingElement,
  isGateFieldFocused,
  isPreviewFocused,
  isRunInputFieldFocused,
  isSkillImportFieldFocused,
  isToolWrapFieldFocused,
  shortcutName,
} from "./canvas/shortcuts";
import { EvalPanel } from "./eval/EvalPanel";
import { EvalCompareView } from "./eval/EvalCompareView";
import { FirstStepsCard } from "./guide/FirstStepsCard";
import { ArchitectPanel } from "./architect/ArchitectPanel";
import { OptimizePanel } from "./optimize/OptimizePanel";
import { ChatPanel } from "./chat/ChatPanel";
import { Inspector } from "./inspector/Inspector";
import { InspectorFocusProvider } from "./inspector/inspectorFocus";
import { CompareView } from "./run/CompareView";
import { EventList } from "./run/EventList";
import { RunHistoryStrip } from "./run/RunHistoryStrip";
import { Timeline } from "./run/Timeline";
import { useRunClock } from "./run/useRunClock";
import { selectedEdge, selectedNode, useEditor } from "./store/editor";
import { chatGateIsAsking, chatGateIsConfirmingReject } from "./store/chatSlice";
import { gateIsAsking, gateIsConfirmingReject } from "./store/gateSlice";
import { askingBeforeOpen, docListIsOpen, fileOpenIsAsking } from "./store/openSlice";
import { runInputIsAsking } from "./store/runInputSlice";
import { skillImportIsOpen } from "./store/skillImportSlice";
import { isComparing, isRunning } from "./store/runSlice";

export function App() {
  const inspectorRef = useRef<HTMLElement>(null);
  const dock = useDockPanel();
  const architectOpen = useEditor((state) => state.architectMode === "guided" && state.spec === null && state.nodes.length === 0);
  // 재생 중에는 밖의 시계가 store에 시간을 흘려 넣는다.
  useRunClock();

  // 설정 카드는 고른 것이 있을 때만 뜬다 — 노드를 고르는 것과 초점을 옮기는 것은
  // 한 번의 그리기를 사이에 두고 일어난다. 그래서 "데려가 달라"는 뜻만 남기고,
  // 카드가 화면에 선 다음에 초점을 옮긴다.
  const [focusRequest, setFocusRequest] = useState(0);

  function focusInspector() {
    setFocusRequest((count) => count + 1);
  }

  useEffect(() => {
    if (focusRequest === 0) return;
    const panel = inspectorRef.current;
    // 데려간 자리는 첫 설정 칸이다 — 카드를 닫는 버튼이 아니다.
    const fields = panel?.querySelector(".inspector__fields");
    const first = fields?.querySelector<HTMLElement>("input, textarea, select, button");
    (first ?? panel)?.focus();
  }, [focusRequest]);

  // 새로고침하고 돌아왔으면 주소가 가리키던 문서를 다시 연다 — 한 번만 묻는다.
  useEffect(() => {
    void useEditor.getState().restoreDocFromAddress();
  }, []);

  // 키는 창 전체에서 받는다. 초점이 앱 안의 무엇에도 놓여 있지 않을 때(예: 인라인 편집이 끝난 직후)
  // 앱의 키가 조용히 죽지 않게 하기 위해서다 — 어디서 눌렸는지는 event.target이 그대로 말해 준다.
  useEffect(() => {
    function onKeyDown(event: globalThis.KeyboardEvent) {
      const editor = useEditor.getState();
      const action = findShortcut(shortcutName(event), {
        onCanvas: isCanvasFocused(event.target),
        editing: isEditingElement(event.target),
        hasSelection:
          selectedNode(editor) !== undefined || selectedEdge(editor) !== undefined,
        previewing: editor.pendingDetach !== null,
        onPreview: isPreviewFocused(event.target),
        running: isRunning(editor),
        panelOpen: dock.openPanel !== null,
        comparing: isComparing(editor),
        pickerOpen: editor.picker !== null,
        docPopoverOpen: editor.docPopover !== "closed",
        runInputAsking: runInputIsAsking(editor),
        onRunInputField: isRunInputFieldFocused(event.target),
        gateAsking: gateIsAsking(editor),
        gateConfirming: gateIsConfirmingReject(editor),
        onGateField: isGateFieldFocused(event.target),
        docListOpen: docListIsOpen(editor),
        askingBeforeOpen: askingBeforeOpen(editor) !== null,
        fileOpenAsking: fileOpenIsAsking(editor),
        toolWrapOpen: editor.toolWrapMode !== "closed",
        onToolWrapField: isToolWrapFieldFocused(event.target),
        skillImportOpen: skillImportIsOpen(editor),
        onSkillImportField: isSkillImportFieldFocused(event.target),
        chatOpen: editor.chatOpen,
        onChatField: isChatFieldFocused(event.target),
        chatDeleteAsking: editor.chatDeleteAsking,
        chatSwitchAsking: editor.chatSwitchAsking !== null,
        chatGateAsking: chatGateIsAsking(editor),
        chatGateConfirming: chatGateIsConfirmingReject(editor),
      });
      if (!action) return;
      event.preventDefault();
      action({
        editor,
        focusInspector,
        closePanel: dock.close,
        blurField: () => (event.target as HTMLElement | null)?.blur?.(),
      });
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [dock.openPanel, dock.close]);

  return (
    // 단축키는 앱 어디에서 눌러도 받는다 — 실제 처리 여부는 shortcuts 표가 정한다.
    // "여기서 고치세요"라고 데려가는 길은 화면 전체가 함께 쓴다 (뱃지·집계 pill·Enter 키).
    <InspectorFocusProvider value={focusInspector}>
      <div className="app">
        {/* 캔버스가 화면 전체의 주인이고, 나머지는 모두 그 위에 뜬다. */}
        <main className="app__canvas">
          <Canvas />
        </main>
        {/* 상단의 세 자리는 서로를 모르는 절대 배치가 아니라 한 그리드의 세 칸이다
            — 어느 폭에서도 겹치지 않는다 (DESIGN §1 상단 레이어). */}
        <div className="layer-top">
          <TopWidthNotice />
          <div className="layer-top-left">
            <DocCard />
            <HistoryControls />
          </div>
          <div className="layer-top-center">
            <ModeSegment />
          </div>
          <RunControls />
        </div>
        <Dock openPanel={dock.openPanel} onToggle={dock.toggle} />
        {/* 견주는 화면은 캔버스 한가운데에 선다 — 두 실행을 고른 동안에만 있다. */}
        <CompareView />
        <EvalCompareView />
        {/* 무엇을 열지 고르는 자리도 한가운데다 — 고르는 동안 캔버스는 뒤에 있다. */}
        <OpenDialog />
        {/* 붙여 넣은 API 설명을 연결로 바꾸는 자리도 한가운데다 — 승인 전에는 문서가 그대로다. */}
        <ToolWrapCard />
        {/* 붙여 넣은 글을 skill로 바꾸는 자리도 한가운데다 — 승인 전에는 문서가 그대로다. */}
        <SkillImportCard />
        {/* 겉 레이어는 자리만 잡고 클릭을 받지 않는다 — 스크롤은 손이 닿는 안쪽 기둥의 일이다
            (DESIGN §1 우측 레이어의 자리 나눔). */}
        <div className="layer-right">
          <div className="layer-right__stack">
            <Inspector panelRef={inspectorRef} />
            <EventList />
            {/* 시험 모드일 때만 선다 — 캔버스는 배경에 그대로다 (DESIGN §7 eval-panel). */}
            <EvalPanel />
            <ArchitectPanel />
            <OptimizePanel />
            {/* 대화 모드일 때만 선다 — 다른 모드 패널과 자리를 나눠 쓰지 않는다 (DESIGN §1). */}
            <ChatPanel />
            {/* 처음 온 사람의 네 걸음 — 스택의 마지막에서 안내하고, 다 걸으면 물러난다. */}
            {!architectOpen ? <FirstStepsCard /> : null}
          </div>
        </div>
        <div className="layer-bottom">
          <StatusBar />
          <Timeline />
          <RunHistoryStrip />
        </div>
      </div>
    </InspectorFocusProvider>
  );
}
