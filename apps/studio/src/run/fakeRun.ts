// 진짜 모델을 부르지 않고도 그래프가 움직이는 것을 보여 주는 실행 — 계약 그대로의 RunEvent를 만든다 (순수 함수).
// 시계와 실행 이름은 밖에서 받는다: 같은 spec과 같은 시작 시각이면 언제나 같은 이벤트가 나온다.
// 앱은 이제 이 실행을 돌리지 않는다 — 실행은 서버의 것이다(api/runs). 이 파일은 서버의 파이썬
// 미러(agentcanvas_engine.fake_runtime)가 지키는 규칙의 원본이고, 골든 파일도 여기서 나온다.
import type { AgentSpec, Edge as SpecEdge, Node1 as SpecNode } from "../generated/agent_spec";
import type { EventType, RunEvent } from "../generated/run_event";
import { flowOrder } from "../graph/order";
import { nodeTypes, skillRefs } from "../registry/registry";

export interface FakeRunOptions {
  /** 이 실행을 가리키는 이름 */
  runId: string;
  /** 실행이 시작된 시각 — 이벤트 시각은 여기서부터 한 박자씩 흐른다 */
  startedAt: Date;
}

/** 이벤트 사이의 간격. 가짜 실행은 일정한 박자로 흐른다. */
export const EVENT_STEP_MS = 400;

/** 가짜 실행이 지어내는 숫자들 — 진짜 모델을 부르지 않았다는 뜻으로 언제나 같은 값이다. */
const FAKE_PROMPT_TOKENS = 512;
const FAKE_ANSWER_TOKENS = 128;

/** 아직 순번과 시각이 붙지 않은 사건 하나. */
interface Emission {
  event_type: EventType;
  payload: Record<string, unknown>;
  /** 어느 노드의 일인가 — 실행 전체의 일이면 비운다 */
  nodeId?: string;
}

/** 노드가 일하는 동안 무슨 일이 일어나는가 — 문서를 함께 받는다(입은 skill은 문서에 있다). */
type Work = (node: SpecNode, spec: AgentSpec) => Emission[];

function refOf(node: SpecNode, key: string, fallback: string): string {
  const value = node.config?.[key];
  return typeof value === "string" ? value : fallback;
}

/**
 * 이 걸음이 실제로 따르는 skill의 이름표 — 입은 순서 그대로, 문서가 가진 것만, 한 벌씩만.
 * 문서에 없는 이름표는 따를 수 없으므로 적지 않는다 (파이썬 `skills_worn_by`와 같은 판정).
 */
function skillsFollowedBy(node: SpecNode, spec: AgentSpec): string[] {
  const nodeType = nodeTypes[node.type];
  if (!nodeType) return [];
  const held = new Set((spec.skills ?? []).map((skill) => skill.ref));
  return [...new Set(skillRefs(node, nodeType))].filter((ref) => held.has(ref));
}

/** 따른 skill이 사건에 적히는 모습 — 따른 것이 없으면 그 자리도 없다(옛 기록과 같은 모양). */
function followedSkills(refs: string[]): Record<string, unknown> {
  return refs.length === 0 ? {} : { skill_refs: refs };
}

/** 모델에게 물어보는 노드: 프롬프트를 만들고, 물어보고, 답을 받는다. */
const asksAModel: Work = (node, spec) => {
  const promptRef = refOf(node, "prompt_ref", `prompt://${node.id}@1`);
  const modelRef = refOf(node, "model_ref", "model://default");
  const followed = followedSkills(skillsFollowedBy(node, spec));
  return [
    {
      event_type: "prompt.compiled",
      payload: {
        prompt_ref: promptRef,
        blocks: [{ id: "system-role", included: true, token_count: FAKE_PROMPT_TOKENS }],
        total_tokens: FAKE_PROMPT_TOKENS,
      },
    },
    { event_type: "llm.requested", payload: { model_ref: modelRef, ...followed } },
    {
      event_type: "llm.completed",
      payload: { model_ref: modelRef, output_tokens: FAKE_ANSWER_TOKENS },
    },
  ];
};

/**
 * 사람에게 물어보는 노드: 확인을 청하고 흐름을 멈춘다.
 * 멈춤과 재개 사이에서 시퀀스가 끊긴다 — 뒤 이벤트는 사람이 답한 뒤에야 생긴다 (설계 §11).
 */
const waitsForAPerson: Work = (node) => [
  {
    event_type: "human.approval_requested",
    payload: {
      approval_schema_ref: refOf(node, "approval_schema_ref", `schema://${node.id}@1`),
    },
  },
  { event_type: "run.paused", payload: { waiting_for: node.id } },
  { event_type: "run.resumed", payload: { waiting_for: node.id } },
];

/**
 * 노드 타입마다 실행 중에 일어나는 일 — 새 타입을 흉내 내려면 여기 한 줄을 더한다.
 * 표에 없는 타입은 일을 하고 끝날 뿐 따로 남기는 이벤트가 없다.
 */
const WORK_BY_NODE_TYPE: Record<string, Work> = {
  "llm.router": asksAModel,
  "llm.agent": asksAModel,
  "control.human_gate": waitsForAPerson,
};

function workOf(node: SpecNode, spec: AgentSpec): Emission[] {
  return (WORK_BY_NODE_TYPE[node.type] ?? (() => []))(node, spec);
}

/**
 * 연결을 건너간 값이 상태에 적히는 일.
 * 어느 한 노드의 사건이 아니라 실행 상태의 사건이므로 node_id를 달지 않는다.
 */
function statePatch(edge: SpecEdge): Emission {
  return {
    event_type: "state.patch",
    payload: {
      edge_id: edge.id,
      from: edge.source.node,
      to: edge.target.node,
      patch: [
        {
          op: "replace",
          path: `/${edge.target.port}`,
          // payload는 기계가 주고받는 자리다 — 화면 문구가 아니므로 언어를 타지 않는 값으로 둔다.
          value: `result of ${edge.source.node}.${edge.source.port}`,
        },
      ],
    },
  };
}

/**
 * 이 그래프가 기억하는 상태의 이름들.
 * 상태에 없는 이름으로는 값을 적을 수 없다 — 없는 자리에 쓴 patch는 가짜 상태를 지어내는 것이다.
 */
function stateKeys(spec: AgentSpec): Set<string> {
  const properties = spec.state_schema?.properties;
  const known =
    typeof properties === "object" && properties !== null && !Array.isArray(properties)
      ? properties
      : {};
  return new Set(Object.keys(known));
}

/** 노드 하나가 일을 맡아 끝내고, 그 결과가 이어진 연결을 건너가기까지. */
function nodeEmissions(node: SpecNode, spec: AgentSpec): Emission[] {
  const own: Emission[] = [
    { event_type: "node.queued", payload: { node_type: node.type } },
    { event_type: "node.started", payload: { node_type: node.type } },
    ...workOf(node, spec),
    { event_type: "node.completed", payload: { node_type: node.type } },
  ];
  const kept = stateKeys(spec);
  return [
    ...own.map((emission) => ({ ...emission, nodeId: node.id })),
    ...spec.edges
      .filter((edge) => edge.source.node === node.id && kept.has(edge.target.port))
      .map(statePatch),
  ];
}

/**
 * 사람이 밸브 앞에서 내린 답 — 승인은 흐름을 다시 열고, 거절은 흐름을 거기서 마친다.
 * 승인하며 적어 넣은 값이 있으면 그 답과 함께 실행에 남는다.
 */
export interface GateApproval {
  approved: boolean;
  values?: Record<string, unknown>;
}

/**
 * 밸브에 닿으면 시퀀스는 거기서 끊긴다 — 멈춘 사건까지만 세상에 나온다.
 * 아직 밸브를 만나지 않았다면 남은 사건이 그대로 흐른다.
 */
function untilTheValve(events: RunEvent[], from: number): RunEvent[] {
  const rest = events.slice(from);
  const held = rest.findIndex((event) => event.event_type === "run.paused");
  return held === -1 ? rest : rest.slice(0, held + 1);
}

/** 승인은 흐름이 다시 열린 사건에 적힌다 — 무엇을 허락해 다시 흐르는가. */
function recordApproval(events: RunEvent[], approval: GateApproval): RunEvent[] {
  return events.map((event) =>
    event.event_type === "run.resumed"
      ? { ...event, payload: { ...event.payload, ...approval } }
      : event,
  );
}

/** AgentSpec 하나를 처음부터 끝까지 흉내 내어 실행한 이벤트들 — 밸브에 닿으면 거기까지. */
export function fakeRun(spec: AgentSpec, options: FakeRunOptions): RunEvent[] {
  return untilTheValve(wholeRun(spec, options), 0);
}

/** 이 실행에서 실제로 일을 마친 노드의 수 — 끝까지 가지 못한 실행은 그래프보다 적다. */
function nodesThatWorked(events: RunEvent[]): number {
  return new Set(
    events
      .filter((event) => event.event_type === "node.completed")
      .map((event) => event.node_id),
  ).size;
}

/**
 * 사람이 거절하면 흐름은 그 자리에서 마친다 — 기다리던 노드가 일을 마치고 실행이 닫힌다.
 * 뒤에 선 노드들은 한 걸음도 움직이지 않는다 (거절은 실패가 아니라 다른 결말이다).
 */
function refusal(spec: AgentSpec, events: RunEvent[], approval: GateApproval): Emission[] {
  const nodeId = events.at(-1)?.node_id ?? undefined;
  const node = spec.nodes.find((candidate) => candidate.id === nodeId);
  const finished: Emission[] = node
    ? [
        {
          event_type: "node.completed",
          payload: { node_type: node.type, ...approval },
          nodeId: node.id,
        },
      ]
    : [];
  return [
    {
      event_type: "run.resumed",
      payload: { waiting_for: nodeId, ...approval },
      ...(nodeId ? { nodeId } : {}),
    },
    ...finished,
    {
      event_type: "run.completed",
      payload: { node_count: nodesThatWorked(events) + finished.length },
    },
  ];
}

/**
 * 밸브 앞에 멈춰 선 실행에 사람이 답한다 — 지금까지의 이벤트에 그 뒤를 잇는다.
 * 승인이면 다음 밸브(또는 끝)까지 흐르고, 거절이면 그 자리에서 실행을 마친다.
 * 이미 흐르고 있는(멈춰 있지 않은) 실행에는 아무 일도 일어나지 않는다.
 */
export function resumeFakeRun(
  spec: AgentSpec,
  events: RunEvent[],
  approval: GateApproval,
): RunEvent[] {
  const held = events.at(-1);
  if (!held || held.event_type !== "run.paused") return events;
  const options = {
    runId: events[0].run_id,
    startedAt: new Date(events[0].timestamp),
  };
  if (!approval.approved) {
    return [
      ...events,
      ...stamped(spec, options, refusal(spec, events, approval), events.length),
    ];
  }
  const whole = wholeRun(spec, options);
  return [...events, ...recordApproval(untilTheValve(whole, events.length), approval)];
}

/**
 * 아직 순번과 시각이 없는 사건들에 그것을 매긴다 — 실행은 일정한 박자로 흐른다.
 * `from`은 이미 세상에 나온 사건의 수다: 이어 붙이는 사건은 그 뒤 박자에서 시작한다.
 */
function stamped(
  spec: AgentSpec,
  options: FakeRunOptions,
  emissions: Emission[],
  from = 0,
): RunEvent[] {
  return emissions.map(({ event_type, payload, nodeId }, index) => {
    const seq = from + index;
    return {
      seq,
      run_id: options.runId,
      event_type,
      timestamp: new Date(options.startedAt.getTime() + seq * EVENT_STEP_MS).toISOString(),
      spec_revision: spec.revision,
      payload,
      ...(nodeId ? { node_id: nodeId } : {}),
    };
  });
}

/** 아무도 멈춰 세우지 않았을 때의 실행 전체 — 여기서 밸브까지를 잘라 내보낸다. */
function wholeRun(spec: AgentSpec, options: FakeRunOptions): RunEvent[] {
  const byId = new Map(spec.nodes.map((node) => [node.id, node]));
  const order = flowOrder({
    nodes: spec.nodes,
    edges: spec.edges.map((edge) => ({
      source: edge.source.node,
      target: edge.target.node,
    })),
  });

  const emissions: Emission[] = [
    { event_type: "run.started", payload: { spec_id: spec.id } },
    ...order.flatMap((id) => {
      const node = byId.get(id);
      return node ? nodeEmissions(node, spec) : [];
    }),
    { event_type: "run.completed", payload: { node_count: spec.nodes.length } },
  ];

  return stamped(spec, options, emissions);
}
