// 제안을 사람이 보는 자리 — 새 연결이면 도구 카드, 다시 가져오기면 무엇이 달라지는지 세 묶음.
// 빠지는 것을 침묵하지 않는다 (DESIGN §7 tool-wrap-card).
import type { ResourceBinding, ToolDef } from "../generated/agent_spec";
import { type BindingField, bindingChanges, toolDiff } from "../graph/connections";
import { type MessageKey, msg } from "../i18n/messages";
import { useT } from "../i18n/useT";
import { useEditor } from "../store/editor";
import { ToolLines } from "./ToolList";
import { needsASecret } from "./resourceWords";

/** 비밀은 이름만 온다 — 값이 어디에 있는지 그 자리에서 말한다 (두 화면이 함께 쓴다). */
function SecretNote({ binding }: { binding: ResourceBinding }) {
  const t = useT();
  if (!needsASecret(binding)) return null;
  return <span className="tool-wrap-card__secret">{t("toolWrap.secret")}</span>;
}

/** 연결이 든 칸의 쉬운 이름 — 새 칸이 생기면 여기 한 줄이다 (분기 대신 표). */
const FIELD_WORDS: Record<BindingField, MessageKey> = {
  kind: "toolWrap.field.kind",
  server_ref: "toolWrap.field.serverRef",
  allowed_tools: "toolWrap.field.allowedTools",
  approval_policy: "toolWrap.field.approvalPolicy",
};

/** 도구 말고 연결 자체가 바뀌는 것 — 바뀐 칸만 말한다(그대로인 칸은 세우지 않는다). */
function BindingChanges({
  before,
  after,
}: {
  before: ResourceBinding;
  after: ResourceBinding;
}) {
  const t = useT();
  const changes = bindingChanges(before, after);
  if (changes.length === 0) return null;

  return (
    <div className="tool-wrap-card__group">
      <h3 className="tool-wrap-card__group-title">{t("toolWrap.diff.fields")}</h3>
      <ul className="tool-wrap-card__fields">
        {changes.map((change) => (
          <li className="tool-wrap-card__field" key={change.field}>
            <span className="tool-wrap-card__label">{t(FIELD_WORDS[change.field])}</span>
            <span className="tool-wrap-card__was">
              {t(
                msg("toolWrap.field.change", {
                  before: change.before === "" ? t("toolWrap.field.none") : change.before,
                  after: change.after === "" ? t("toolWrap.field.none") : change.after,
                }),
              )}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ProposedConnection({ binding }: { binding: ResourceBinding }) {
  const t = useT();

  return (
    <li className="tool-wrap-card__connection">
      <span className="tool-wrap-card__label">{t("toolWrap.review.name")}</span>
      <span className="tool-wrap-card__name">{binding.id}</span>
      <ul className="tool-wrap-card__tools">
        {(binding.tools ?? []).map((tool) => (
          <li className="tool-wrap-card__tool" key={tool.name}>
            <ToolLines tool={tool} />
          </li>
        ))}
      </ul>
      <SecretNote binding={binding} />
    </li>
  );
}

/** 다시 가져온 연결이 무엇을 바꾸는가 — 빠지는 것을 침묵하지 않는다 (DESIGN §7). */
function ToolChanges({ before, after }: { before: ToolDef[]; after: ToolDef[] }) {
  const t = useT();
  const diff = toolDiff(before, after);
  const groups: { name: MessageKey; tools: ToolDef[] }[] = [
    { name: "toolWrap.diff.added", tools: diff.added },
    { name: "toolWrap.diff.changed", tools: diff.changed },
    { name: "toolWrap.diff.removed", tools: diff.removed },
  ];

  return (
    <>
      {groups.map((group) => (
        <div className="tool-wrap-card__group" key={group.name}>
          <h3 className="tool-wrap-card__group-title">{t(group.name)}</h3>
          {group.tools.length === 0 ? (
            <p className="tool-wrap-card__label">{t("toolWrap.diff.none")}</p>
          ) : (
            <ul className="tool-wrap-card__tools">
              {group.tools.map((tool) => (
                <li className="tool-wrap-card__tool" key={tool.name}>
                  <ToolLines tool={tool} />
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
    </>
  );
}

export function Reviewing({ proposed }: { proposed: ResourceBinding[] }) {
  const apply = useEditor((state) => state.applyToolWrap);
  const rewrite = useEditor((state) => state.rewriteToolWrap);
  const error = useEditor((state) => state.toolWrapError);
  const t = useT();
  // 넣을 것이 없는 제안을 말없이 되돌리지 않는다 — 무슨 일이 있었는지 말하고 다음 걸음을 준다.
  const nothingNew = proposed.length === 0;

  return (
    <>
      <ul className="tool-wrap-card__proposed">
        {proposed.map((binding) => (
          <ProposedConnection binding={binding} key={binding.id} />
        ))}
      </ul>
      {nothingNew ? (
        <p className="tool-wrap-card__error" role="alert">
          {t("toolWrap.error.nothingNew")}
        </p>
      ) : error ? (
        <p className="tool-wrap-card__error" role="alert">
          {t(error)}
        </p>
      ) : null}
      <div className="tool-wrap-card__actions">
        {nothingNew ? null : (
          <button
            type="button"
            className="button-primary"
            title={t("toolWrap.apply.hint")}
            onClick={apply}
          >
            {t("toolWrap.apply")}
          </button>
        )}
        <button
          type="button"
          className="button-ghost"
          title={t("toolWrap.back.hint")}
          onClick={rewrite}
        >
          {t("toolWrap.back")}
        </button>
      </div>
    </>
  );
}

export function ReviewingSwap({
  before,
  after,
}: {
  before: ResourceBinding;
  after?: ResourceBinding;
}) {
  const apply = useEditor((state) => state.applyToolWrap);
  const rewrite = useEditor((state) => state.rewriteToolWrap);
  const error = useEditor((state) => state.toolWrapError);
  const t = useT();
  // 대상 연결에 대한 답이 없으면 넣을 것도 없다 — 버튼을 세워 두고 아무 일도 없게 하지 않는다.
  const nothingSwapped = after === undefined;

  return (
    <>
      {after ? (
        <>
          <BindingChanges before={before} after={after} />
          <ToolChanges before={before.tools ?? []} after={after.tools ?? []} />
          <SecretNote binding={after} />
        </>
      ) : null}
      {nothingSwapped ? (
        <p className="tool-wrap-card__error" role="alert">
          {t("toolWrap.error.nothingSwapped")}
        </p>
      ) : error ? (
        <p className="tool-wrap-card__error" role="alert">
          {t(error)}
        </p>
      ) : null}
      <div className="tool-wrap-card__actions">
        {nothingSwapped ? null : (
        <button
          type="button"
          className="button-primary"
          title={t("toolWrap.apply.hint")}
          onClick={apply}
        >
          {t("toolWrap.apply")}
        </button>
        )}
        <button
          type="button"
          className="button-ghost"
          title={t("toolWrap.back.hint")}
          onClick={rewrite}
        >
          {t("toolWrap.back")}
        </button>
      </div>
    </>
  );
}

