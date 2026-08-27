import "@testing-library/jest-dom/vitest";
import { beforeEach } from "vitest";
import { setLocale } from "./src/i18n/localeStore";

// jsdom에는 ResizeObserver가 없다 — xyflow가 캔버스 크기를 재려고 찾는다.
if (!("ResizeObserver" in globalThis)) {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

// jsdom에는 DOMMatrixReadOnly가 없다 — xyflow가 화면 배율(m22)을 읽으려고 찾는다.
// 시험 화면은 언제나 배율 1이다 (브라우저에는 있는 API라 테스트 환경만 채워 준다).
if (!("DOMMatrixReadOnly" in globalThis)) {
  globalThis.DOMMatrixReadOnly = class {
    m22 = 1;
  } as unknown as typeof DOMMatrixReadOnly;
}

// 이 실행 환경의 jsdom에는 localStorage가 없다 — 브라우저에는 있는 API라 테스트 환경만 채워 준다.
if (!("localStorage" in globalThis) || globalThis.localStorage === undefined) {
  const kept = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => kept.get(key) ?? null,
      setItem: (key: string, value: string) => kept.set(key, String(value)),
      removeItem: (key: string) => kept.delete(key),
      clear: () => kept.clear(),
    },
  });
}

// 화면 문구를 한국어로 고정한다 — 언어를 바꾸는 테스트는 스스로 setLocale을 부른다.
beforeEach(() => {
  localStorage.clear();
  setLocale("ko");
});

// jsdom 25에는 Blob.text()가 없다 — 브라우저에는 있는 API라 테스트 환경만 채워 준다.
if (typeof Blob.prototype.text !== "function") {
  Blob.prototype.text = function readAsText(this: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsText(this);
    });
  };
}
