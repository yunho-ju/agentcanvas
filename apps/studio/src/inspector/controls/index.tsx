// 편집기 primitive들과 "schema가 고른 편집기 -> 컴포넌트" 매핑 표.
// 새 편집기를 더할 때 이 표에 한 줄을 더한다 — 폼을 그리는 쪽은 그대로다 (설계 §4.2).
import { forwardRef, useRef, useState } from "react";
import { localized } from "../../i18n/locale";
import { useLocale, useT } from "../../i18n/useT";
import {
  INSTRUCTION_CATALOG,
  resolveInstructionPreset,
} from "../../registry/instructionCatalog";
import { MODEL_CATALOG } from "../../registry/modelCatalog";
import { SCHEMA_CATALOG, resolveSchema } from "../../registry/schemaCatalog";
import type { ControlKind } from "../schemaForm";
import { useTextDraft } from "../useTextDraft";
import {
  asJsonText,
  asLines,
  asText,
  fromLines,
  fromText,
  parseJson,
  toNumber,
} from "../values";
import { StringMapControl } from "./StringMapControl";
import type { ControlEntry, ControlProps } from "./types";

export type { ControlProps } from "./types";

function common({ id, describedBy, invalid }: ControlProps) {
  return {
    id,
    "aria-describedby": describedBy,
    "aria-invalid": invalid || undefined,
  };
}

function TextControl(props: ControlProps) {
  return (
    <input
      {...common(props)}
      type="text"
      className="control"
      value={asText(props.value)}
      onChange={(event) => props.onChange(fromText(event.target.value))}
    />
  );
}

// 초대말은 부르는 쪽이 준다 — 안 주면 빈 상자는 그냥 빈 상자다.
const TextareaControl = forwardRef<
  HTMLTextAreaElement,
  ControlProps & { placeholder?: string }
>((props, ref) => (
  <textarea
    {...common(props)}
    ref={ref}
    className="control control--textarea"
    rows={4}
    placeholder={props.placeholder}
    value={asText(props.value)}
    onChange={(event) => props.onChange(fromText(event.target.value))}
  />
));

function NumberControl(props: ControlProps) {
  return (
    <input
      {...common(props)}
      type="number"
      className="control"
      value={asText(props.value)}
      onChange={(event) => props.onChange(toNumber(event.target.value))}
    />
  );
}

function BooleanControl(props: ControlProps) {
  return (
    <input
      {...common(props)}
      type="checkbox"
      className="control control--check"
      checked={props.value === true}
      onChange={(event) => props.onChange(event.target.checked)}
    />
  );
}

/** 고를 수 있는 하나 — 저장되는 값과 사람이 읽는 이름은 다를 수 있다. */
interface Choice {
  value: string;
  label: string;
}

function ChoiceControl(props: ControlProps & { choices: Choice[] }) {
  const t = useT();
  return (
    <select
      {...common(props)}
      className="control"
      value={asText(props.value)}
      onChange={(event) => props.onChange(fromText(event.target.value))}
    >
      <option value="">{t("control.select.none")}</option>
      {props.choices.map((choice) => (
        <option key={choice.value} value={choice.value}>
          {choice.label}
        </option>
      ))}
    </select>
  );
}

function SelectControl(props: ControlProps) {
  const choices = (props.field.options ?? []).map((option) => ({
    value: option,
    label: option,
  }));
  return <ChoiceControl {...props} choices={choices} />;
}

/**
 * 값의 형식을 가리키는 이름은 손으로 적지 않는다 — 카탈로그가 들고 있는 양식 중에서 고른다.
 * 카탈로그에 없는 값도 잃지 않는다: 내부 이름 대신 '알 수 없는 양식'이라는 자리로 남는다.
 */
function SchemaRefControl(props: ControlProps) {
  const locale = useLocale();
  const t = useT();
  const current = asText(props.value);
  const known = Object.values(SCHEMA_CATALOG).map((definition) => ({
    value: definition.ref,
    label: localized(definition.title, locale),
  }));
  const choices =
    current !== "" && !resolveSchema(current)
      ? [...known, { value: current, label: t("control.schemaRef.unknown") }]
      : known;
  return <ChoiceControl {...props} choices={choices} />;
}

/** 셀렉트의 마지막 자리 — 어떤 ref도 이 자리와 겹치지 않는다. */
const TYPE_IT_MYSELF = "__type_it_myself__";

/**
 * 많이 쓰는 값은 고르고, 특수한 값만 적는다.
 * 저장되는 것은 언제나 값 하나 — 고름/적음은 화면의 상태일 뿐이라 undo에 남지 않는다.
 */
function PresetRefControl(props: ControlProps & { choices: Choice[] }) {
  const t = useT();
  const current = asText(props.value);
  const known = props.choices.some((choice) => choice.value === current);
  // 손으로 적는 중인 값 — 다른 값을 보게 되면 다시 고르는 자리로 돌아온다.
  const [typed, setTyped] = useState<string | null>(null);
  const typing = typed === current || (current !== "" && !known);

  function type(text: string) {
    setTyped(text);
    props.onChange(fromText(text));
  }

  return (
    <span className="control__preset">
      <select
        {...common(props)}
        className="control"
        value={typing ? TYPE_IT_MYSELF : current}
        onChange={(event) => {
          // 적는 자리로 넘어가는 것만으로는 값이 바뀌지 않는다 — 되돌릴 것도 쌓이지 않는다.
          if (event.target.value === TYPE_IT_MYSELF) return setTyped(current);
          setTyped(null);
          // 고르는 일은 글자를 이어 적는 일과 다르다 — 고를 때마다 되돌릴 걸음 하나다.
          props.onChange(fromText(event.target.value), { merge: false });
        }}
      >
        {/* 비우는 것은 고를 수 없다 — 아직 안 골랐다는 사실을 보여 주는 자리일 뿐이다. */}
        {current === "" && !typing ? (
          <option value="" disabled>
            {t("control.select.none")}
          </option>
        ) : null}
        {props.choices.map((choice) => (
          <option key={choice.value} value={choice.value}>
            {choice.label}
          </option>
        ))}
        <option value={TYPE_IT_MYSELF}>{t("control.preset.custom")}</option>
      </select>
      {typing ? (
        <input
          type="text"
          className="control"
          // 상자도 이 필드의 것이다 — 셀렉트와 같은 이름과 같은 설명을 받는다.
          aria-labelledby={`${props.id}-label`}
          aria-describedby={props.describedBy}
          aria-invalid={props.invalid || undefined}
          // 방금 연 자리에 손이 바로 닿는다 — 한 번 더 클릭하게 두지 않는다.
          autoFocus
          value={current}
          onChange={(event) => type(event.target.value)}
        />
      ) : null}
    </span>
  );
}

/** 어떤 모델에게 맡길지는 카탈로그에서 고른다 — 목록은 계약이 내보낸 한 벌이다. */
function ModelRefControl(props: ControlProps) {
  const locale = useLocale();
  return (
    <PresetRefControl
      {...props}
      choices={Object.values(MODEL_CATALOG).map((definition) => ({
        value: definition.ref,
        label: localized(definition.title, locale),
      }))}
    />
  );
}

/**
 * 빈 상자 앞에서 무엇을 적을지 모르는 사람에게 시작 글을 준다 — 고르면 채워지고, 거기서부터 고쳐 쓴다.
 * 셀렉트는 값이 아니라 채우는 행동이다: 저장되는 것은 언제나 상자의 글 하나뿐이다.
 */
function InstructionTextControl(props: ControlProps) {
  const locale = useLocale();
  const t = useT();
  const box = useRef<HTMLTextAreaElement>(null);
  // 포인터로 고르는 중이라는 표시 — 키보드로 훑는 동안에는 초점을 옮기지 않는다.
  const byPointer = useRef(false);

  function fill(id: string) {
    const preset = resolveInstructionPreset(id);
    if (!preset) return;
    // 고르는 일은 글자를 이어 적는 일과 다르다 — 고를 때마다 되돌릴 걸음 하나다.
    // (같은 값을 다시 골랐을 때 걸음을 안 쌓는 것은 store의 빈 변경 걸러내기가 지킨다.)
    props.onChange(localized(preset.text, locale), { merge: false });
    // 고쳐 쓰라고 주는 글이다 — 포인터 고름은 결정이라 바로 손이 닿게 한다.
    if (byPointer.current) box.current?.focus();
  }

  return (
    <span className="control__preset-fill">
      <select
        className="control"
        // 셀렉트도 이 필드의 것이다 — 필드의 이름과 같은 설명을 받는다.
        aria-label={t("control.presetFill.name", { field: props.field.label })}
        aria-describedby={props.describedBy}
        // 고름은 행동이라 남지 않는다 — 채우고 나면 다시 쉬는 자리로 돌아온다.
        value=""
        onPointerDown={() => {
          byPointer.current = true;
        }}
        // 키보드로 훑다가 Enter로 결정하면 그때 손이 상자로 간다.
        onKeyDown={(event) => {
          if (event.key === "Enter") box.current?.focus();
        }}
        onBlur={() => {
          byPointer.current = false;
        }}
        onChange={(event) => {
          fill(event.target.value);
          byPointer.current = false;
        }}
      >
        {/* 쉬는 자리는 고를 수 없다 — 아직 아무것도 고르지 않았다는 표시일 뿐이다. */}
        <option value="" disabled>
          {t("control.presetFill.placeholder")}
        </option>
        {Object.values(INSTRUCTION_CATALOG).map((preset) => (
          <option key={preset.id} value={preset.id}>
            {localized(preset.title, locale)}
          </option>
        ))}
      </select>
      <TextareaControl
        {...props}
        ref={box}
        placeholder={t("control.instruction.invite")}
      />
    </span>
  );
}

const parseLines = (text: string) => ({ ok: true, value: fromLines(text) });

function ArrayControl(props: ControlProps) {
  const draft = useTextDraft(props.value, asLines, parseLines, props.onChange);
  return (
    <textarea
      {...common(props)}
      className="control control--textarea"
      rows={3}
      value={draft.text}
      onChange={(event) => draft.setText(event.target.value)}
    />
  );
}

function SecretRefControl(props: ControlProps) {
  const t = useT();
  return (
    <span className="control__secret">
      <TextControl {...props} />
      <span className="control__hint">{t("control.secret.hint")}</span>
    </span>
  );
}

/** 아직 JSON이 아닌 글자도 지우지 않는다 — 편집이 끝날 때까지 화면이 원문을 들고 있다. */
export function JsonControl(
  props: ControlProps & { parse?: (text: string) => { ok: boolean; value?: unknown } },
) {
  const draft = useTextDraft(
    props.value,
    asJsonText,
    props.parse ?? parseJson,
    props.onChange,
  );
  const t = useT();

  return (
    <span className="control__json">
      <textarea
        {...common(props)}
        className="control control--textarea"
        rows={5}
        value={draft.text}
        onChange={(event) => draft.setText(event.target.value)}
      />
      {draft.broken ? (
        <span className="control__error" role="alert">
          {t("control.json.broken")}
        </span>
      ) : null}
    </span>
  );
}

export const CONTROLS: Record<ControlKind, ControlEntry> = {
  text: { Component: TextControl },
  textarea: { Component: TextareaControl },
  instructionText: { Component: InstructionTextControl },
  number: { Component: NumberControl },
  boolean: { Component: BooleanControl },
  select: { Component: SelectControl },
  array: { Component: ArrayControl },
  secretRef: { Component: SecretRefControl },
  schemaRef: { Component: SchemaRefControl },
  modelRef: { Component: ModelRefControl },
  json: { Component: JsonControl },
  stringMap: { Component: StringMapControl, selfLabelled: true },
};
