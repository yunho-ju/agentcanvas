import type { ComponentType } from "react";
import type { EditOptions } from "../../history/graphCommands";
import type { FormField } from "../schemaForm";

export interface ControlProps {
  field: FormField;
  value: unknown;
  /**
   * undefined를 주면 config에서 그 값을 지운다.
   * 이어진 편집을 한 걸음으로 합칠지는 편집마다 정한다 (기본은 합침 — 글자는 이어 적힌다).
   */
  onChange: (value: unknown, options?: EditOptions) => void;
  id: string;
  describedBy?: string;
  invalid: boolean;
  /** 지금은 손댈 수 없는 칸 — 까닭은 보이는 줄이 말하고, title이 거든다 */
  disabled?: boolean;
  title?: string;
  /** 비어 있을 때 그 자리가 뜻하는 값 */
  placeholder?: string;
}

export interface ControlEntry {
  Component: ComponentType<ControlProps>;
  /** 스스로 라벨을 붙이는 편집기 (여러 입력 상자를 품는 경우) */
  selfLabelled?: boolean;
}
