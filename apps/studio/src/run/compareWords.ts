// 견주는 화면이 읽어 주는 말 — 단계 하나를 사람이 읽는 한 줄로 옮긴다.
// 무슨 일이 있었는지는 이벤트가 정하고, 여기서는 그것을 어떻게 말할지만 정한다.
import type { Locale } from "../i18n/locale";
import { msg, translate } from "../i18n/messages";
import type { RunStep } from "./compareRuns";
import { STATUS_WORDS } from "./statusWords";

/** 단계 한 줄 — 기호와 말이 언제나 함께 간다 (색만으로 말하지 않는다). */
export interface StepWords {
  mark: string;
  line: string;
}

export function stepWords(step: RunStep, locale: Locale): StepWords {
  const status = STATUS_WORDS[step.status];
  return {
    mark: status.mark,
    line: translate(locale, msg("compare.step", { node: step.nodeId, what: status.label })),
  };
}
