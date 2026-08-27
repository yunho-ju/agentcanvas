// 글로 편집하는 값(줄 목록, JSON)은 편집 중에는 화면의 원문이 주인이다.
// config로 옮기면 사라지는 글자(끝의 빈 줄, 아직 닫히지 않은 괄호)를 지키기 위한 훅.
import { useEffect, useRef, useState } from "react";
import { useEditor } from "../store/editor";
import { isRunning } from "../store/runSlice";

export interface TextDraft {
  text: string;
  /** 아직 값으로 읽을 수 없는 글자 */
  broken: boolean;
  setText: (next: string) => void;
}

export function useTextDraft(
  value: unknown,
  toText: (value: unknown) => string,
  parse: (text: string) => { ok: boolean; value?: unknown },
  onChange: (value: unknown) => void,
): TextDraft {
  const [text, setText] = useState(() => toText(value));
  const [broken, setBroken] = useState(false);
  const latest = useRef(text);
  latest.current = text;
  // 실행을 보는 동안에는 편집이 잠긴다 — 쓰다 만 글자가 편집 시간으로 새어 들어가면 안 된다.
  const locked = useEditor(isRunning);

  useEffect(() => {
    // 밖에서 값이 바뀐 경우(되돌리기 등)에만 다시 읽는다. 잠기는 순간에는 무조건 저장된 값으로 돌아간다.
    const parsed = parse(latest.current);
    if (!locked && parsed.ok && JSON.stringify(parsed.value) === JSON.stringify(value)) {
      return;
    }
    setText(toText(value));
    setBroken(false);
  }, [value, parse, toText, locked]);

  return {
    text,
    broken,
    setText: (next: string) => {
      if (locked) return;
      setText(next);
      const parsed = parse(next);
      setBroken(!parsed.ok);
      if (parsed.ok) onChange(parsed.value);
    },
  };
}
