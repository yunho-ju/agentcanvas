import {
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  type FinalConnectionState,
  useConnection,
  useReactFlow,
  useStore,
  useViewport,
  ViewportPortal,
} from "@xyflow/react";
// 캔버스 라이브러리의 기본 스타일은 app.css가 맨 앞에서 한 번만 들여온다 (덮어쓰기 순서).
import {
  type CSSProperties,
  type MouseEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { FlowEdge, FlowNode } from "../graph/serialize";
import { visibleRect } from "../graph/visibleRect";
import { edgeFlowStates, nodeRunFacts } from "../run/player";
import { markedForRun } from "../run/runMarks";
import { useT } from "../i18n/useT";
import { useEditor } from "../store/editor";
import type { ViewRequest } from "../store/viewSlice";
import { currentSeq, isRunning } from "../store/runSlice";
import { ConnectionHint } from "./ConnectionHint";
import { motionDurationMs, tokenLengthPx } from "./motion";
import { NodeCard } from "./NodeCard";
import { NodePicker } from "./NodePicker";
import { onEmptyCanvas, pointerPosition, releasedPort } from "./pickerGestures";
import { flowEdgeTypes } from "./PipeEdge";
import { markedForPreview } from "./previewMarks";
import { type ScreenBox, revealMove } from "./reveal";
import { surfacePoint } from "./surfacePoint";
import { heldPortOf, useLandingHint } from "./useLandingHint";

const flowNodeTypes = { agentNode: NodeCard };

/** 이만큼은 있어야 줄여 볼 것이 있다 — 그보다 작으면 미니맵을 두지 않는다 (DESIGN §1 우하). */
const MINIMAP_FROM_NODES = 4;

/** 캔버스가 카드를 재기까지 기다려 주는 프레임 수(≈0.15초) — 그 안에 못 재면 화면을 흔들지 않는다. */
const MEASURE_TRIES = 10;

/** 캔버스가 그린 그 카드의 화면 자리 — 아직 그리거나 재지 못했으면 없다.
 *  이름은 문서에서 온 글자라 선택자에 그대로 넣지 않는다 — 그려진 카드들을 훑어 이름을 견준다. */
function cardRect(surface: HTMLDivElement | null, id: string): ScreenBox | null {
  const cards = surface?.querySelectorAll<HTMLElement>(".react-flow__node") ?? [];
  const card = Array.from(cards).find((drawn) => drawn.dataset.id === id);
  const rect = card?.getBoundingClientRect();
  return rect && rect.width > 0 ? rect : null;
}

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
  const viewRequestDone = useEditor((state) => state.viewRequestDone);
  // 기다린 프레임 수는 그 부탁의 것이다 — 부탁이 바뀌면 처음부터 다시 센다.
  const measuring = useRef<{ request: ViewRequest | null; waited: number }>({
    request: null,
    waited: 0,
  });
  const [lookAgain, setLookAgain] = useState(0);
  const surface = useRef<HTMLDivElement>(null);
  const pointer = useRef({ x: 0, y: 0 });
  const { fitView, screenToFlowPosition, flowToScreenPosition, getViewport, setViewport } =
    useReactFlow();
  // 화면을 끌거나 확대하면 한가운데가 가리키는 캔버스 좌표도 달라진다.
  const viewport = useViewport();
  // 창 크기가 바뀌면 보이는 네모도 바뀐다 — 팬·줌이 없어도 다시 잰다 (DESIGN §7 palette 화면 안이 먼저다).
  const surfaceWidth = useStore((state) => state.width);
  const surfaceHeight = useStore((state) => state.height);
  const noteViewportBox = useEditor((state) => state.noteViewportBox);
  const covers = useEditor((state) => state.covers);
  const t = useT();

  // 지금 보여주고 있는 자리가 캔버스 좌표로 어디인지는 캔버스만 안다 — 새 카드를 놓는 자리로
  // 쓰라고 알려 둔다 (DESIGN §7 palette 배치 — 화면 안이 먼저다). 팔레트·인스펙터·실행 독처럼
  // 캔버스 위에 뜬 층이 가린 만큼은 뷰포트에서 뺀다(§7 palette 보이는 네모는 덮개를 뺀 것이다).
  useEffect(() => {
    const rect = surface.current?.getBoundingClientRect();
    if (!rect) return;
    const seen = visibleRect(rect, Object.values(covers));
    const near = screenToFlowPosition({ x: seen.x, y: seen.y });
    const far = screenToFlowPosition({ x: seen.x + seen.width, y: seen.y + seen.height });
    noteViewportBox({
      x: near.x,
      y: near.y,
      width: far.x - near.x,
      height: far.y - near.y,
    });
  }, [viewport, surfaceWidth, surfaceHeight, covers, screenToFlowPosition, noteViewportBox]);

  // 지금 쥐고 있는 포트 — 받아 줄 자리가 하나도 없으면 그 곁에서 말을 건다 (C5).
  useLandingHint(
    useConnection(heldPortOf),
    (at) => placeAt(flowToScreenPosition(at)).screen,
  );

  // 새로 놓은 카드가 화면 밖이면 그만큼만 데리러 간다 — 줌은 그대로 둔다 (DESIGN §7 palette 배치).
  // 자리는 그 카드의 DOM이 말한다: 줌도 측정도 이미 그 안에 들어 있다.
  useEffect(() => {
    if (viewRequest?.kind !== "reveal") return;
    // 새 부탁이면 기다린 횟수도 새로 센다 — 지난 부탁을 포기한 일이 다음 부탁을 버리지 않는다.
    if (measuring.current.request !== viewRequest) {
      measuring.current = { request: viewRequest, waited: 0 };
    }
    const rect = surface.current?.getBoundingClientRect();
    const card = cardRect(surface.current, viewRequest.nodes[0]);
    if (!rect) return;
    // 캔버스 위에 뜬 층이 가린 자리는 "보인다"고 치지 않는다 — 그만큼 더 데려온다
    // (DESIGN §7 palette 보이는 네모는 덮개를 뺀 것이다).
    const seen = visibleRect(rect, Object.values(covers));
    // 아직 그리지도 재지도 못한 카드는 어디 있는지 모른다 — 모르는 채로 화면을 흔들지 않고
    // 다음 프레임에 다시 본다. 끝내 재지 못하면 부탁을 놓는다(매 프레임 다시 묻지 않는다).
    if (!card) {
      if (measuring.current.waited >= MEASURE_TRIES) {
        viewRequestDone();
        return;
      }
      measuring.current.waited += 1;
      const frame = requestAnimationFrame(() => setLookAgain((tick) => tick + 1));
      return () => cancelAnimationFrame(frame);
    }
    const move = revealMove(seen, card, tokenLengthPx("--space-4"));
    if (move) {
      const now = getViewport();
      setViewport(
        { x: now.x + move.dx, y: now.y + move.dy, zoom: now.zoom },
        { duration: motionDurationMs("--dur-enter") },
      );
    }
    viewRequestDone();
  }, [viewRequest, lookAgain, covers, getViewport, setViewport, viewRequestDone]);

  // 화면을 데려가 달라는 부탁이 오면 그때 움직인다 (브리프 B7).
  useEffect(() => {
    if (!viewRequest || viewRequest.kind === "reveal") return;
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
        // 열 때 전부를 담되 확대는 하지 않는다 — 빈 문서에 첫 카드가 들어오는 순간 초기 fit이
        // 카드 하나를 2배로 키우면 그 뒤로 보이는 자리가 반으로 줄어 카드가 세로로 감긴다 (DESIGN §7 palette).
        fitViewOptions={{ maxZoom: 1 }}
      >
        <AlignmentGuides />
        <Controls className="canvas__controls" showInteractive={false} />
        {/* 위쪽은 문서·모드·실행의 자리다 — 미니맵은 우하단 구석으로 물러난다.
            줄여 볼 것이 없는 작은 그래프에서는 아예 서지 않는다 (DESIGN §1 우하). */}
        {nodes.length >= MINIMAP_FROM_NODES ? (
          <MiniMap className="canvas__minimap" position="bottom-right" pannable zoomable />
        ) : null}
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
