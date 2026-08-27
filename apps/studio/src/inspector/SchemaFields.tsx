// 형식(JSON Schema)이 요구하는 값을 사람이 적는 자리 — 무엇을 그릴지는 registry가 정한다.
// 어떤 형식이 와도 이 파일은 바뀌지 않는다: 편집기는 CONTROLS 표에서 온다.
// 밸브 앞 승인 폼과 실행 입력 카드가 이 문법을 함께 쓴다 (DESIGN §7 — 새 시각 발명 금지).
import { CONTROLS } from "./controls";
import type { FormField } from "./schemaForm";
import { localized } from "../i18n/locale";
import { useLocale, useT } from "../i18n/useT";

interface SchemaFieldsProps {
  fields: FormField[];
  values: Record<string, unknown>;
  onChange: (name: string, value: unknown) => void;
  /** 이 폼이 사는 카드의 이름 — 칸들은 그 카드의 옷을 입는다 */
  block: string;
  /** 라벨이 칸을 가리키는 이름의 앞자리 */
  idPrefix: string;
}

function SchemaField({
  field,
  value,
  onChange,
  block,
  idPrefix,
}: {
  field: FormField;
  value: unknown;
  onChange: (value: unknown) => void;
  block: string;
  idPrefix: string;
}) {
  const { Component, selfLabelled } = CONTROLS[field.control];
  const locale = useLocale();
  const t = useT();
  const id = `${idPrefix}-${field.name}`;
  const title = localized(field.label, locale);
  // 필수는 기호가 아니라 말로 알린다 — 별표 하나로 나누지 않는다.
  const label = field.required ? t("form.required", { label: title }) : title;

  return (
    <div className={`${block}__field`}>
      {selfLabelled ? (
        <span className={`${block}__label`}>{label}</span>
      ) : (
        <label className={`${block}__label`} htmlFor={id}>
          {label}
        </label>
      )}
      <Component
        field={field}
        value={value}
        onChange={onChange}
        id={id}
        invalid={false}
      />
    </div>
  );
}

export function SchemaFields({
  fields,
  values,
  onChange,
  block,
  idPrefix,
}: SchemaFieldsProps) {
  return (
    <div className={`${block}__form`}>
      {fields.map((field) => (
        <SchemaField
          key={field.name}
          field={field}
          value={values[field.name]}
          onChange={(value) => onChange(field.name, value)}
          block={block}
          idPrefix={idPrefix}
        />
      ))}
    </div>
  );
}
