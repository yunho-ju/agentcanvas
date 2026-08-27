import {
  Controls,
  type FinalConnectionState,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  ViewportPortal,
  useConnection,
  useReactFlow,
} from "@xyflow/react";
// 캔버스 라이브러리의 기본 스타일은 app.css가 맨 앞에서 한 번만 들여온다 (덮어쓰기 순서).
import { type CSSProperties, type MouseEvent, useEffect, useMemo, useRef } from "react";
import type { FlowEdge, FlowNode } from "../graph/serialize";
import { edgeFlowStates, nodeRunFacts } from "../run/player";
import { markedForRun } from "../run/runMarks";
import { useT } from "../i18n/useT";
import { useEditor } from "../store/editor";
import { currentSeq, isRunning } from "../store/runSlice";
import { ConnectionHint } from "./ConnectionHint";
import { motionDurationMs } from "./motion";
import { NodeCard } from "./NodeCard";
import { NodePicker } from "./NodePicker";
import { onEmptyCanvas, pointerPosition, releasedPort } from "./pickerGestures";
import { flowEdgeTypes } from "./PipeEdge";
import { markedForPreview } from "./previewMarks";
import { surfacePoint } from "./surfacePoint";
import { heldPortOf, useLandingHint } from "./useLandingHint";

const flowNodeTypes = { agentNode: NodeCard };

/** 줄이 맞는 순간에만 서는 안내선 — 캔버스 좌표 위에 그린다 (브리프 A3). */
function AlignmentGuides() {
  const guides = useEditor((state) => state.alignmentGuides);
  if (guides.length === 0) return null;
  return (
    <ViewportPortal>
      {guides.map((guide) => (
        <div
          key={`${guide.axis}${guide.at}`}
          className={`canvas__guide canvas__guide--${guide.axis}`}
          style={guide.axis === "x" ? { left: guide.at } : { top: guide.at }}
        />
      ))}
    </ViewportPortal>
  );
}

function CanvasSurface() {
  const pending = useEditor((state) => state.pendingDetach);
  const running = useEditor(isRunning);
  // 실행의 한 순간은 이벤트와 재생 위치에서만 나온다 — 그 둘이 그대로면 다시 재지 않는다.
  const runEvents = useEditor((state) => state.runEvents);
  const seq = useEditor(currentSeq);
  const runSpeed = useEditor((state) => state.runSpeed);
  const facts = useMemo(() => nodeRunFacts(runEvents, seq), [runEvents, seq]);
  const graph = {
    nodes: useEditor((state) => state.nodes),
    edges: useEditor((state) => state.edges),
  };
  const flows = useMemo(
    () => edgeFlowStates(graph.edges, runEvents, seq),
    [graph.edges, runEvents, seq],
  );
  // 미리보기와 실행 표시는 화면에서만 입힌다 — 편집 기록에는 남지 않는다.
  const { nodes, edges } = running
    ? markedForRun(graph, facts, flows)
    : markedForPreview(graph, pending);
  const onNodesChange = useEditor((state) => state.onNodesChange);
  const onEdgesChange = useEditor((state) => state.onEdgesChange);
  const connect = useEditor((state) => state.connect);
  const openPicker = useEditor((state) => state.openPicker);
  const viewRequest = useEditor((state) => state.viewRequest);
  const surface = useRef<HTMLDivElement>(null);
  const pointer = useRef({ x: 0, y: 0 });
  const { fitView, screenToFlowPosition, flowToScreenPosition } = useReactFlow();
  const t = useT();

  // 지금 쥐고 있는 포트 — 받아 줄 자리가 하나도 없으면 그 곁에서 말을 건다 (C5).
  useLandingHint(
    useConnection(heldPortOf),
    (at) => placeAt(flowToScreenPosition(at)).screen,
  );

  // 화면을 데려가 달라는 부탁이 오면 그때 움직인다 (브리프 B7).
  useEffect(() => {
    if (!viewRequest) return;
    fitView({
      ...(viewRequest.nodes.length > 0
        ? { nodes: viewRequest.nodes.map((id) => ({ id })) }
        : {}),
      duration: motionDurationMs("--dur-enter"),
    });
  }, [viewRequest, fitView]);

  /** 손이 마지막으로 지나간 자리 — 이을 수 없다는 말은 이 자리 곁에 선다. */
  function rememberPointer(event: { clientX: number; clientY: number }) {
    pointer.current = { x: event.clientX, y: event.clientY };
  }

  /** 화면의 한 점을 캔버스 안쪽 좌표로 — 피커는 화면에, 노드는 캔버스에 놓인다. */
  function placeAt(screen: { x: number; y: number }) {
    return {
      at: screenToFlowPosition(screen),
      screen: surfacePoint(screen, surface.current?.getBoundingClientRect()),
    };
  }

  function onConnectEnd(
    event: globalThis.MouseEvent | TouchEvent,
    state: FinalConnectionState,
  ) {
    const from = releasedPort(state as unknown as Parameters<typeof releasedPort>[0]);
    if (!from) return;
    openPicker({ ...placeAt(pointerPosition(event)), from });
  }

  // 빈 캔버스를 두 번 누르면 같은 피커가 연결 없이 열린다 (브리프 B5).
  function onDoubleClick(event: MouseEvent<HTMLDivElement>) {
    if (running || !onEmptyCanvas(event.target)) return;
    openPicker({ ...placeAt(pointerPosition(event)), from: null });
  }

  return (
    // 키보드만으로도 노드를 고를 수 있어야 한다 — 캔버스 자체가 초점을 받는다 (설계 §13).
    <div
      ref={surface}
      className="canvas"
      role="application"
      aria-label={t("canvas.label")}
      tabIndex={0}
      onDoubleClick={onDoubleClick}
      onPointerMove={rememberPointer}
      onPointerDown={rememberPointer}
      // 빨리 감으면 관 속의 방울도 그만큼 빨라진다 — 재생 속도는 화면 전체가 함께 쓴다.
      style={{ "--run-speed": runSpeed } as CSSProperties}
    >
      <ReactFlow<FlowNode, FlowEdge>
        nodes={nodes}
        edges={edges}
        nodeTypes={flowNodeTypes}
        edgeTypes={flowEdgeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={(connection) => connect(connection, placeAt(pointer.current).screen)}
        onConnectEnd={onConnectEnd}
        // 삭제는 우리 단축키 표가 맡는다 — 되돌리기 기록이 남아야 하기 때문이다.
        deleteKeyCode={null}
        // 초점은 카드 자신이 받는다 — 감싼 껍데기까지 초점을 받으면 Tab이 두 번 멈춘다.
        nodesFocusable={false}
        // 실행을 보는 동안 그래프는 잠긴다 — 보기만 하고 고치지 않는다.
        nodesDraggable={!running}
        nodesConnectable={!running}
        fitView
      >
        <AlignmentGuides />
        <Controls className="canvas__controls" showInteractive={false} />
        {/* 위쪽은 문서·모드·실행의 자리다 — 미니맵은 우하단 구석으로 물러난다. */}
        <MiniMap className="canvas__minimap" position="bottom-right" pannable zoomable />
      </ReactFlow>
      <NodePicker />
      {/* 이을 수 없는 이유는 손이 있는 이 자리에서 말한다 (DESIGN §7). */}
      <ConnectionHint />
    </div>
  );
}

export function Canvas() {
  return (
    <ReactFlowProvider>
      <CanvasSurface />
    </ReactFlowProvider>
  );
}
