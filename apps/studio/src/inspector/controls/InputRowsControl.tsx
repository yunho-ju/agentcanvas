// 입력 노드가 받는 줄 편집기 (DESIGN §7 input-rows) — 그리기만 한다.
// 무엇이 줄이고 그것이 문서에 어떻게 적히는지는 `graph/inputRows`가 안다.
import { useEffect, useRef, useState } from "react";
import {
  CUSTOM_KIND,
  type InputRow,
  ROW_KINDS,
  canBeRequired,
  isLocked,
  rowKindWord,
  rowsOf,
  rowsProblem,
  withKind,
} from "../../graph/inputRows";
import { localized } from "../../i18n/locale";
import { useLocale, useT } from "../../i18n/useT";
import { selectedNode, useEditor } from "../../store/editor";
import type { ControlProps } from "./types";

const PROBLEM_MESSAGE = {
  empty: "control.rows.empty",
  duplicate: "control.map.duplicate",
} as const;

/**
 * 이 줄이 고를 수 있는 종류들. 문서에 직접 적힌 모양은 화면이 고르는 목록에 없다 —
 * 그 줄은 제 이름 하나만 말한다 (DESIGN §7 input-rows).
 */
function kindsFor(row: InputRow): InputRow["kind"][] {
  return isLocked(row) ? [CUSTOM_KIND] : ROW_KINDS;
}

function sameRows(one: InputRow[], other: InputRow[]): boolean {
  return JSON.stringify(one) === JSON.stringify(other);
}

/**
 * 화면이 쥐고 있는 줄들 — 이름이 비었거나 겹치는 동안에도 사람이 치던 글은 남는다.
 * 문서가 밖에서 바뀌면(되돌리기 등) 그때만 다시 읽는다.
 */
function useRows(stored: InputRow[], write: (rows: InputRow[]) => void) {
  const [rows, setRows] = useState<InputRow[]>(stored);
  const written = useRef<InputRow[]>(stored);

  useEffect(() => {
    if (sameRows(written.current, stored)) return;
    written.current = stored;
    setRows(stored);
  }, [stored]);

  /** 화면에만 남기는 편집 — 아직 문서로 내려보내지 않는다 (치는 중의 이름). */
  const draft = (next: InputRow[]) => setRows(next);

  /** 문서에 적는 편집. 적을 수 없는 줄이면 적지 않고 이유만 남는다. */
  const commit = (next: InputRow[]) => {
    setRows(next);
    if (rowsProblem(next)) return;
    written.current = next;
    write(next);
  };

  return { rows, problem: rowsProblem(rows), draft, commit };
}

export function InputRowsControl({ field, id }: ControlProps) {
  const node = useEditor(selectedNode);
  const inputSchema = useEditor((state) => state.spec?.input_schema);
  const setInputRows = useEditor((state) => state.setInputRows);
  const locale = useLocale();
  const t = useT();

  const nodeId = node?.id ?? "";
  const { rows, problem, draft, commit } = useRows(
    node ? rowsOf(node.data.spec, inputSchema) : [],
    (next) => setInputRows(nodeId, next),
  );

  const replaced = (index: number, row: InputRow) =>
    rows.map((current, at) => (at === index ? row : current));

  return (
    <fieldset
      className="control control--rows"
      id={id}
      aria-label={localized(field.label, locale)}
    >
      <ul className="control__rows">
        {rows.map((row, index) => (
          // 이름은 편집 중에 계속 바뀌므로 줄을 가리키는 이름은 순서뿐이다.
          <li key={index} className="control__row">
            {/* 첫 행: 무엇을 받는가 (이름·종류). 둘째 행: 그 줄을 어떻게 할까 (필수·지우기). */}
            <span className="control__row-line">
              <input
                type="text"
                aria-label={t("control.map.name", { row: index + 1 })}
                value={row.name}
                // 이름은 칸을 떠날 때 확정한다 — 치는 도중의 이름이 포트가 되지 않는다.
                onChange={(event) => draft(replaced(index, { ...row, name: event.target.value }))}
                onBlur={() => commit(rows)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    commit(rows);
                  }
                }}
              />
              <select
                aria-label={t("control.rows.kind", { row: index + 1 })}
                value={row.kind}
                disabled={isLocked(row)}
                title={isLocked(row) ? t("control.rows.locked") : undefined}
                onChange={(event) =>
                  commit(
                    replaced(index, withKind(row, event.target.value as InputRow["kind"])),
                  )
                }
              >
                {kindsFor(row).map((kind) => (
                  <option key={kind} value={kind}>
                    {t(rowKindWord(kind))}
                  </option>
                ))}
              </select>
            </span>
            <span className="control__row-line">
              <label
                className="control__check"
                title={canBeRequired(row) ? undefined : t("control.rows.needsKind")}
              >
                <input
                  type="checkbox"
                  checked={row.required}
                  disabled={!canBeRequired(row)}
                  onChange={(event) =>
                    commit(replaced(index, { ...row, required: event.target.checked }))
                  }
                />
                {t("control.rows.required")}
              </label>
              <button
                type="button"
                onClick={() => commit(rows.filter((_, at) => at !== index))}
              >
                {t("control.map.remove")}
              </button>
            </span>
          </li>
        ))}
      </ul>
      <button
        type="button"
        className="control__add"
        onClick={() => draft([...rows, { name: "", kind: "text", required: false, was: null }])}
      >
        {t("control.map.add")}
      </button>
      {problem ? (
        <span className="control__error" role="alert">
          {t(PROBLEM_MESSAGE[problem])}
        </span>
      ) : null}
    </fieldset>
  );
}
