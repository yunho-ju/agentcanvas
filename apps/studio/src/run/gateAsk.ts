// 밸브가 무엇을 묻고 있는가 — 어떤 양식을 요구했고, 어느 도구를 승인하라는 것인지 (순수 함수).
// 무엇을 물을지는 화면의 사정이 아니라 RunEvent의 사실이다. 실행 화면과 대화 화면이
// 이 한 자리를 함께 본다 — 같은 밸브가 두 화면에서 다른 말을 하지 않게 한다.
import type { LocalizedText, Resources } from "../generated/agent_spec";
import type { RunEvent } from "../generated/run_event";

/** 지금 기다리는 확인이 어느 도구 호출을 위한 것인가 — 도구 승인이 아니면 없다. */
export interface GateToolAsk {
  toolName: string;
  plainDescription?: LocalizedText;
}

/** 그 노드가 마지막으로 청한 확인 — 없으면 없음. */
function askedAt(events: RunEvent[], nodeId: string): RunEvent | undefined {
  return events
    .filter(
      (event) =>
        event.event_type === "human.approval_requested" && event.node_id === nodeId,
    )
    .at(-1);
}

/** 그 밸브가 요구한 입력 양식의 이름 — 아무도 기다리지 않거나 적히지 않았으면 빈 이름이다. */
export function gateSchemaRefIn(events: RunEvent[], nodeId: string): string {
  const ref = askedAt(events, nodeId)?.payload.approval_schema_ref;
  return typeof ref === "string" ? ref : "";
}

/**
 * 도구를 부르기 전 사람 확인이라면, 무엇을 승인하는지 — 어느 도구이고 무엇을 하는지.
 * 밸브(control.human_gate) 승인이면 도구가 없으므로 없음을 답한다.
 */
export function gateToolAskIn(
  events: RunEvent[],
  nodeId: string,
  resources: Resources,
): GateToolAsk | null {
  const asked = askedAt(events, nodeId);
  const toolName = asked?.payload.tool_name;
  const resourceRef = asked?.payload.resource_ref;
  if (typeof toolName !== "string" || typeof resourceRef !== "string") return null;
  const tool = (resources ?? [])
    .find((binding) => binding.id === resourceRef)
    ?.tools?.find((one) => one.name === toolName);
  return {
    toolName,
    ...(tool?.plain_description ? { plainDescription: tool.plain_description } : {}),
  };
}
