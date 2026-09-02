// 이 문서가 든 도구를 팔레트에서 바로 끌어 쓴다 (DESIGN §7 palette — 문서 도구 섹션).
// 칩 하나 = 연결 하나의 도구 하나. 누르면 그 두 칸이 채워진 노드가 놓인다.
import type { ResourceBinding, ToolDef } from "../generated/agent_spec";
import { localized } from "../i18n/locale";
import { useLocale, useT } from "../i18n/useT";
import { useDocResources } from "../inspector/useDocResources";
import { LOCKED_HINT } from "../run/lockWords";
import { toolHost } from "../registry/registry";
import { useEditor } from "../store/editor";
import { isRunning } from "../store/runSlice";

/** 문서가 든 도구들 — 어느 연결의 것인지 함께 든다. */
function toolsOf(bindings: ResourceBinding[]): { binding: string; tool: ToolDef }[] {
  return bindings.flatMap((binding) =>
    (binding.tools ?? []).map((tool) => ({ binding: binding.id, tool })),
  );
}

// 놓이는 자리는 누르는 순간의 캔버스가 정한다 — 칩의 순서와 상관없다 (DESIGN §7 palette 배치).
export function DocTools({ at }: { at: () => { x: number; y: number } }) {
  const { bindings } = useDocResources();
  const addNode = useEditor((state) => state.addNode);
  const running = useEditor(isRunning);
  const locale = useLocale();
  const t = useT();

  const host = toolHost();
  const tools = toolsOf(bindings);
  // 들 것이 없으면 제목도 세우지 않는다 — 빈 섹션은 만드는 길을 말해 주지 않는다.
  if (!host || tools.length === 0) return null;

  return (
    <>
      <h3 className="palette__section">{t("palette.docTools")}</h3>
      <ul className="palette__list">
        {tools.map(({ binding, tool }) => (
          <li key={`${binding}/${tool.name}`}>
            <button
              type="button"
              className="palette__tool"
              disabled={running}
              title={
                running ? t(LOCKED_HINT) : localized(tool.plain_description, locale)
              }
              onClick={() =>
                addNode(host.type, at(), {
                  [host.bindingField]: binding,
                  [host.toolNameField]: tool.name,
                })
              }
            >
              <span className="palette__name">{tool.name}</span>
              <span className="palette__hint">
                {localized(tool.plain_description, locale)}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}
