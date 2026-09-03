// 포트에서 빈 캔버스로 끌어다 놓은 자리에 뜨는 노드 피커 (브리프 B4·B5).
// 목록은 팔레트와 같은 곳(registry)에서 오고, 이을 수 있는지는 계약이 정한다 (pickerOptions).
import { useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { localized } from "../i18n/locale";
import { useLocale, useT } from "../i18n/useT";
import { nodeTypes } from "../registry/registry";
import { useEditor } from "../store/editor";
import { useOutsidePress } from "../hooks/useOutsidePress";
import { NodeTypeChip } from "./NodeTypeChip";
import { type PickerOption, pickerOptions } from "./pickerOptions";

const LIST_ID = "picker-options";

function optionId(type: string): string {
  return `picker-option-${type}`;
}

/** 위아래로 오가는 자리 — 끝에 닿으면 반대편으로 돈다. */
function moved(at: number, step: number, count: number): number {
  return count === 0 ? 0 : (at + step + count) % count;
}

export function NodePicker() {
  const picker = useEditor((state) => state.picker);
  const closePicker = useEditor((state) => state.closePicker);
  const addPickedNode = useEditor((state) => state.addPickedNode);
  // 그래프가 달라지면 이을 수 있는 것도 달라진다 — 목록은 지금의 그래프에서 나온다.
  const nodes = useEditor((state) => state.nodes);
  const edges = useEditor((state) => state.edges);
  const locale = useLocale();
  const t = useT();

  const [query, setQuery] = useState("");
  const [at, setAt] = useState(0);
  const searchRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const options: PickerOption[] = useMemo(() => {
    if (!picker) return [];
    return pickerOptions({
      spec: useEditor.getState().exportSpec(),
      from: picker.from,
      query,
      locale,
    });
    // nodes·edges는 그래프가 달라졌다는 신호로만 쓴다.
  }, [picker, query, locale, nodes, edges]);

  // 새로 열릴 때마다 빈 칸에서 시작한다 — 지난번에 친 글자가 남아 있으면 놀란다.
  useEffect(() => {
    if (!picker) return;
    setQuery("");
    setAt(0);
    searchRef.current?.focus();
  }, [picker]);

  // 캔버스 아무 데나 누르면 물러난다 — 그만두는 데 버튼을 찾을 필요가 없다.
  useOutsidePress(picker !== null, [panelRef], closePicker);

  if (!picker) return null;

  const chosen = options[at];

  // Esc는 여기서 받지 않는다 — 무엇을 먼저 무를지는 화면 전체의 순서(canvas/shortcuts)가 정한다.
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      setAt((current) => moved(current, step, options.length));
      return;
    }
    if (event.key === "Enter" && chosen) {
      event.preventDefault();
      addPickedNode(chosen.type, chosen.port);
    }
  }

  return (
    <div
      ref={panelRef}
      className="picker layer"
      role="dialog"
      aria-label={t("picker.title")}
      style={{ left: picker.screen.x, top: picker.screen.y }}
      onKeyDown={onKeyDown}
    >
      <input
        ref={searchRef}
        className="picker__search control"
        type="text"
        role="combobox"
        aria-label={t("picker.search")}
        aria-expanded
        aria-controls={LIST_ID}
        aria-activedescendant={chosen ? optionId(chosen.type) : undefined}
        placeholder={t("picker.search")}
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setAt(0);
        }}
      />
      {/* 왜 이만큼만 보이는지 말해 준다 — 목록이 짧은 것은 고장이 아니다. */}
      <p className="picker__hint">
        {picker.from
          ? t("picker.linked", { port: picker.from.portId })
          : t("picker.free")}
      </p>
      {options.length === 0 ? (
        <p className="picker__empty">{t("picker.empty")}</p>
      ) : (
        <ul
          className="picker__list"
          id={LIST_ID}
          role="listbox"
          aria-label={t("picker.title")}
        >
          {options.map((option, index) => {
            const nodeType = nodeTypes[option.type];
            return (
              <li key={option.type}>
                <button
                  type="button"
                  id={optionId(option.type)}
                  className="picker__item"
                  role="option"
                  aria-selected={index === at}
                  tabIndex={-1}
                  onMouseEnter={() => setAt(index)}
                  onClick={() => addPickedNode(option.type, option.port)}
                >
                  <NodeTypeChip type={option.type} />
                  <span className="picker__name">
                    {localized(nodeType?.display_name, locale)}
                  </span>
                  <span className="picker__hint-text">
                    {localized(nodeType?.plain_description, locale)}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
