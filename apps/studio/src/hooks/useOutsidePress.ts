// 뜬 표면(팝오버·피커) 바깥을 누르면 물러난다 — 그만두는 데 버튼을 찾을 필요가 없다.
// 표면을 연 버튼 자신은 바깥이 아니다(토글과 겹쳐 닫힘→재열림이 되지 않게).
import { useEffect, useRef } from "react";
import type { RefObject } from "react";

export function useOutsidePress(
  active: boolean,
  surfaces: readonly RefObject<Element | null>[],
  onOutside: () => void,
): void {
  const surfacesRef = useRef(surfaces);
  surfacesRef.current = surfaces;
  const onOutsideRef = useRef(onOutside);
  onOutsideRef.current = onOutside;

  useEffect(() => {
    if (!active) return;
    function onPointerDown(event: PointerEvent) {
      const target = event.target as Node;
      const inside = surfacesRef.current.some((surface) => surface.current?.contains(target));
      if (inside) return;
      // 브라우저 기본 동작(누른 자리로 초점 이동)은 막지 않는다 — 막으면 입력칸을 눌러도
      // 글을 쓸 수 없고 캔버스 끌기의 첫 걸음이 사라진다 (DESIGN §7 doc-card).
      onOutsideRef.current();
    }
    // capture 단계 + pointerdown(스펙 기준) — 캔버스(react-flow)가 터치 팬을 위해
    // mousedown을 억제해도 pointerdown은 그보다 먼저 잡힌다.
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, [active]);
}
