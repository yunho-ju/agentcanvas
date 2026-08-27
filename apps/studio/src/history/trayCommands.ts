// 노드를 캔버스와 보관함 사이에서 옮기는 편집들 — 빼는 것은 지우는 것이 아니다.
import { uniqueId } from "../graph/ids";
import type { Scene } from "../graph/scene";
import { msg } from "../i18n/messages";
import type { FlowNode } from "../graph/serialize";
import { type Command, doNothing } from "./command";
import { removeParts } from "./graphCommands";
import { placed, restored, withoutNode, withoutScreenState } from "./sceneParts";

/** 노드를 캔버스에서 빼 보관함에 넣는다 — 지우는 것이 아니라 옮기는 것이다. */
export function detachToTray(scene: Scene, nodeId: string): Command {
  const stored = scene.nodes.find((node) => node.id === nodeId);
  if (!stored) return doNothing;

  const removal = removeParts(scene, { nodes: [nodeId] });

  const item = withoutScreenState(stored);
  return {
    label: msg("edit.detach"),
    notice: msg("edit.detach.notice", { id: nodeId }),
    apply: (current) => ({ ...removal.apply(current), tray: [...current.tray, item] }),
    revert: (current) => ({
      ...removal.revert(current),
      tray: current.tray.filter((candidate) => candidate.id !== item.id),
    }),
  };
}

function renamed(node: FlowNode, id: string): FlowNode {
  return { ...node, id, data: { ...node.data, spec: { ...node.data.spec, id } } };
}

/** 보관함에 있던 노드를 다시 캔버스에 꽂는다. 이름이 이미 쓰이고 있으면 새 이름을 준다. */
export function restoreFromTray(scene: Scene, nodeId: string): Command {
  const stored = scene.tray.find((node) => node.id === nodeId);
  if (!stored) return doNothing;

  const id = uniqueId(
    stored.id,
    scene.nodes.map((node) => node.id),
  );
  const node = renamed(stored, id);
  // 보관함에서 어디에 있던 노드인지 기억한다 — 되돌리면 그 자리로 돌아가야 한다.
  const takenFrom = placed(scene.tray, [stored.id]);
  return {
    label: msg("edit.restore"),
    ...(id !== stored.id
      ? { notice: msg("edit.restore.renamed", { taken: stored.id, given: id }) }
      : {}),
    apply: (current) => ({
      ...current,
      nodes: [...current.nodes, node],
      tray: current.tray.filter((candidate) => candidate.id !== stored.id),
    }),
    revert: (current) => ({
      ...withoutNode(current, id),
      tray: restored(current.tray, takenFrom),
    }),
  };
}
