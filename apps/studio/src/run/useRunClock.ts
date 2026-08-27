// 재생을 움직이는 시계 — store 밖에 있는 유일한 시간이다.
// 화면이 한 장 그려질 때마다 그 사이에 흐른 시간을 store에 알린다.
import { useEffect } from "react";
import { useEditor } from "../store/editor";

export function useRunClock() {
  const isPlaying = useEditor((state) => state.isPlaying);
  const tickRun = useEditor((state) => state.tickRun);

  useEffect(() => {
    if (!isPlaying) return;
    // 첫 프레임은 기준점만 잡는다 — 언제부터 재기 시작했는지 모르면 흐른 시간도 알 수 없다.
    let previous: number | null = null;
    let frame = requestAnimationFrame(function step(now: number) {
      if (previous !== null) tickRun(now - previous);
      previous = now;
      frame = requestAnimationFrame(step);
    });
    return () => cancelAnimationFrame(frame);
  }, [isPlaying, tickRun]);
}
