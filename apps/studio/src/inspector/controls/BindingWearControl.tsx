// 이 단계가 쓸 도구를 고르는 칸 (DESIGN §7 agent-turns) — 셀렉트도, 글 상자도 아닌 체크 목록이다.
// 글자로 적게 두면 오타 이름이 '고른 것'으로 세어져 화면이 거짓을 말한다.
import { localized } from "../../i18n/locale";
import type { MessageKey } from "../../i18n/messages";
import { useLocale, useT } from "../../i18n/useT";
import { toolsUnsupported } from "../../registry/modelOptions";
import { modelRefOf } from "../../registry/registry";
import { selectedNode, useEditor } from "../../store/editor";
import { bindingFilterName, bindingPickRows, pickedRefs } from "../bindingPicks";
import { useDocResources } from "../useDocResources";
import type { ControlProps } from "./types";

/** 이 서버가 "그 모델은 도구를 못 쓴다"고 말했는가 — 못 물었으면 잠그지 않는다. */
function useToolsOutOfReach(): boolean {
  const node = useEditor(selectedNode);
  const server = useEditor((state) => state.serverModels);
  const nodeType = node?.data.nodeType;
  const ref = node && nodeType ? modelRefOf(node.data.spec, nodeType) : undefined;
  return toolsUnsupported(ref, server);
}

export function BindingWearControl(props: ControlProps) {
  const locale = useLocale();
  const t = useT();
  const { bindings } = useDocResources();
  const outOfReach = useToolsOutOfReach();

  const picked = pickedRefs(props.value);
  const rows = bindingPickRows(bindings, bindingFilterName(props.field.schema), picked);
  const offered = rows.filter((row) => row.known);
  const locked = props.disabled === true || outOfReach;

  const reason: MessageKey | undefined = outOfReach
    ? "event.run.failed.tools_unsupported"
    : bindings.length === 0
      ? "control.bindingSelect.empty"
      : offered.length === 0
        ? "control.bindingWear.noTools"
        : undefined;
  const reasonId = `${props.id}-reason`;

  function toggle(id: string, on: boolean) {
    // 고르는 일은 글자를 이어 적는 일과 다르다 — 고를 때마다 되돌릴 걸음 하나다.
    props.onChange(on ? [...picked, id] : picked.filter((one) => one !== id), {
      merge: false,
    });
  }

  return (
    <div
      className="binding-wear"
      role="group"
      aria-label={localized(props.field.label, locale)}
      aria-describedby={[props.describedBy, reason ? reasonId : undefined]
        .filter(Boolean)
        .join(" ")
        .trim() || undefined}
    >
      {rows.length === 0 ? null : (
        <ul className="binding-wear__list">
          {rows.map((row) => (
            <li className="binding-wear__row" key={row.id}>
              <label className="binding-wear__pick">
                <input
                  type="checkbox"
                  className="control control--check"
                  checked={picked.includes(row.id)}
                  disabled={locked}
                  title={locked ? props.title : undefined}
                  onChange={(event) => toggle(row.id, event.target.checked)}
                />
                <span className="binding-wear__name">{row.id}</span>
              </label>
              {row.known ? (
                <span className="binding-wear__what">
                  {t("control.bindingWear.tools", { count: row.toolCount })}
                </span>
              ) : (
                <>
                  <span className="binding-wear__warn">
                    {t("control.bindingWear.unknown", { name: row.id })}
                  </span>
                  <button
                    type="button"
                    className="button-ghost binding-wear__remove"
                    disabled={locked}
                    onClick={() => toggle(row.id, false)}
                  >
                    {t("control.bindingWear.remove")}
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      {reason ? (
        <span className="control__hint" id={reasonId}>
          {t(reason)}
        </span>
      ) : null}
    </div>
  );
}
