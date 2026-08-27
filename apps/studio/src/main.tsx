// 글꼴은 번들에 함께 담는다 — 바깥 CDN을 부르지 않는다 (셀프호스트 원칙).
// 동적 subset이라 브라우저는 화면에 실제로 나온 글자의 woff2 조각만 받는다.
import "pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { SessionGate } from "./SessionGate";
import { installAuthenticatedFetch } from "./auth";

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
