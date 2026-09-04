// config_schema가 그리는 폼. 노드 타입을 보지 않는다 — schema만 본다 (설계 §4.2).
import { useState } from "react";
import type { EditOptions } from "../history/graphCommands";
import { localized } from "../i18n/locale";
import { useLocale, useT } from "../i18n/useT";
import { resolvedPicks } from "./bindingPicks";
import { CONTROLS, JsonControl } from "./controls";
import {
  type EnabledState,
  type FormField,
  describeForm,
  enabledState,
} from "./schemaForm";
import { useDocResources } from "./useDocResources";
import { type ConfigError, validateConfig } from "./validateConfig";
import { asText, parseJson, withValue } from "./values";

type Config = Record<string, unknown>;

interface ConfigFormProps {
  schema: unknown;
  config: Config;
  onChange: (config: Config, options?: EditOptions) => void;
  /**
   * schema 혼자서는 알 수 없는 손볼 곳 — 문서 전체를 봐야 아는 판정이 여기로 온다
   * (예: 입은 skill이 이 문서에 있는가). 붙는 자리는 schema 오류와 같다.
   */
  extraErrors?: ConfigError[];
}

function ConfigFieldRow({
  field,
  value,
  error,
  enabled,
  onChange,
}: {
  field: FormField;
  value: unknown;
  error?: ConfigError;
  enabled: EnabledState;
  onChange: (value: unknown, options?: EditOptions) => void;
}) {
  const { Component, selfLabelled } = CONTROLS[field.control];
  // 빈 상자는 뜻을 잃지만, 손댄 뒤에 비운 칸을 다시 채우면 지우고 다시 적는 길이 막힌다.
  const [touched, setTouched] = useState(false);
  const locale = useLocale();
  const t = useT();
  const id = `config-${field.name}`;
  const description = localized(field.description, locale);
  const hintId = description === "" ? undefined : `${id}-hint`;
  const title = localized(field.label, locale);
  const label = field.required ? `${title} *` : title;
  const lockedBecause = enabled.enabled ? undefined : localized(enabled.hint, locale);
  // 잠긴 컨트롤에는 툴팁이 뜨지 않는다 — 까닭은 보이는 줄로도 말한다 (DESIGN §7 agent-turns).
  const lockedId = lockedBecause === undefined ? undefined : `${id}-locked`;

  return (
    <div className="inspector__field">
      {selfLabelled ? (
        <span className="inspector__label" title={description}>
          {label}
        </span>
      ) : (
        <label
          className="inspector__label"
          id={`${id}-label`}
          htmlFor={id}
          title={description}
        >
          {label}
        </label>
      )}
      <Component
        field={field}
        value={value === undefined && !touched ? field.fallback : value}
        onChange={(next, options) => {
          setTouched(true);
          onChange(next, options);
        }}
        id={id}
        describedBy={[hintId, lockedId].filter(Boolean).join(" ") || undefined}
        invalid={error !== undefined}
        disabled={lockedBecause !== undefined}
        title={lockedBecause}
        placeholder={field.fallback === undefined ? undefined : asText(field.fallback)}
      />
      {lockedBecause ? (
        <p className="inspector__hint" id={lockedId}>
          {lockedBecause}
        </p>
      ) : null}
      {description ? (
        <p className="inspector__hint" id={hintId}>
          {description}
        </p>
      ) : null}
      {error ? (
        <p className="inspector__error" role="alert">
          {t(error.message)}
        </p>
      ) : null}
    </div>
  );
}

/** config는 언제나 object다 — object가 아닌 JSON은 아직 완성되지 않은 글로 본다. */
function parseConfigText(text: string): { ok: boolean; value?: unknown } {
  const parsed = parseJson(text);
  if (!parsed.ok) return { ok: false };
  if (parsed.value === undefined) return { ok: true, value: {} };
  const isObject =
    typeof parsed.value === "object" &&
    parsed.value !== null &&
    !Array.isArray(parsed.value);
  return isObject ? { ok: true, value: parsed.value } : { ok: false };
}

function RawConfigEditor({ config, onChange }: Omit<ConfigFormProps, "schema">) {
  const t = useT();
  const hint = t("config.raw.hint");
  const field: FormField = {
    name: "",
    label: { ko: t("config.raw.label"), en: t("config.raw.label") },
    required: false,
    control: "json",
    schema: {},
  };
  return (
    <div className="inspector__field">
      <label className="inspector__label" htmlFor="config-raw" title={hint}>
        {t("config.raw.label")}
      </label>
      <JsonControl
        field={field}
        value={config}
        parse={parseConfigText}
        onChange={(value) => onChange(value as Config)}
        id="config-raw"
        invalid={false}
      />
      <p className="inspector__hint">{hint}</p>
    </div>
  );
}

export function ConfigForm({
  schema,
  config,
  onChange,
  extraErrors = [],
}: ConfigFormProps) {
  const t = useT();
  const { bindings } = useDocResources();
  const form = describeForm(schema);
  const errors = [...validateConfig(schema, config), ...extraErrors];
  // 잠금을 푸는 것은 이 문서가 지킬 수 있는 고름뿐이다 — 오타 이름은 고른 것이 아니다.
  const standing = resolvedPicks(schema, config, bindings);

  if (form.raw) return <RawConfigEditor config={config} onChange={onChange} />;

  return (
    <div className="inspector__form">
      {errors
        .filter((error) => error.field === null)
        .map((error) => (
          <p key={error.message.key} className="inspector__error" role="alert">
            {t(error.message)}
          </p>
        ))}
      {form.fields.map((field) => (
        <ConfigFieldRow
          key={field.name}
          field={field}
          value={config[field.name]}
          error={errors.find((error) => error.field === field.name)}
          enabled={enabledState(field, standing)}
          onChange={(value, options) =>
            onChange(withValue(config, field.name, value), options)
          }
        />
      ))}
    </div>
  );
}
