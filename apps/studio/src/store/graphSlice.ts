// 캔버스에 무엇이 놓여 있는가 — 파일을 열고, 노드와 연결을 놓고, 자리를 옮기는 상태 전이만 담당한다.
// 포트 해석·직렬화·되돌리기 규칙은 graph/, history/ 의 순수 모듈에 있다.
import type { StateCreator } from "zustand";
import {
  type Connection,
  type EdgeChange,
  type NodeChange,
  applyEdgeChanges,
  applyNodeChanges,
} from "@xyflow/react";
import type { AgentSpec, EdgeKind, ResourceBinding } from "../generated/agent_spec";
import {
  type Alignment,
  type Box,
  type Guide,
  alignmentFor,
} from "../canvas/alignmentGuides";
import { checkConnection } from "../graph/connection";
import { newDraftSpec, newNode, randomDraftId } from "../graph/draft";
import { uniqueId } from "../graph/ids";
import { arrangedPositions } from "../graph/layout";
import { type Scene, sceneOf } from "../graph/scene";
import { type Message, msg } from "../i18n/messages";
import {
  type FlowEdge,
  type FlowEdgeData,
  type FlowGraph,
  type FlowNode,
  toFlow,
  toSpec,
} from "../graph/serialize";
import {
  type EditOptions,
  type Position,
  addEdge,
  changedFields,
  addNode as addNodeCommand,
  changeEdgeData,
  changeNodeConfig,
  moveNodes,
  removeParts,
} from "../history/graphCommands";
import {
  dropConnection,
  renameDoc,
  setApprovalPolicy,
} from "../history/docCommands";
import { nodeTypes } from "../registry/registry";
import { nodesUsing } from "../graph/connections";
import type { EditorState } from "./editor";
import { CLOSED_TOOL_WRAP } from "./toolWrapSlice";

export interface GraphSlice extends FlowGraph {
  spec: AgentSpec | null;
  isDraft: boolean;
  /** 드래그가 시작될 때의 위치 — 드래그 한 번이 되돌리기 한 번이 되게 한다 */
  dragOrigin: Record<string, Position> | null;
  /** 지금 끌고 있는 노드가 다른 노드와 맞춘 줄 — 손을 놓으면 사라진다 */
  alignmentGuides: Guide[];
  /** 새 초안에 붙일 이름을 짓는 자리. 시험은 여기에 정해진 이름을 꽂는다 */
  makeDraftId: () => string;
  loadSpec: (spec: AgentSpec) => void;
  exportSpec: () => AgentSpec;
  /**
   * 아직 문서가 없으면(새 초안) 지금 이 자리에서 실제로 연다 — 노드를 놓든, 피커로 고르든,
   * 시험 케이스를 저장하든 문서를 여는 문은 이 하나뿐이다(승격 관용구를 세 곳에 흩어 두지 않는다).
   */
  ensureDoc: () => void;
  /** 팔레트에서 노드를 놓는다. 이미 정해진 설정이 있으면 그 값을 실은 채로 놓인다 */
  addNode: (type: string, position: Position, config?: Record<string, unknown>) => void;
  /** 연결 하나를 문서에서 뺀다 — 되돌리기 한 걸음이고, 잃은 노드가 있으면 말한다 */
  dropConnection: (id: string) => void;
  /** 이 연결의 도구를 부를 때 사람 확인을 할지 정한다 — 되돌리기 한 걸음이다 */
  setApprovalPolicy: (
    id: string,
    policy: ResourceBinding["approval_policy"],
  ) => void;
  /** 손을 놓은 자리(at)는 이을 수 없을 때 그 이유가 설 자리다 (DESIGN §7 connection-hint) */
  connect: (connection: Connection, at: Position) => void;
  onNodesChange: (changes: NodeChange<FlowNode>[]) => void;
  onEdgesChange: (changes: EdgeChange<FlowEdge>[]) => void;
  updateNodeConfig: (
    id: string,
    config: Record<string, unknown>,
    options?: EditOptions,
  ) => void;
  updateEdgeKind: (id: string, kind: EdgeKind) => void;
  updateEdgeCondition: (id: string, expression: string) => void;
  /** 노드를 데이터가 흐르는 순서대로 왼쪽에서 오른쪽으로 정리한다 */
  arrangeNodes: () => void;
  /** 문서를 부르는 이름을 바꾼다 — 다른 편집과 같은 되돌리기 목록에 쌓인다 */
  renameSpec: (name: string) => void;
}

/** 손이 있던 자리가 없는 입구(팔레트)의 대신할 자리 — 캔버스의 왼쪽 위 구석. */
const CANVAS_ORIGIN: Position = { x: 0, y: 0 };

function positionsOf(nodes: FlowNode[], ids: string[]): Record<string, Position> {
  return Object.fromEntries(
    nodes.filter((node) => ids.includes(node.id)).map((node) => [node.id, node.position]),
  );
}

/** 화면이 잰 크기를 아직 모르는 노드는 점으로 본다 — 그래도 자리끼리는 줄이 맞는다. */
function boxOf(node: FlowNode, position: Position = node.position): Box {
  return {
    x: position.x,
    y: position.y,
    width: node.measured?.width ?? 0,
    height: node.measured?.height ?? 0,
  };
}

/**
 * 지금 손에 쥔 노드 하나가 다른 노드와 맞는 줄.
 * 여럿을 함께 끌 때는 무엇을 기준 삼을지 정할 수 없어 줄을 맞추지 않는다.
 */
function alignmentWhileDragging(
  nodes: FlowNode[],
  changes: NodeChange<FlowNode>[],
): { change: NodeChange<FlowNode>; alignment: Alignment } | undefined {
  const dragging = changes.filter(
    (change) => change.type === "position" && change.dragging === true && change.position,
  );
  if (dragging.length !== 1) return undefined;

  const change = dragging[0];
  if (change.type !== "position" || !change.position) return undefined;
  const moving = nodes.find((node) => node.id === change.id);
  if (!moving) return undefined;

  return {
    change,
    alignment: alignmentFor(
      boxOf(moving, change.position),
      nodes.filter((node) => node.id !== moving.id).map((node) => boxOf(node)),
    ),
  };
}

function movedSince(
  origin: Record<string, Position>,
  nodes: FlowNode[],
): { id: string; from: Position; to: Position }[] {
  return nodes.flatMap((node) => {
    const from = origin[node.id];
    if (!from) return [];
    const to = node.position;
    return from.x === to.x && from.y === to.y ? [] : [{ id: node.id, from, to }];
  });
}


export const createGraphSlice: StateCreator<EditorState, [], [], GraphSlice> = (
  set,
  get,
) => {
  const scene = (): Scene => sceneOf(get());

  return {
    spec: null,
    isDraft: false,
    nodes: [],
    edges: [],
    dragOrigin: null,
    alignmentGuides: [],
    makeDraftId: randomDraftId,

    loadSpec: (spec) => {
      const flow = toFlow(spec);
      set({
        spec,
        architectMode: "closed",
        architectDraft: null,
        architectReview: null,
        isDraft: false,
        nodes: flow.nodes,
        edges: flow.edges,
        connectionHint: null,
        notice: null,
        undoStack: [],
        redoStack: [],
        lastMergeKey: null,
        dragOrigin: null,
        alignmentGuides: [],
        // 다른 그래프를 열면 고르던 노드도, 보던 자리도 이 그래프의 것이 아니다.
        picker: null,
        viewRequest: null,
        tray: [],
        pendingDetach: null,
        // 다른 그래프를 열면 보고 있던 실행도, 해 본 실행들도 더 이상 이 그래프의 것이 아니다.
        // 파일을 여는 일은 새 출발이다 — 옛 문서의 그래프를 이 문서에 채택할 길을 남기지 않는다.
        runEvents: [],
        runOffsetMs: 0,
        isPlaying: false,
        runHistory: [],
        activeRunId: null,
        // 실행에 넣던 값도 그 그래프에 묻던 것이었다 — 새 문서는 처음부터 묻는다.
        runInputOpen: false,
        runInputValues: {},
        // 멈춰 세울 노드들도, 견주던 기록도 이 그래프의 이름이었다.
        breakpoints: [],
        compareSelection: [],
        adoptedRunId: null,
        // 다른 그래프를 열면 저장한 기억도 그 그래프의 것이었다.
        savedSpec: null,
        feedbackNotice: null,
        saving: false,
        architectLoading: false,
        // 만들던 연결도 그 문서의 것이었다 (DESIGN §7 tool-wrap-card).
        ...CLOSED_TOOL_WRAP,
      });
      // 듣고 있던 이벤트도, 서버에 부탁해 둔 실행도 그 그래프의 것이었다.
      get().abandonRuns();
      // 시험 묶음도, 돌던 배치도, 걸어 둔 폴링도 그 문서의 것이었다 (독립 리뷰 B1).
      get().abandonEval();
      // 나누던 대화도 그 문서가 내놓은 판과 하던 것이었다 (CHAT-3b I4).
      get().abandonChat();
      // 밸브 앞에서 묻던 물음도 그 그래프의 것이었다.
      get().setGateCardOpen(false);
      // 다 걸었다는 축하도 그 그래프에서 걸은 걸음의 것이었다 (기억은 남는다).
      get().endFirstStepsCelebration();
    },

    // 아직 문서가 없으면 내보낼 것도 초안의 껍데기뿐이다 — 이 껍데기는 서버로 나가지 않는다
    // (문서가 없으면 저장 자체가 막힌다).
    exportSpec: () => toSpec(get().spec ?? newDraftSpec(get().makeDraftId), scene()),

    ensureDoc: () => {
      set({
        spec: get().spec ?? newDraftSpec(get().makeDraftId),
        isDraft: get().spec === null,
      });
    },

    addNode: (type, position, config = {}) => {
      const nodeType = nodeTypes[type];
      if (!nodeType) return;
      get().ensureDoc();
      const node = newNode(
        nodeType,
        position,
        get().nodes.map((node) => node.id),
        config,
        get().spec?.resources ?? [],
      );
      get().runCommand(addNodeCommand(node));
      // 팔레트로 놓은 사람에게도 다음 걸음을 건넨다 — 입구가 달라도 초대는 같다 (DESIGN §7).
      // 이 입구에는 손이 있던 화면의 점이 없다: 자리는 가리킨 포트를 화면이 찾아 정한다.
      get().inviteFirstLink(node, CANVAS_ORIGIN);
    },

    dropConnection: (id) => {
      const current = get().spec?.resources ?? [];
      get().runCommand(dropConnection(current, id, nodesUsing(get().nodes, id)));
    },

    setApprovalPolicy: (id, policy) => {
      get().runCommand(setApprovalPolicy(get().spec?.resources ?? [], id, policy));
    },

    connect: (connection, at) => {
      const { sourceHandle, targetHandle } = connection;
      if (!sourceHandle || !targetHandle) return;

      // 거절은 손이 놓인 자리에서 말한다 — 화면 반대편으로 보내지 않는다 (DESIGN §7).
      const refuse = (reason: Message) =>
        get().showConnectionHint({ message: reason, tone: "danger", at });

      const alreadyLinked = get().edges.some(
        (edge) =>
          edge.source === connection.source &&
          edge.sourceHandle === sourceHandle &&
          edge.target === connection.target &&
          edge.targetHandle === targetHandle,
      );
      if (alreadyLinked) {
        // 포트는 사용자가 캔버스에서 읽는 그 라벨로 가리킨다 (DESIGN §7).
        refuse(msg("connection.duplicate", { source: sourceHandle, target: targetHandle }));
        return;
      }

      const check = checkConnection(
        get().exportSpec(),
        { node: connection.source, port: sourceHandle },
        { node: connection.target, port: targetHandle },
      );
      if (!check.ok) {
        refuse(check.reason ?? msg("connection.refused"));
        return;
      }

      get().runCommand(
        addEdge({
          id: uniqueId(
            `${connection.source}-${connection.target}`,
            get().edges.map((edge) => edge.id),
          ),
          source: connection.source,
          sourceHandle,
          target: connection.target,
          targetHandle,
          data: { kind: "data" },
        }),
      );
      // 이어졌다는 사실이 이미 답이다 — 떠 있던 안내는 그 자리에서 물러난다.
      get().clearConnectionHint();
    },

    onNodesChange: (changes) => {
      const removed = changes
        .filter((change) => change.type === "remove")
        .map((change) => change.id)
        .filter((id) => get().nodes.some((node) => node.id === id));
      // 사라진 노드에 붙어 있던 edge는 함께 사라진다 — 계약에 고아 edge는 존재할 수 없다.
      if (removed.length > 0) {
        get().runCommand(removeParts(scene(), { nodes: removed }));
      }

      const rest = changes.filter((change) => change.type !== "remove");
      if (rest.length === 0) return;

      const dragged = rest.filter((change) => change.type === "position");
      const origin =
        get().dragOrigin ??
        positionsOf(
          get().nodes,
          dragged.map((change) => change.id),
        );
      // 끄는 동안에만 줄을 맞춘다 — 맞은 줄은 안내선이 되어 손이 놓일 자리를 미리 보여준다.
      const aligned = alignmentWhileDragging(get().nodes, rest);
      const snapped = aligned
        ? rest.map((change) =>
            change === aligned.change
              ? { ...change, position: aligned.alignment.position }
              : change,
          )
        : rest;
      const nodes = applyNodeChanges(snapped, get().nodes);
      const dragEnded = dragged.some((change) => change.dragging !== true);
      set({
        nodes,
        dragOrigin: dragged.length > 0 && !dragEnded ? origin : null,
        alignmentGuides: aligned ? aligned.alignment.guides : [],
      });

      const moves = dragEnded ? movedSince(origin, nodes) : [];
      if (moves.length > 0) get().recordCommand(moveNodes(moves));
    },

    onEdgesChange: (changes) => {
      const removed = changes
        .filter((change) => change.type === "remove")
        .map((change) => change.id)
        .filter((id) => get().edges.some((edge) => edge.id === id));
      if (removed.length > 0) {
        get().runCommand(removeParts(scene(), { edges: removed }));
      }

      const rest = changes.filter((change) => change.type !== "remove");
      if (rest.length > 0) set({ edges: applyEdgeChanges(rest, get().edges) });
    },

    updateNodeConfig: (id, config, options) => {
      const node = get().nodes.find((candidate) => candidate.id === id);
      // 아무것도 달라지지 않은 편집은 되돌릴 것도 없다 — 다시하기 목록을 지우지 않는다.
      if (!node || changedFields(node.data.spec.config ?? {}, config).length === 0) return;
      get().runCommand(
        changeNodeConfig(
          scene(),
          id,
          config,
          get().spec?.input_schema,
          get().spec?.resources,
          options,
        ),
      );
    },

    updateEdgeKind: (id, kind) => {
      const edge = get().edges.find((candidate) => candidate.id === id);
      if (!edge || edge.data.kind === kind) return;
      get().runCommand(changeEdgeData(scene(), id, { ...edge.data, kind }));
    },

    updateEdgeCondition: (id, expression) => {
      const edge = get().edges.find((candidate) => candidate.id === id);
      if (!edge) return;
      // 사용자가 친 글자를 그대로 보관한다 — 공백만 남았을 때만 조건이 없는 것으로 본다.
      const data: FlowEdgeData =
        expression.trim() === ""
          ? { kind: edge.data.kind }
          : { kind: edge.data.kind, condition: { language: "cel", expression } };
      if (JSON.stringify(edge.data) === JSON.stringify(data)) return;
      get().runCommand(changeEdgeData(scene(), id, data));
    },

    arrangeNodes: () => {
      const at = new Map(
        arrangedPositions(scene()).map((placed) => [placed.id, placed.position]),
      );
      const moves = get().nodes.flatMap((node) => {
        const to = at.get(node.id);
        if (!to || (to.x === node.position.x && to.y === node.position.y)) return [];
        return [{ id: node.id, from: node.position, to }];
      });
      // 이미 정리된 캔버스를 다시 정리하는 것은 편집이 아니다.
      if (moves.length > 0) get().runCommand(moveNodes(moves));
    },

    renameSpec: (name) => {
      const called = name.trim();
      // 아직 아무 그래프도 열지 않았으면 이름 붙일 문서가 없다.
      if (get().spec === null) return;
      // 빈 이름은 이름이 아니다 — 계약도 받지 않는다.
      if (called === "" || called === (get().spec?.name ?? null)) return;
      get().runCommand(renameDoc(get().spec?.name ?? null, called));
    },
  };
};
