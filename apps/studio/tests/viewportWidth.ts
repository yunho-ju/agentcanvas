// 화면 폭을 가장한다 — jsdom에는 matchMedia가 없어서, 폭이 정하는 접힘을 테스트에서 세우려면
// 이 자리에서 폭을 말해 줘야 한다. 질의는 화면 코드가 쓰는 그 문자열 그대로 해석한다.
import { vi } from "vitest";

/** `(max-width: 900px)` 같은 질의를 이 폭으로 답한다. 해석 못 할 질의는 맞지 않는다고 답한다. */
export function viewportWidth(pixels: number) {
  vi.stubGlobal("matchMedia", (query: string) => {
    const limit = /max-width:\s*(\d+)px/.exec(query);
    return {
      matches: limit !== null && pixels <= Number(limit[1]),
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    };
  });
}
