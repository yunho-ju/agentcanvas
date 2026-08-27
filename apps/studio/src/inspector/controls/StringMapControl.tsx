// 이름 -> 값 표 편집기 (core.input의 bindings처럼 additionalProperties가 string인 object).
import { useEffect, useState } from "react";
import { type MapRow, duplicateNames, fromRows, sameMap, toRows } from "../stringMapRows";
import { localized } from "../../i18n/locale";
import { useLocale, useT } from "../../i18n/useT";
import type { ControlProps } from "./types";

/** 편집 중인 줄 목록을 들고 있다가, 이름이 채워진 줄만 config로 내보낸다. */
function useMapRows(value: unknown, onChange: (next: Record<string, string>) => void) {
  const [rows, setRows] = useState<MapRow[]>(() => toRows(value));

  useEffect(() => {
    // 되돌리기처럼 밖에서 값이 바뀐 경우에만 다시 읽는다 — 타이핑 중에는 화면이 주인이다.
    setRows((current) => (sameMap(current, value) ? current : toRows(value)));
  }, [value]);

  const publish = (next: MapRow[]) => {
    setRows(next);
    onChange(fromRows(next));
  };

  return {
    rows,
    setRow: (index: number, row: MapRow) =>
      publish(rows.map((current, at) => (at === index ? row : current))),
    removeRow: (index: number) => publish(rows.filter((_, at) => at !== index)),
    addRow: () => publish([...rows, { name: "", value: "" }]),
  };
}

export function StringMapControl({ field, value, onChange, id }: ControlProps) {
  const { rows, setRow, removeRow, addRow } = useMapRows(value, onChange);
  const duplicated = duplicateNames(rows);
  const locale = useLocale();
  const t = useT();

  return (
    <fieldset className="control control--map" id={id} aria-label={localized(field.label, locale)}>
      <ul className="control__rows">
        {rows.map((row, index) => (
          // 이름은 편집 중에 계속 바뀌므로 줄을 가리키는 이름은 순서뿐이다.
          <li key={index} className="control__row">
            <input
              type="text"
              aria-label={t("control.map.name", { row: index + 1 })}
              value={row.name}
              onChange={(event) => setRow(index, { ...row, name: event.target.value })}
            />
            <input
              type="text"
              aria-label={t("control.map.value", { row: index + 1 })}
              value={row.value}
              onChange={(event) => setRow(index, { ...row, value: event.target.value })}
            />
            <button type="button" onClick={() => removeRow(index)}>
              {t("control.map.remove")}
            </button>
            {duplicated.includes(row.name) ? (
              <span className="control__error" role="alert">
                {t("control.map.duplicate")}
              </span>
            ) : null}
          </li>
        ))}
      </ul>
      <button type="button" className="control__add" onClick={addRow}>
        {t("control.map.add")}
      </button>
    </fieldset>
  );
}
