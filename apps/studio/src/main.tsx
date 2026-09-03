// 글꼴은 번들에 함께 담는다 — 바깥 CDN을 부르지 않는다 (셀프호스트 원칙).
// 동적 subset이라 브라우저는 화면에 실제로 나온 글자의 woff2 조각만 받는다.
import "pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { SessionGate } from "./SessionGate";
import { installAuthenticatedFetch } from "./auth";
import { useEditor } from "./store/editor";

// 개발 빌드에서만 store를 창에 건다 — 실브라우저 QA가 화면 값(뷰포트·덮개)을 그대로 읽기 위해서다.
if (import.meta.env.DEV) {
  (window as Window & { __editor?: typeof useEditor }).__editor = useEditor;
}

installAuthenticatedFetch();

const container = document.getElementById("root");
if (!container) throw new Error("#root is missing from index.html");

createRoot(container).render(
  <StrictMode>
    <SessionGate>
      <App />
    </SessionGate>
  </StrictMode>,
);
