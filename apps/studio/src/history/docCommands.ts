// 문서 자체를 바꾸는 편집 — 지금은 이름 하나다. 다른 편집과 같은 되돌리기 목록에 쌓인다.
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
