// 시험을 지어 달라고 서버에 부탁하는 문 — architect.ts·eval.ts와 같은 관례다.
// 실패는 던지지 않고 쉬운 말로 돌려주고, 봉투 타입의 원천은 eval/ 순수 모듈이다 (api → eval 한쪽으로만).
import { type SuggestOutcome, suggestionsOf } from "../eval/caseSuggestions";
import type { AgentSpec } from "../generated/agent_spec";
import { msg } from "../i18n/messages";
import { type SendRequest, type ServerOptions, UNREADABLE, apiBaseUrl, bodyOf } from "./http";

const OK = 200;

/** 시험을 지어 주는 모델의 이름 — Architect와 같은 자리를 쓴다. */
export const SUGGEST_MODEL_REF = "model://openai";

export type CaseSuggestionApiOptions = ServerOptions;

/** 이 그래프를 읽고 시험 케이스를 지어 달라고 청한다 — 성공해도 서버는 아무것도 저장하지 않는다. */
export async function suggestCasesOnServer(
  spec: AgentSpec,
  howMany: number,
  includeEdgeCases: boolean,
  existingTitles: string[],
  options: CaseSuggestionApiOptions = {},
): Promise<SuggestOutcome> {
  const base = options.baseUrl ?? apiBaseUrl();
  const send = options.fetch ?? (globalThis.fetch as SendRequest);
  try {
    const answered = await send(`${base}/eval/case-suggestions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model_ref: SUGGEST_MODEL_REF,
        spec,
        how_many: howMany,
        include_edge_cases: includeEdgeCases,
        existing_titles: existingTitles,
      }),
    });
    const body = await bodyOf(answered);
    if (answered.status !== OK || body === UNREADABLE) return { failure: msg("eval.suggest.failed") };
    const payload = suggestionsOf(body);
    return payload ? { payload } : { failure: msg("eval.suggest.failed") };
  } catch {
    return { failure: msg("eval.suggest.offline") };
  }
}
