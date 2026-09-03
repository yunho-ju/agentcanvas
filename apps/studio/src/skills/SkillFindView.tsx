// skill 찾아보기 (DESIGN §7 skill-find) — 가져오기 카드의 세 번째 입력 종류.
// 카드의 표면(모달·미리보기)은 skill-import-card의 것을 그대로 쓰고, 이 파일은
// **무엇을 찾아 어떻게 보여 주는가** 하나만 안다 (붙여넣기·주소와는 바뀔 이유가 다르다).
import { useEffect, useMemo, useRef } from "react";
import { type FoundOrigin, type FoundSkill } from "../graph/skillHits";
import { type Message, type MessageKey, msg } from "../i18n/messages";
import { useT } from "../i18n/useT";
import { useEditor } from "../store/editor";
import { foundSkills } from "../store/skillFindSlice";
import { docSkills } from "../store/skillSlice";
import { SkillBody } from "./SkillBody";

/** 줄 하나가 어디서 왔는지 말하는 캡션 — origin이 늘면 여기 한 줄이다 (분기 대신 표). */
const ORIGIN_WORDS: Record<FoundOrigin, MessageKey> = {
  document: "skillFind.origin.document",
  starter: "skillFind.origin.starter",
  remote: "skillFind.origin.remote",
};

/** 이 줄이 무엇이라 말하는가 — 출처 · 설치 수 · 이미 있음, 있는 것만 이어 붙인다. */
function rowCaption(found: FoundSkill, t: (message: Message) => string): string {
  const said = [t(msg(ORIGIN_WORDS[found.origin], { where: found.ownerRepo ?? "" }))];
  // 인기는 근거가 아니라 참고다 — 배지 없이 숫자만 말한다 (DESIGN §7 skill-find).
  if (found.installs !== null) {
    said.push(t(msg("skillFind.installs", { count: found.installs.toLocaleString("en-US") })));
  }
  if (found.alreadyHave) said.push(t(msg("skillFind.already")));
  return said.join(" · ");
}

/**
 * 무엇을 잘하게 하고 싶은지 물으면 찾아 주는 자리 (DESIGN §7 skill-find).
 * 누르면 origin마다 길이 다르다 — 문서의 것은 읽고, 그 밖의 것은 읽어 보고 넣는다.
 */
export function SkillFindView() {
  const query = useEditor((state) => state.skillFindQuery);
  const asked = useEditor((state) => state.skillFindAsked);
  const hits = useEditor((state) => state.skillFindHits);
  const searching = useEditor((state) => state.skillFindLoading);
  const reached = useEditor((state) => state.skillFindRemoteReached);
  const reading = useEditor((state) => state.skillFindReading);
  const bringing = useEditor((state) => state.skillImportLoading);
  const error = useEditor((state) => state.skillImportError);
  const issues = useEditor((state) => state.skillImportIssues);
  const skills = useEditor(docSkills);
  const setQuery = useEditor((state) => state.setSkillFindQuery);
  const find = useEditor((state) => state.findSkills);
  const open = useEditor((state) => state.openFoundSkill);
  const box = useRef<HTMLInputElement>(null);
  const t = useT();
  // 합치는 규칙은 store와 같은 한 곳이다 — 화면이 셈을 다시 적지 않는다.
  const found = useMemo(() => foundSkills(useEditor.getState()), [hits, asked, skills]);
  const empty = query.trim() === "";
  const busy = searching || bringing;

  // 열리면 손은 적을 자리에 놓인다 (가져오기 카드와 같은 규칙).
  useEffect(() => box.current?.focus(), []);

  return (
    <>
      <label className="skill-import-card__label" htmlFor="skill-find-query">
        {t("skillFind.label")}
      </label>
      <input
        id="skill-find-query"
        ref={box}
        type="text"
        className="control"
        value={query}
        disabled={busy}
        placeholder={t("skillFind.placeholder")}
        onChange={(event) => setQuery(event.target.value)}
      />
      <div className="skill-import-card__actions">
        <button
          type="button"
          className="button-primary"
          disabled={empty || busy}
          title={empty ? t("skillFind.search.disabled") : t("skillFind.search.hint")}
          onClick={() => void find()}
        >
          {t("skillFind.search")}
        </button>
        <button
          type="button"
          className="button-ghost"
          disabled={busy}
          title={t("skillImport.cancel.hint")}
          onClick={useEditor.getState().closeSkillImport}
        >
          {t("skillImport.cancel")}
        </button>
      </div>
      {searching ? (
        <p className="skill-import-card__status" role="status">
          {t("skillFind.loading")}
        </p>
      ) : null}
      {bringing ? (
        <p className="skill-import-card__status" role="status">
          {t("skillImport.loading")}
        </p>
      ) : null}
      {found.length > 0 ? (
        <div
          className="skill-import-card__results"
          role="group"
          aria-label={t("skillFind.results")}
        >
          {found.map((one) => (
            <button
              key={one.key}
              type="button"
              className="skill-import-card__starter"
              disabled={busy}
              // 전체 주소는 캡션이 아니라 여기서 말한다 (원문을 늘어놓지 않는다).
              title={one.url ?? t(one.ref ? "skillFind.read.hint" : "skillFind.bring.hint")}
              onClick={() => void open(one)}
            >
              <span className="skill-import-card__starter-name">{one.name}</span>
              <span className="skill-import-card__starter-what">{rowCaption(one, t)}</span>
              {/* 설명은 그 skill이 스스로 적은 글이다(사전을 거치지 않는다). 모르는 줄에는
                  없다 — 이름만으로 고르게 하지도, 모르는 것을 지어내지도 않는다. */}
              {one.description ? (
                <span className="skill-import-card__starter-what">{one.description}</span>
              ) : null}
            </button>
          ))}
        </div>
      ) : null}
      {/* 닿지 못한 것을 빈 결과로 둔갑시키지 않는다 (§9). */}
      {hits !== null && !reached && !searching ? (
        <span className="skill-import-card__warn">{t("skillFind.unreachable")}</span>
      ) : null}
      {hits !== null && found.length === 0 && !searching ? (
        <p className="skill-import-card__what">{t("skillFind.empty")}</p>
      ) : null}
      {/* 닿지 못한 까닭이 있으면 그것을, 없으면 읽지 못한 까닭들을 말한다
          (가져오기·만들기 카드와 같은 규칙 — 말없이 삼키면 줄이 죽은 것이 된다). */}
      {(error ? [error] : issues).length > 0 ? (
        <div className="skill-import-card__trouble" role="alert">
          {(error ? [error] : issues).map((line) => (
            <p className="skill-import-card__error" key={line.key}>
              {t(line)}
            </p>
          ))}
        </div>
      ) : null}
      {/* 이 문서가 이미 가진 글은 그 자리에서 읽는다 — 새 레이어를 세우지 않는다. */}
      {reading ? <SkillBody body={reading.body} /> : null}
    </>
  );
}
