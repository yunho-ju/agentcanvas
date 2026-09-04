// 피커가 내놓을 모델 목록 — 이 서버가 말한 사정과 제품이 싣고 다니는 목록을 합치는 규칙.
// 계약의 미러(modelCatalog.ts)는 "제품이 아는 모델"이고, 여기는 "지금 이 서버에서 고를 수
// 있는 것"이다 — 서버에 물어보지 못했으면 아무것도 막지 않는다(fail-open, 판정 층 선례와 같다).
import type { LocalizedText } from "../generated/model_def";
import { MODEL_CATALOG } from "./modelCatalog";

/** 고를 수 있는 모델 하나 — 서버가 말한 것도, 화면이 내놓는 것도 같은 모양이다. */
export interface ModelChoice {
  ref: string;
  title: LocalizedText;
  /** 이 서버가 지금 이 모델을 부를 수 있는가 */
  callable: boolean;
  /** 부를 수 없는 까닭 — 부를 수 있으면 없다 */
  reason: string | null;
  /** 이 모델에게 도구를 건넬 수 있는가 — 서버가 말하지 않았으면 모른다 */
  toolCalling?: boolean;
}

/** 이 서버가 도는 자리 — 진짜 모델에게 묻거나(live), 연습용 답으로 돌거나(stand_in). */
export type RunMode = "live" | "stand_in";

/** 서버가 말한 제 사정 전부 — 어떤 자리로 도는지와, 아는 모델들. */
export interface ServerCatalog {
  mode: RunMode;
  models: ModelChoice[];
}

/** 셀렉트 위에 한 줄로 말할 것 — 말할 것이 없으면 없다. */
export type PickerNote = "stand_in" | "none_callable" | null;

export interface ModelPicking {
  options: ModelChoice[];
  note: PickerNote;
}

const RUN_MODES: RunMode[] = ["live", "stand_in"];

/**
 * 서버 답을 읽는다 — 모양이 어긋나면 아는 척하지 않고 모른다고 한다(null).
 * 모른다는 답은 "부를 수 없다"와 다르다: 부르는 쪽이 예전 목록으로 되돌아가는 신호다.
 */
export function serverCatalogOf(body: unknown): ServerCatalog | null {
  if (!body || typeof body !== "object") return null;
  const said = body as { mode?: unknown; models?: unknown };
  if (!RUN_MODES.includes(said.mode as RunMode)) return null;
  if (!Array.isArray(said.models)) return null;
  const models: ModelChoice[] = [];
  for (const item of said.models) {
    const model = asModelChoice(item);
    if (model === null) return null;
    models.push(model);
  }
  return { mode: said.mode as RunMode, models };
}

function asModelChoice(item: unknown): ModelChoice | null {
  if (!item || typeof item !== "object") return null;
  const said = item as {
    ref?: unknown;
    title?: unknown;
    callable?: unknown;
    reason?: unknown;
    tool_calling?: unknown;
  };
  const title = asLocalizedText(said.title);
  if (typeof said.ref !== "string" || title === null) return null;
  if (typeof said.callable !== "boolean") return null;
  const reason = said.reason;
  if (reason !== null && reason !== undefined && typeof reason !== "string") return null;
  return {
    ref: said.ref,
    title,
    callable: said.callable,
    reason: reason ?? null,
    // 예전 서버는 이 말을 하지 않는다 — 못 들은 것은 모르는 것으로 둔다.
    ...(typeof said.tool_calling === "boolean" ? { toolCalling: said.tool_calling } : {}),
  };
}

function asLocalizedText(value: unknown): LocalizedText | null {
  if (!value || typeof value !== "object") return null;
  const text = value as { ko?: unknown; en?: unknown };
  if (typeof text.ko !== "string" || typeof text.en !== "string") return null;
  return { ko: text.ko, en: text.en };
}

/**
 * 이 서버에서 고를 것들과, 셀렉트 위에 말할 한 줄 (DESIGN.md §7 preset-select 모델).
 *
 * - 아무 판정도 듣지 못했으면(못 물었거나 서버가 판정하지 않았으면) 번들 카탈로그 그대로다.
 * - 연습용 답으로 도는 서버에서는 모든 이름이 답을 받는다 — 열쇠 없음으로 잠그지 않고,
 *   대신 무슨 답이 오는지를 한 줄로 말한다.
 * - 진짜 모델을 부르는 서버에서는 부를 수 있는 것이 먼저 서고, 나머지는 까닭을 들고 남는다.
 */
export function modelPicking(server: ServerCatalog | null): ModelPicking {
  if (server === null || server.models.length === 0) {
    return { options: bundledChoices(), note: null };
  }
  if (server.mode === "stand_in") {
    return {
      options: server.models.map((model) => ({ ...model, callable: true, reason: null })),
      note: "stand_in",
    };
  }
  const callable = server.models.filter((model) => model.callable);
  return {
    options: [...callable, ...server.models.filter((model) => !model.callable)],
    note: callable.length === 0 ? "none_callable" : null,
  };
}

/**
 * 고른 모델이 도구를 못 쓴다고 이 서버가 **말했는가**.
 * 모르는 것(안 고른 모델·못 물은 서버·모르는 이름)은 못 한다고 말하지 않는다.
 */
export function toolsUnsupported(
  modelRef: unknown,
  server: ServerCatalog | null,
): boolean {
  if (server === null || typeof modelRef !== "string") return false;
  return server.models.find((model) => model.ref === modelRef)?.toolCalling === false;
}

function bundledChoices(): ModelChoice[] {
  return Object.values(MODEL_CATALOG).map((definition) => ({
    ref: definition.ref,
    title: definition.title,
    callable: true,
    reason: null,
  }));
}
