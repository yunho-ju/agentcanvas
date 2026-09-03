import "@testing-library/jest-dom/vitest";
import { beforeEach } from "vitest";
import { setLocale } from "./src/i18n/localeStore";
import { useEditor } from "./src/store/editor";

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
// 문서 카드 위의 팝오버(문서 메뉴·판 기록) 열림도 store의 것이라 시험 사이에 남는다 —
// 어느 시험이든 닫힌 자리에서 시작한다 (DESIGN §7 doc-card).
// 모델 피커는 서면서 서버에게 묻는다: 시험이 진짜 그물을 타지 않도록 여기서 "못 물었다"를
// 기본으로 꽂아 둔다(파이썬 conftest의 no_real_model과 같은 뜻). 서버 답을 보고 싶은 시험은
// 스스로 제 대역을 꽂는다.
beforeEach(() => {
  localStorage.clear();
  setLocale("ko");
  useEditor.setState({
    serverModels: null,
    fetchServerModels: async () => null,
    docPopover: "closed",
  });
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
