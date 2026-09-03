// 편집기 primitive들과 "schema가 고른 편집기 -> 컴포넌트" 매핑 표.
// 새 편집기를 더할 때 이 표에 한 줄을 더한다 — 폼을 그리는 쪽은 그대로다 (설계 §4.2).
import { forwardRef, useRef, useState } from "react";
import { localized } from "../../i18n/locale";
import type { MessageKey } from "../../i18n/messages";
import { type Translate, useLocale, useT } from "../../i18n/useT";
import {
  INSTRUCTION_CATALOG,
  resolveInstructionPreset,
} from "../../registry/instructionCatalog";
import { SCHEMA_CATALOG, resolveSchema } from "../../registry/schemaCatalog";
import type { ControlKind } from "../schemaForm";
import { useDocResources } from "../useDocResources";
import { useServerModelOptions } from "../useServerModelOptions";
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
import { InputRowsControl } from "./InputRowsControl";
import { SkillMakeEntry, SkillMadeNote } from "./SkillMakeEntry";
import { SkillWearControl } from "./SkillWearControl";
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

/** 이 칸을 설명하는 글들 — schema의 설명 옆에 지금 상황의 이유를 나란히 놓는다. */
function describedBy(props: ControlProps, reasonId?: string): string | undefined {
  const ids = [props.describedBy, reasonId].filter(Boolean);
  return ids.length > 0 ? ids.join(" ") : undefined;
}

/** 고를 수 있는 하나 — 저장되는 값과 사람이 읽는 이름은 다를 수 있다. */
interface Choice {
  value: string;
  label: string;
  /** 이름만으로는 모를 때 덧붙이는 쉬운 설명 */
  hint?: string;
  /** 지금은 고를 수 없는 자리 — 목록에서 지우지 않고 잠근다(까닭은 hint가 말한다) */
  disabled?: boolean;
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
function PresetRefControl(
  props: ControlProps & { choices: Choice[]; disabled?: boolean },
) {
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
        disabled={props.disabled}
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
          <option
            key={choice.value}
            value={choice.value}
            title={choice.hint}
            disabled={choice.disabled}
          >
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
          disabled={props.disabled}
          // 손이 가는 것은 '직접 적기…'를 고른 그때뿐이다 — 목록이 밖에서 바뀌었다고
          // 초점을 빼앗지 않는다 (고른 것은 옆 칸이지 이 칸이 아니다).
          autoFocus={typed !== null}
          value={current}
          onChange={(event) => type(event.target.value)}
        />
      ) : null}
    </span>
  );
}

/** 부를 수 없는 까닭 → 사람이 읽을 한 줄. 서버가 지금 대는 까닭은 '열쇠가 없다' 하나다. */
const MODEL_REASON_WORDS: Record<string, MessageKey> = {
  missing_secret: "control.modelRef.noKey",
};

/** 셀렉트 위에 말할 한 줄 — 무엇을 말할지는 규칙(modelPicking)이 정하고 여기는 옮긴다. */
const MODEL_NOTE_WORDS: Record<string, MessageKey> = {
  stand_in: "control.modelRef.standIn",
  none_callable: "control.modelRef.noneCallable",
};

/**
 * 어떤 모델에게 맡길지는 **이 서버가 아는 모델** 중에서 고른다 (DESIGN §7 preset-select 모델).
 * 부를 수 있는 것이 먼저 서고, 부를 수 없는 것은 지우지 않고 까닭을 들고 잠긴 채 남는다.
 * 서버에 물어보지 못했으면 번들 카탈로그를 예전 그대로 보여 준다 — 모르는 것으로 막지 않는다.
 */
function ModelRefControl(props: ControlProps) {
  const locale = useLocale();
  const t = useT();
  const { options, note } = useServerModelOptions();
  const reasonId = `${props.id}-reason`;
  return (
    <span className="control__from-doc">
      {/* 고르기 전에 알아야 할 사정을 셀렉트 앞에 먼저 말한다 — 빈 목록을 던지지 않는다. */}
      {note ? (
        <span className="control__hint" id={reasonId}>
          {t(MODEL_NOTE_WORDS[note])}
        </span>
      ) : null}
      <PresetRefControl
        {...props}
        describedBy={describedBy(props, note ? reasonId : undefined)}
        choices={options.map((option) => ({
          value: option.ref,
          label: localized(option.title, locale),
          disabled: !option.callable,
          hint: option.callable ? undefined : reasonWords(option.reason, t),
        }))}
      />
    </span>
  );
}

/** 못 부르는 까닭을 아는 말로만 옮긴다 — 모르는 까닭을 아는 척해 지어내지 않는다. */
function reasonWords(reason: string | null, t: Translate): string {
  const known = reason === null ? undefined : MODEL_REASON_WORDS[reason];
  return t(known ?? "control.modelRef.cannotCall");
}

/**
 * 어떤 연결을 쓸지는 이 문서가 가진 연결 중에서 고른다 — 전역 카탈로그가 아니다 (DESIGN §7 binding-select).
 * 목록이 비어 있어도 빈 셀렉트를 던지지 않는다: 왜 비었는지를 말한다.
 */
function BindingSelectControl(props: ControlProps) {
  const t = useT();
  const { bindings } = useDocResources();
  const empty = bindings.length === 0;
  const reasonId = `${props.id}-reason`;
  return (
    <span className="control__from-doc">
      <PresetRefControl
        {...props}
        describedBy={describedBy(props, empty ? reasonId : undefined)}
        choices={bindings.map((binding) => ({
          value: binding.id,
          label: binding.id,
        }))}
      />
      {empty ? (
        <span className="control__hint" id={reasonId}>
          {t("control.bindingSelect.empty")}
        </span>
      ) : null}
    </span>
  );
}

/**
 * 어떤 도구를 실행할지는 방금 고른 연결이 든 도구 중에서 고른다 (DESIGN §7 tool-select).
 * 연결을 고르기 전에는 고를 것이 없다 — 잠그되, 왜 잠겼는지를 말한다.
 */
function ToolSelectControl(props: ControlProps) {
  const locale = useLocale();
  const t = useT();
  const { ref, chosen } = useDocResources();
  const tools = chosen?.tools ?? [];
  // 아직 아무 연결도 고르지 않았을 때만 잠근다. 문서에 없는 이름이 적혀 있는 것은 다른 일이라
  // 잠그지 않는다 — 그 이름이 틀렸다는 말은 필드 오류와 노드 뱃지가 이미 한다.
  const waiting = ref === "";
  const reason = waiting
    ? "control.toolSelect.needsBinding"
    : chosen && tools.length === 0
      ? "control.toolSelect.empty"
      : undefined;
  const reasonId = `${props.id}-reason`;
  return (
    <span className="control__from-doc">
      <PresetRefControl
        {...props}
        describedBy={describedBy(props, reason ? reasonId : undefined)}
        disabled={waiting}
        choices={tools.map((tool) => ({
          value: tool.name,
          label: tool.name,
          // 도구 이름만 던지지 않는다 — 무엇을 하는 도구인지 함께 말한다.
          hint: localized(tool.plain_description, locale),
        }))}
      />
      {reason ? (
        <span className="control__hint" id={reasonId}>
          {t(reason)}
        </span>
      ) : null}
    </span>
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
      {/* 시작 글 고르기와 skill로 저장은 한 줄에 나란히 선다 (DESIGN §7 skill-make-card 입구). */}
      <span className="control__preset-row">
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
        {/* 적어 둔 글은 그 단계만의 것이 아니어도 된다 — skill로 저장하면 문서의 것이 된다. */}
        <SkillMakeEntry instruction={asText(props.value)} />
      </span>
      <TextareaControl
        {...props}
        ref={box}
        placeholder={t("control.instruction.invite")}
      />
      <SkillMadeNote />
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
  bindingSelect: { Component: BindingSelectControl },
  skillWear: { Component: SkillWearControl, selfLabelled: true },
  toolSelect: { Component: ToolSelectControl },
  json: { Component: JsonControl },
  stringMap: { Component: StringMapControl, selfLabelled: true },
  inputRows: { Component: InputRowsControl, selfLabelled: true },
};
