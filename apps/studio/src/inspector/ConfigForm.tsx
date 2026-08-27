// config_schema가 그리는 폼. 노드 타입을 보지 않는다 — schema만 본다 (설계 §4.2).
import type { EditOptions } from "../history/graphCommands";
import { localized } from "../i18n/locale";
import { useLocale, useT } from "../i18n/useT";
import { CONTROLS, JsonControl } from "./controls";
import { type FormField, describeForm } from "./schemaForm";
import { type ConfigError, validateConfig } from "./validateConfig";
import { parseJson, withValue } from "./values";

type Config = Record<string, unknown>;

interface ConfigFormProps {
  schema: unknown;
  config: Config;
  onChange: (config: Config, options?: EditOptions) => void;
}

function ConfigFieldRow({
  field,
  value,
  error,
  onChange,
}: {
  field: FormField;
  value: unknown;
  error?: ConfigError;
  onChange: (value: unknown, options?: EditOptions) => void;
}) {
  const { Component, selfLabelled } = CONTROLS[field.control];
  const locale = useLocale();
  const t = useT();
  const id = `config-${field.name}`;
  const description = localized(field.description, locale);
  const hintId = field.description ? `${id}-hint` : undefined;
  const title = localized(field.label, locale);
  const label = field.required ? `${title} *` : title;

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
        value={value}
        onChange={onChange}
        id={id}
        describedBy={hintId}
        invalid={error !== undefined}
      />
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

export function ConfigForm({ schema, config, onChange }: ConfigFormProps) {
  const t = useT();
  const form = describeForm(schema);
  const errors = validateConfig(schema, config);

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
          onChange={(value, options) =>
            onChange(withValue(config, field.name, value), options)
          }
        />
      ))}
    </div>
  );
}
