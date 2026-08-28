// 문서 자체를 바꾸는 편집 — 이름과 연결. 다른 편집과 같은 되돌리기 목록에 쌓인다.
import type { ResourceBinding } from "../generated/agent_spec";
import { msg } from "../i18n/messages";
import type { Command } from "./command";

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
