// 문서 자체를 바꾸는 편집 — 이름과 연결. 다른 편집과 같은 되돌리기 목록에 쌓인다.
import type { ResourceBinding } from "../generated/agent_spec";
import { withSwappedConnection } from "../graph/config";
import { nodesUsing, withConnection, withoutConnection } from "../graph/connections";
import { breaksNothing, impactBetween } from "../graph/impact";
import { impactLines } from "../graph/impactWords";
import type { Scene } from "../graph/scene";
import type { JsonSchema } from "../registry/registry";
import { type Message, msg } from "../i18n/messages";
import { type Command, doNothing } from "./command";

/** 문서 이름을 바꾼다. 되돌리면 부르던 이름으로 돌아간다. */
export function renameDoc(from: string | null, to: string | null): Command {
  return {
    label: msg("edit.rename"),
    apply: (scene) => ({ ...scene, name: to }),
    revert: (scene) => ({ ...scene, name: from }),
  };
}

/** 승인한 연결 목록을 문서에 들인다. 승인 1회 = 되돌리기 한 걸음이다. */
export function takeInConnections(
  from: ResourceBinding[],
  to: ResourceBinding[],
): Command {
  return {
    label: msg("edit.takeInConnection"),
    apply: (scene) => ({ ...scene, resources: to }),
    revert: (scene) => ({ ...scene, resources: from }),
  };
}

/**
 * 연결 하나를 문서에서 뺀다 — 서버에 물을 것도, patch도 없는 로컬 편집이다.
 * 구조(노드·연결선)는 그대로 두고, 그 연결을 쓰던 노드가 있으면 그 사실만 말한다.
 * 무엇이 틀렸는지는 기존 validator와 노드 뱃지가 이어서 말한다.
 */
export function dropConnection(
  current: ResourceBinding[],
  id: string,
  losing: string[] = [],
): Command {
  if (!current.some((binding) => binding.id === id)) return doNothing;
  const left = withoutConnection(current, id);
  const notice: Message | undefined =
    losing.length === 0
      ? undefined
      : msg("edit.dropConnection.notice", { id, nodes: losing.join(", ") });
  return {
    label: msg("edit.dropConnection"),
    ...(notice ? { notice } : {}),
    apply: (scene) => ({ ...scene, resources: left }),
    revert: (scene) => ({ ...scene, resources: current }),
  };
}

/**
 * 다시 가져온 연결 하나를 그 자리에서 갈아 끼운다. 승인 1회 = 되돌리기 한 걸음이다.
 * 그 연결을 쓰던 노드의 포트는 새 도구의 모양으로 다시 그려지고, 그 때문에 어긋나
 * 끊어지는 연결선은 기존 설정 변경 경로(checkConnection)가 판정해 그 사실을 말한다.
 */
export function swapConnection(
  scene: Scene,
  swapped: ResourceBinding,
  inputSchema?: JsonSchema,
): Command {
  const wasConnections = scene.resources;
  if (!wasConnections.some((binding) => binding.id === swapped.id)) return doNothing;
  const nextConnections = withConnection(wasConnections, swapped);

  // 그 연결을 쓰던 노드의 포트는 새 도구의 모양이 된다 — 판정도, 끊기는 연결선도
  // 설정을 바꿀 때 쓰던 그 자리의 답이다 (새 판정 없음).
  const change = withSwappedConnection(
    { nodes: scene.nodes, edges: scene.edges },
    nodesUsing(scene.nodes, swapped.id),
    wasConnections,
    nextConnections,
    inputSchema,
  );
  const nextGraph = change.graph;
  // 무엇을 잃는가는 노드를 뺄 때·설정을 바꿀 때 쓰던 그 분석기가 잰다 —
  // 끊어진 연결선뿐 아니라 그 때문에 값이 닿지 않게 된 노드까지 함께 말한다.
  const wasGraph = { nodes: scene.nodes, edges: scene.edges };
  const impact = impactBetween(wasGraph, nextGraph);
  return {
    label: msg("edit.reimportConnection"),
    ...(breaksNothing(impact)
      ? {}
      : {
          notice: msg("edit.reimportConnection.notice", {
            id: swapped.id,
            impact: impactLines(impact, "did"),
          }),
        }),
    apply: (current) => ({ ...current, resources: nextConnections, ...nextGraph }),
    revert: (current) => ({ ...current, resources: wasConnections, ...wasGraph }),
  };
}
