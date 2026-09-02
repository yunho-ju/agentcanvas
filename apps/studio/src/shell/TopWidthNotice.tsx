// 휴대폰 폭에서는 편집을 권하지 않는다 — 모바일 전용 레이아웃은 범위 밖(§10)이라
// 조용히 못 쓰게 두는 대신 한 줄로 사실을 말한다 (DESIGN §1 상단 레이어 600↓).
import { useT } from "../i18n/useT";
import { READ_ONLY_WIDTH, useWidthMatch } from "./topLayout";

export function TopWidthNotice() {
  const readOnly = useWidthMatch(READ_ONLY_WIDTH);
  const t = useT();

  if (!readOnly) return null;

  return (
    <p className="top-notice layer" role="status">
      {t("top.readOnly")}
    </p>
  );
}
