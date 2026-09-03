// AI가 지어 준 시험 제안 — 청하고, 고르고, 담는다 (DESIGN §7 eval-suggest-card, EVAL-2).
// 담기 전에는 묶음이 바뀌지 않는다: 이 화면은 store의 제안 목록을 그리고 고른 자리만 알려 준다.
import { useEffect, useMemo, useRef } from "react";
import { SUGGEST_MAX, SUGGEST_MIN, givenText, howManyIssue } from "./caseSuggestions";
import { promptsUnderTest, writtenInstructions } from "./promptsUnderTest";
import { type Message, msg } from "../i18n/messages";
import { useT } from "../i18n/useT";
import { asText, toNumber } from "../inspector/values";
import { nodeTypes } from "../registry/registry";
import { useEditor } from "../store/editor";

export function EvalSuggestCards() {
  // exportSpec 자체는 늘 같은 함수라 의존성이 되지 못한다 — 그래프가 실제로 바뀌는 nodes·edges를 본다
  // (EvalPromptList와 같은 문법). 지시문 고르기 규칙도 그 화면과 같은 한 곳이다.
  const exportSpec = useEditor((state) => state.exportSpec);
  const nodes = useEditor((state) => state.nodes);
  const edges = useEditor((state) => state.edges);
  const howMany = useEditor((state) => state.suggestHowMany);
  const edgeCases = useEditor((state) => state.suggestEdgeCases);
  const suggesting = useEditor((state) => state.suggesting);
  const suggestions = useEditor((state) => state.suggestions);
  const askedFor = useEditor((state) => state.suggestAskedFor);
  const chosen = useEditor((state) => state.suggestChosen);
  const setHowMany = useEditor((state) => state.setSuggestHowMany);
  const setEdgeCases = useEditor((state) => state.setSuggestEdgeCases);
  const suggest = useEditor((state) => state.suggestCases);
  const toggle = useEditor((state) => state.toggleSuggestion);
  const keep = useEditor((state) => state.keepChosenSuggestions);
  const discard = useEditor((state) => state.discardSuggestions);
  const focusRequest = useEditor((state) => state.suggestFocusRequest);
  const focusDone = useEditor((state) => state.suggestFocusDone);
  const count = useRef<HTMLInputElement>(null);
  const t = useT();

  // "여기서 청하세요"라고 데려가는 길 — 초점은 이 줄을 그리는 이 화면이 옮긴다
  // (skill을 만든 뒤의 [시험 짓기]. 새 표면을 만들지 않고 있던 자리로 데려간다).
  useEffect(() => {
    if (focusRequest === 0) return;
    count.current?.focus();
    focusDone();
  }, [focusRequest, focusDone]);

  // 지어 줄 수 있는 근거는 지시문이 있느냐가 아니라 무엇이 적혀 있느냐다 — 빈 지시문으로는 시험을 지을 수 없다.
  const written = useMemo(
    () => writtenInstructions(promptsUnderTest(exportSpec(), nodeTypes)),
    [exportSpec, nodes, edges],
  );

  const countIssue = howManyIssue(howMany);
  // 지어 줄 수 없는 까닭 — 지시문이 없거나, 지금 지어 보는 중이거나, 개수가 밖이다.
  const blocked: Message | null = suggesting
    ? msg("eval.suggest.blocked.asking")
    : written.length === 0
      ? msg("eval.suggest.blocked.noPrompts")
      : countIssue;

  return (
    <section className="eval-suggest" aria-label={t("eval.suggest.label")}>
      <p className="eval-suggest__label">{t("eval.suggest.label")}</p>
      <div className="eval-suggest__ask">
        <label className="eval-suggest__count" htmlFor="eval-suggest-count">
          {t("eval.suggest.count.label")}
        </label>
        <input
          id="eval-suggest-count"
          ref={count}
          className="control eval-suggest__count-input"
          type="number"
          min={SUGGEST_MIN}
          max={SUGGEST_MAX}
          value={asText(howMany)}
          onChange={(event) => setHowMany(toNumber(event.target.value))}
        />
        <label className="eval-suggest__edge">
          <input
            type="checkbox"
            checked={edgeCases}
            onChange={(event) => setEdgeCases(event.target.checked)}
          />
          {t("eval.suggest.edge.label")}
        </label>
        <button
          type="button"
          className="eval-suggest__ask-action"
          disabled={blocked !== null}
          title={blocked ? t(blocked) : undefined}
          onClick={() => void suggest()}
        >
          {t("eval.suggest.ask")}
        </button>
      </div>
      {/* 안 되는 까닭은 손이 있는 자리에서 말한다 — 개수는 그릴 때 막는다 (DESIGN §9). */}
      {countIssue ? <p className="eval-suggest__note">{t(countIssue)}</p> : null}
      {suggesting ? <p className="eval-suggest__note">{t("eval.suggest.asking")}</p> : null}
      {suggestions ? (
        <div className="eval-suggest__made">
          <p className="eval-suggest__count-note">
            {t("eval.suggest.made", { asked: askedFor, made: suggestions.length })}
          </p>
          {suggestions.map((suggestion, at) => {
            const given = givenText(suggestion.input);
            const expected = suggestion.expected_phrases.join(", ");
            return (
              <button
                // 제안은 아직 이름이 없다 — 목록 안 자리가 이 카드의 정체다(이름은 담을 때 붙는다).
                key={at}
                type="button"
                className="eval-suggest-card"
                aria-pressed={chosen.includes(at)}
                aria-label={t("eval.suggest.card.label", { title: suggestion.title })}
                onClick={() => toggle(at)}
              >
                <span className="eval-suggest-card__title">{suggestion.title}</span>
                <span className="eval-suggest-card__gist">
                  {given === ""
                    ? t("eval.suggest.card.summary.noInput", { expected })
                    : t("eval.suggest.card.summary", { given, expected })}
                </span>
              </button>
            );
          })}
          <div className="eval-suggest__actions">
            <button
              type="button"
              className="eval-suggest__keep"
              disabled={chosen.length === 0}
              title={chosen.length === 0 ? t("eval.suggest.keep.blocked") : undefined}
              onClick={() => void keep()}
            >
              {t("eval.suggest.keep")}
            </button>
            <button type="button" className="eval-suggest__discard" onClick={() => discard()}>
              {t("eval.suggest.discard")}
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
