// 편집 하나 = 명령 하나. 명령은 스스로를 되돌릴 줄 안다 (Command 패턴).
// 여기에는 명령이 무엇인가와 명령끼리 합치는 규칙만 있다 — 무엇을 바꾸는지는 각 명령 모듈이 안다.
import type { Scene } from "../graph/scene";
import { type Message, msg } from "../i18n/messages";

export interface Command {
  /** 사용자가 "되돌리기" 앞에 붙여 읽을 쉬운 이름 */
  readonly label: Message;
  /** 이 편집이 사용자에게 알려야 할 부수 효과 */
  readonly notice?: Message;
  /**
   * 바로 앞 편집과 한 걸음으로 합쳐도 되는 편집인지 알려주는 이름.
   * 같은 이름이 잇따라 오면 한 번의 되돌리기로 함께 되돌아간다 (한 글자씩 친 텍스트).
   */
  readonly mergeKey?: string;
  apply(scene: Scene): Scene;
  revert(scene: Scene): Scene;
}

/**
 * 잇따른 두 편집을 한 걸음으로 합친다.
 * 합쳐진 걸음은 "첫 편집 직전"으로 되돌아가고 "마지막 편집 직후"로 다시 간다.
 * 값을 통째로 덮어쓰는 명령(mergeKey를 가진 명령)만 이렇게 합칠 수 있다.
 */
export function merged(previous: Command, next: Command): Command {
  return {
    label: next.label,
    ...(next.notice ?? previous.notice
      ? { notice: next.notice ?? previous.notice }
      : {}),
    mergeKey: next.mergeKey,
    apply: (scene) => next.apply(scene),
    revert: (scene) => previous.revert(scene),
  };
}

/** 할 일이 없는 요청 — 해도 되돌려도 장면은 그대로다. */
export const doNothing: Command = {
  label: msg("edit.nothing"),
  apply: (scene) => scene,
  revert: (scene) => scene,
};

/** 되돌리기 목록에 올릴 것이 없는 명령인가 — 아무것도 하지 않은 편집은 걸음이 아니다. */
export function changesNothing(command: Command): boolean {
  return command === doNothing;
}
