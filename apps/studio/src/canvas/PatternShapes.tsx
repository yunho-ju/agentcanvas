// 이 서버가 놓아 줄 수 있는 모양들 (DESIGN §7 palette, 설계 문서 D12).
// 한 줄 = 짧은 이름 + 대가. 누르면 그 모양의 카드·선이 한 번에 놓이고 되돌리기 한 걸음이다 —
// 놓을 수 없으면 그 자리에서 까닭을 말한다(store가 안다). 코드 이름은 화면에 나가지 않는다(D14).
import { useEffect } from "react";
import { localized } from "../i18n/locale";
import { useFocusInspector } from "../inspector/inspectorFocus";
import { useLocale, useT } from "../i18n/useT";
import { thisScreenCanDraw } from "../registry/patternCatalog";
import { LOCKED_HINT } from "../run/lockWords";
import { useEditor } from "../store/editor";
import { isRunning } from "../store/runSlice";

export function PatternShapes() {
  const patterns = useEditor((state) => state.serverPatterns);
  const loadServerPatterns = useEditor((state) => state.loadServerPatterns);
  const putPattern = useEditor((state) => state.putPattern);
  const running = useEditor(isRunning);
  const takeMeThere = useFocusInspector();
  const locale = useLocale();
  const t = useT();

  useEffect(() => {
    void loadServerPatterns();
  }, [loadServerPatterns]);

  const shapes = (patterns ?? []).filter(thisScreenCanDraw);
  // 이 서버가 놓아 줄 모양을 못 들었으면 이 구역 자체가 없다 — 빈 제목을 세우지 않는다.
  if (shapes.length === 0) return null;

  return (
    <>
      <h3 className="palette__section palette__shapes">{t("palette.patterns")}</h3>
      <ul className="palette__list">
        {shapes.map((shape) => (
          <li key={shape.id}>
            <button
              type="button"
              className="palette__shape"
              disabled={running}
              title={running ? t(LOCKED_HINT) : localized(shape.cost, locale)}
              // 놓았으면 그 단계의 설정으로 데려간다 — 설정만 바뀐 모양도 바뀐 칸을 보게 된다
              // (저장 알림의 '보러 가기'와 같은 걸음). 놓지 못했으면 말만 서고 자리는 그대로다.
              onClick={() => {
                if (putPattern(shape.id)) takeMeThere();
              }}
            >
              <span className="palette__name">{localized(shape.shortName, locale)}</span>
              <span className="palette__hint">{localized(shape.cost, locale)}</span>
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}
