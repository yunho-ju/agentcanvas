// 실행을 되감는 자리 — 지금 어디를 보고 있는지, 어떻게 옮기는지가 전부 여기 있다.
import { useT } from "../i18n/useT";
import { useEditor } from "../store/editor";
import { RUN_SPEEDS, currentSeq } from "../store/runSlice";

export function Timeline() {
  const events = useEditor((state) => state.runEvents);
  const seq = useEditor(currentSeq);
  const isPlaying = useEditor((state) => state.isPlaying);
  const runSpeed = useEditor((state) => state.runSpeed);
  const playRun = useEditor((state) => state.playRun);
  const pauseRun = useEditor((state) => state.pauseRun);
  const restartRun = useEditor((state) => state.restartRun);
  const setRunSpeed = useEditor((state) => state.setRunSpeed);
  const scrubToSeq = useEditor((state) => state.scrubToSeq);
  const t = useT();

  if (events.length === 0) return null;

  // 자리는 몇 번째 이벤트인가로 센다 — 이벤트 번호(seq)는 띄엄띄엄일 수 있다.
  const at = Math.max(
    0,
    events.findIndex((event) => event.seq === seq),
  );

  return (
    <section className="timeline layer" aria-label={t("timeline.label")}>
      <p className="timeline__mode">{t("timeline.mode")}</p>
      {/* 좁은 자리에서 글자가 세로로 깨지지 않도록 컨트롤은 기호로 두고,
          이름은 읽는 기계와 손 얹은 사용자 모두에게 글로 전한다. */}
      <button
        type="button"
        className="timeline__play"
        aria-label={isPlaying ? t("timeline.pause") : t("timeline.play")}
        title={isPlaying ? t("timeline.pause") : t("timeline.play")}
        onClick={isPlaying ? pauseRun : playRun}
      >
        <span aria-hidden="true">{isPlaying ? "❚❚" : "▶"}</span>
      </button>
      <button
        type="button"
        className="timeline__restart"
        aria-label={t("timeline.restart")}
        title={t("timeline.restart")}
        onClick={restartRun}
      >
        <span aria-hidden="true">↺</span>
      </button>
      <input
        className="timeline__scrubber"
        type="range"
        aria-label={t("timeline.scrubber")}
        min={0}
        max={events.length - 1}
        step={1}
        value={at}
        onChange={(event) => scrubToSeq(events[Number(event.target.value)].seq)}
      />
      <span className="timeline__position">
        {t("timeline.position", { at: at + 1, total: events.length })}
      </span>
      <label className="timeline__speed">
        {t("timeline.speed")}
        <select
          className="control control--speed"
          value={runSpeed}
          onChange={(event) => setRunSpeed(Number(event.target.value))}
        >
          {RUN_SPEEDS.map((speed) => (
            <option key={speed} value={speed}>
              {t("timeline.speedOption", { speed })}
            </option>
          ))}
        </select>
      </label>
    </section>
  );
}
