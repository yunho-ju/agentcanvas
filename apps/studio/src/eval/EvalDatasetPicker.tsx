import { useEffect, useState } from "react";
import { useT } from "../i18n/useT";
import { datasetIdForSpec, type EvalDatasetSummary } from "./dataset";
import { useEditor } from "../store/editor";

export function EvalDatasetPicker() {
  const t = useT();
  const [expanded, setExpanded] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [name, setName] = useState("");
  const specId = useEditor((state) => state.spec?.id ?? null);
  const dataset = useEditor((state) => state.dataset);
  const list = useEditor((state) => state.evalDatasetList);
  const listState = useEditor((state) => state.evalDatasetListState);
  const failure = useEditor((state) => state.evalDatasetListFailure);
  const draft = useEditor((state) => state.caseDraft);
  const saving = useEditor((state) => state.caseSaving);
  const switching = useEditor((state) => state.evalDatasetSwitching);
  const renamingBusy = useEditor((state) => state.evalDatasetRenaming);
  const loadList = useEditor((state) => state.loadEvalDatasetList);
  const switchDataset = useEditor((state) => state.switchEvalDataset);
  const detach = useEditor((state) => state.detachEvalDataset);
  const rename = useEditor((state) => state.renameEvalDataset);
  const linkedId = specId ? datasetIdForSpec(specId) : null;
  useEffect(() => { setExpanded(false); setRenameOpen(false); setName(""); }, [specId, dataset?.id]);
  if (!specId) return null;
  const blocked = Boolean(draft || saving || switching || renamingBusy);
  const isDefault = !linkedId;
  const toggle = () => {
    if (blocked) return;
    const next = !expanded;
    setExpanded(next);
    if (next) void loadList();
  };
  const saveName = async () => {
    if (await rename(name)) { setRenameOpen(false); setName(""); }
  };
  return (
    <div className="eval-dataset" aria-label={t("eval.dataset.picker")}>
      <div className="eval-dataset__header">
        <div>
          <strong className="eval-dataset__name">{dataset?.name ?? t("eval.dataset.unsaved")}</strong>
          <span className="eval-dataset__status">{isDefault ? t("eval.dataset.default") : t("eval.dataset.shared")}</span>
        </div>
        <button type="button" className="eval-dataset__pick" onClick={toggle} disabled={blocked} title={blocked ? t("eval.dataset.blocked") : undefined}>
          {t("eval.dataset.picker")}
        </button>
      </div>
      {!isDefault && !renameOpen ? <button type="button" className="eval-dataset__detach" onClick={() => void detach()} disabled={blocked}>{t("eval.dataset.detach")}</button> : null}
      {dataset && !renameOpen ? <button type="button" className="eval-dataset__rename" onClick={() => { setName(dataset.name); setRenameOpen(true); }} disabled={blocked}>{t("eval.dataset.rename")}</button> : null}
      {renameOpen ? <div className="eval-dataset__rename-form"><input aria-label={t("eval.dataset.rename")} value={name} onChange={(event) => setName(event.target.value)} /><button type="button" onClick={() => void saveName()} disabled={!name.trim() || renamingBusy}>{t("eval.dataset.rename.save")}</button><button type="button" onClick={() => setRenameOpen(false)} disabled={renamingBusy}>{t("eval.dataset.rename.cancel")}</button></div> : null}
      {expanded ? <div className="eval-dataset__list">
        {listState === "loading" ? <p>{t("eval.dataset.loading")}</p> : null}
        {listState === "failed" ? <p>{failure ? t(failure) : t("eval.dataset.failed")}</p> : null}
        {listState === "ready" && list.length === 0 ? <p>{t("eval.dataset.empty")}</p> : null}
        {listState === "ready" ? list.map((item: EvalDatasetSummary) => <button type="button" key={item.id} aria-pressed={dataset?.id === item.id} className="eval-dataset__option" onClick={() => void switchDataset(item.id)} disabled={blocked}>
          <span>{item.name}</span><span>{t("eval.dataset.count", { count: item.case_count })}</span>
        </button>) : null}
      </div> : null}
    </div>
  );
}
