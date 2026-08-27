// 되돌리기/다시하기 — 명령을 쌓고 되감는 일만 한다 (Command 패턴, 외부 라이브러리 없음).
import type { StateCreator } from "zustand";
import type { AgentSpec } from "../generated/agent_spec";
import { type Scene, sceneOf } from "../graph/scene";
import type { Message } from "../i18n/messages";
import {
  type Command,
  changesNothing,
  merged as mergedCommand,
} from "../history/command";
import type { EditorState } from "./editor";
import { isRunning } from "./runSlice";

export interface HistorySlice {
  undoStack: Command[];
  redoStack: Command[];
  /** 편집의 부수 효과를 사용자에게 알리는 한 문장. 사용자가 닫거나 다음 알림이 올 때까지 남는다 */
  notice: Message | null;
  /** 직전에 실행한 명령의 병합 이름 — 잇따른 편집만 한 걸음으로 합치기 위한 표시 */
  lastMergeKey: string | null;
  /** 명령을 실행하고 되돌리기 목록에 쌓는다 */
  runCommand: (command: Command) => void;
  /** 캔버스가 이미 수행한 편집(드래그)을 되돌릴 수 있게 기록만 한다 */
  recordCommand: (command: Command) => void;
  undo: () => void;
  redo: () => void;
  dismissNotice: () => void;
}

export const createHistorySlice: StateCreator<EditorState, [], [], HistorySlice> = (
  set,
  get,
) => {
  /** 되돌리기가 다룬 것들을 화면의 상태로 옮긴다 — 이름은 문서(spec)에 적힌다. */
  const applied = (next: Scene) => ({
    nodes: next.nodes,
    edges: next.edges,
    tray: next.tray,
    // 이름 칸은 이름이 없어도 자리를 지킨다 — 서버도 늘 그 자리를 적어 보낸다.
    ...(get().spec ? { spec: { ...(get().spec as AgentSpec), name: next.name } } : {}),
  });

  const scene = (): Scene => sceneOf(get());

  return {
    undoStack: [],
    redoStack: [],
    notice: null,
    lastMergeKey: null,

    runCommand: (command) => {
      // 실행을 보는 동안 그래프는 잠겨 있다 — 재생 중인 이벤트는 지금의 그래프에서 나온 것이어야 한다.
      if (isRunning(get())) return;
      // 아무것도 하지 않은 편집은 되돌릴 것도, 다시 할 것을 버릴 이유도 없다.
      if (changesNothing(command)) return;
      const next = command.apply(scene());
      const previous = get().undoStack.at(-1);
      // 바로 앞 편집과 같은 이름이면 한 걸음으로 합친다 (한 글자씩 친 텍스트).
      const joins =
        previous !== undefined &&
        command.mergeKey !== undefined &&
        command.mergeKey === get().lastMergeKey;
      const stack = joins
        ? [...get().undoStack.slice(0, -1), mergedCommand(previous, command)]
        : [...get().undoStack, command];

      set({
        ...applied(next),
        undoStack: stack,
        redoStack: [],
        lastMergeKey: command.mergeKey ?? null,
        ...(command.notice ? { notice: command.notice } : {}),
      });
    },

    recordCommand: (command) => {
      if (isRunning(get())) return;
      set({
        undoStack: [...get().undoStack, command],
        redoStack: [],
        lastMergeKey: null,
      });
    },

    undo: () => {
      if (isRunning(get())) return;
      const command = get().undoStack.at(-1);
      if (!command) return;
      const next = command.revert(scene());
      set({
        ...applied(next),
        undoStack: get().undoStack.slice(0, -1),
        redoStack: [...get().redoStack, command],
        lastMergeKey: null,
      });
    },

    redo: () => {
      if (isRunning(get())) return;
      const command = get().redoStack.at(-1);
      if (!command) return;
      const next = command.apply(scene());
      set({
        ...applied(next),
        redoStack: get().redoStack.slice(0, -1),
        undoStack: [...get().undoStack, command],
        lastMergeKey: null,
        ...(command.notice ? { notice: command.notice } : {}),
      });
    },

    dismissNotice: () => set({ notice: null }),
  };
};
