// 도구 하나를 쉬운 말로 읽는 자리 — 이름·설명·무엇을 주면 무엇을 받는가.
// 패널(읽기)과 미리보기 카드(승인 전)가 같은 말로 도구를 보여 준다.
import type { ToolDef } from "../generated/agent_spec";
import { localized } from "../i18n/locale";
import { msg } from "../i18n/messages";
import { useLocale, useT } from "../i18n/useT";
import { toolShape } from "./resourceWords";

export function ToolLines({ tool }: { tool: ToolDef }) {
  const locale = useLocale();
  const t = useT();
  const shape = toolShape(tool);
  const listed = (titles: { ko: string; en: string }[]) =>
    titles.map((title) => localized(title, locale)).join(", ") ||
    t("toolWrap.tool.io.unknown");

  return (
    <>
      <span className="tool-lines__name">{tool.name}</span>
      <span className="tool-lines__what">{localized(tool.plain_description, locale)}</span>
      <span className="tool-lines__shape">
        {t(
          msg("toolWrap.tool.io", {
            inputs: listed(shape.inputs),
            outputs: listed(shape.outputs),
          }),
        )}
      </span>
    </>
  );
}
