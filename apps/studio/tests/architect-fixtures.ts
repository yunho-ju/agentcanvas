import type { AgentSpecPatch } from "../src/generated/agent_spec_patch";
import { makeArchitectSpec } from "../src/architect/architect";
import type { ArchitectDraftOutcome } from "../src/api/architect";

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
