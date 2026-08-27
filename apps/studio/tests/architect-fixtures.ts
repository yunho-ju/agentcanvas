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
