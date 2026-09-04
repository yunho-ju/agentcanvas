import type { AgentSpecPatch } from "../src/generated/agent_spec_patch";
import type { AgentSpec } from "../src/generated/agent_spec";
import type { ArchitectDraftOutcome } from "../src/api/architect";
import { CHAT_SAID_BINDING } from "../src/chat/chatEntry";

/** 서버가 만드는 초안을 흉내 낸 시험용 그래프 — 제품 경로에는 없다(서버가 보내 준다).
 *
 * 사람 말이 들어오는 자리 이름은 서버 시드와 같은 계약에서 읽는다: 여기서 손으로 적으면
 * 시험만 통과하고 화면은 대화하지 못하는 판을 만들 수 있다. */
export function makeArchitectSpec(request: string, draftId: string): AgentSpec {
  return {
    schema_version: "agent.spec/v1",
    id: draftId,
    version: 1,
    revision: `sha256:${"0".repeat(64)}`,
    status: "draft",
    input_schema: {
      type: "object",
      required: [CHAT_SAID_BINDING],
      properties: { [CHAT_SAID_BINDING]: { type: "string" } },
    },
    state_schema: { type: "object", properties: { answer: { type: "string" } } },
    nodes: [
      {
        id: "core-input",
        type: "core.input",
        position: { x: 0, y: 0 },
        config: { bindings: { [CHAT_SAID_BINDING]: `input.${CHAT_SAID_BINDING}` } },
      },
      { id: "llm-router", type: "llm.router", position: { x: 280, y: 0 }, config: { instruction: request, model_ref: "model://default" } },
      { id: "llm-agent", type: "llm.agent", position: { x: 560, y: 0 }, config: { instruction: request, model_ref: "model://default" } },
      { id: "core-output", type: "core.output", position: { x: 840, y: 0 }, config: { binding: "state.answer" } },
    ],
    edges: [
      { id: "edge-input-router", kind: "data", source: { node: "core-input", port: CHAT_SAID_BINDING }, target: { node: "llm-router", port: "input" } },
      { id: "edge-router-agent", kind: "control", source: { node: "llm-router", port: "passthrough" }, target: { node: "llm-agent", port: "messages" } },
      { id: "edge-agent-output", kind: "data", source: { node: "llm-agent", port: "response" }, target: { node: "core-output", port: "input" } },
    ],
  };
}

/** UI/store 테스트는 provider transport만 대체하고, server candidate review는 그대로 탄다. */
export async function providerDraftFixture(
  request: string,
  draftId: string,
): Promise<ArchitectDraftOutcome> {
  const draft = makeArchitectSpec(request, draftId);
  const patch = {
    schema_version: "agent.patch/v1",
    base_revision: draft.revision,
    operations: [
      {
        op: "add_node",
        node: {
          id: "fixture-node",
          type: "llm.agent",
          position: { x: 1, y: 1 },
          config: { model_ref: "model://default" },
        },
      },
    ],
  } satisfies AgentSpecPatch;
  return { draft, patch, issues: [] };
}

/** 아직 못 채운 칸이 있는 초안 — 서버가 채우지 못한 값은 사람이 채워야 한다. */
export async function draftWithAnEmptySettingFixture(
  request: string,
  draftId: string,
): Promise<ArchitectDraftOutcome> {
  const outcome = await providerDraftFixture(request, draftId);
  if (!outcome.draft) return outcome;
  return {
    ...outcome,
    draft: {
      ...outcome.draft,
      nodes: outcome.draft.nodes.map((node) =>
        node.id === "llm-agent" ? { ...node, config: { ...node.config, model_ref: "" } } : node,
      ),
    },
  };
}

/** 초안이 skill을 고른 경우 — 서버가 그 skill을 문서에 함께 넣어 보낸다 (SK-4). */
export async function draftWearingASkillFixture(
  request: string,
  draftId: string,
): Promise<ArchitectDraftOutcome> {
  const outcome = await providerDraftFixture(request, draftId);
  if (!outcome.draft) return outcome;
  return {
    ...outcome,
    droppedSkillRefs: ["skill://made-up@1"],
    draft: {
      ...outcome.draft,
      skills: [
        {
          ref: "skill://plain-answer@1",
          name: "plain-answer",
          description: "Use when the reader is not an expert.",
          body: "Say it plainly.\n",
          license: null,
          compatibility: null,
          metadata: {},
          references: [],
          source: null,
        },
      ],
      nodes: outcome.draft.nodes.map((node) =>
        node.id === "llm-agent"
          ? { ...node, config: { ...node.config, skill_refs: ["skill://plain-answer@1"] } }
          : node,
      ),
    },
  };
}

/** 두 단계가 저마다 skill을 따르는 초안 — 줄이 어느 단계의 것인지 말할 수 있어야 한다. */
export async function draftWithTwoStepsWearingSkillsFixture(
  request: string,
  draftId: string,
): Promise<ArchitectDraftOutcome> {
  const outcome = await draftWearingASkillFixture(request, draftId);
  if (!outcome.draft) return outcome;
  const wearing = outcome.draft.nodes.find((node) => node.id === "llm-agent");
  if (!wearing) return outcome;
  return {
    ...outcome,
    draft: {
      ...outcome.draft,
      nodes: [...outcome.draft.nodes, { ...wearing, id: "llm-checker" }],
    },
  };
}

/** 사람 확인 카드가 든 초안 — 가짜 실행은 여기서 멈춘 뒤 승인으로 이어 걸어야 한다 (DESIGN §7). */
export function withAHumanGate(spec: AgentSpec, gateId = "answer-gate"): AgentSpec {
  return {
    ...spec,
    nodes: [
      ...spec.nodes,
      {
        id: gateId,
        type: "control.human_gate",
        position: { x: 1120, y: 0 },
        config: { approval_schema_ref: "schema://answer-review@1" },
      },
    ],
    edges: [
      ...spec.edges.filter((edge) => edge.target.node !== "core-output"),
      { id: `edge-agent-${gateId}`, kind: "approval", source: { node: "llm-agent", port: "response" }, target: { node: gateId, port: "review" } },
      { id: `edge-${gateId}-output`, kind: "control", source: { node: gateId, port: "approved" }, target: { node: "core-output", port: "input" } },
    ],
  };
}
