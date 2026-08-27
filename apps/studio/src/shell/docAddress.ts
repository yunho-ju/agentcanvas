// 지금 어느 문서를 보고 있는지는 주소가 말해 준다 — 주소를 복사해 주면 같은 문서가 열린다.
// 브라우저의 주소창을 만지는 곳은 이 파일뿐이고, 주소를 읽고 짓는 일은 순수 함수다.

/** 주소의 물음표 뒤에서 문서를 가리키는 이름표. */
export const DOC_PARAM = "doc";

/** 주소창이 지키는 약속 — 시험은 이 자리에 기억만 하는 가짜를 꽂는다. */
export interface DocAddress {
  /** 주소가 가리키는 문서 — 아무것도 가리키지 않으면 없다 */
  docId: () => string | null;
  /** 이 문서를 주소에 남긴다 (없음이면 지운다) */
  remember: (id: string | null) => void;
}

/** 주소의 물음표 뒤에서 문서 이름을 찾는다. */
export function docIdIn(search: string): string | null {
  const found = new URLSearchParams(search).get(DOC_PARAM);
  return found === null || found === "" ? null : found;
}

/** 문서 이름을 남긴(또는 지운) 물음표 뒤를 돌려준다 — 다른 값들은 건드리지 않는다. */
export function searchWithDoc(search: string, id: string | null): string {
  const params = new URLSearchParams(search);
  if (id === null) {
    params.delete(DOC_PARAM);
  } else {
    params.set(DOC_PARAM, id);
  }
  const written = params.toString();
  return written === "" ? "" : `?${written}`;
}

/** 진짜 주소창. */
export const browserAddress: DocAddress = {
  docId: () => docIdIn(window.location.search),
  // 같은 자리에 머무르며 주소만 고쳐 적는다 — 뒤로 가기에 걸음을 쌓지 않는다.
  remember: (id) =>
    window.history.replaceState(
      null,
      "",
      `${window.location.pathname}${searchWithDoc(window.location.search, id)}${window.location.hash}`,
    ),
};
