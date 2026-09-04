// 제안이 가리키는 모양의 짧은 이름 — 카탈로그는 서버의 것이고, 화면은 이름만 읽는다.
import { useEffect } from "react";
import { localized } from "../i18n/locale";
import { useLocale } from "../i18n/useT";
import { useEditor } from "../store/editor";

/** 이 id의 짧은 이름 — 가리키는 모양이 없거나 목록을 못 들었으면 없다(코드 이름을 보이지 않는다). */
export function useShapeName(patternId: string | null | undefined): string | null {
  const patterns = useEditor((state) => state.serverPatterns);
  const loadServerPatterns = useEditor((state) => state.loadServerPatterns);
  const locale = useLocale();
  // 부를 이름이 생겼을 때만 묻는다 — 고치기를 한 번도 열지 않는 사람은 이 길에 오지 않고,
  // 한 번 못 들었어도 다음 제안이 모양을 가리키면 다시 묻는다(한 번의 실패로 갇히지 않는다).
  useEffect(() => {
    if (!patternId) return;
    void loadServerPatterns();
  }, [patternId, loadServerPatterns]);
  if (!patternId) return null;
  const shape = patterns?.find((pattern) => pattern.id === patternId);
  return shape ? localized(shape.shortName, locale) : null;
}
