import { type FormEvent, type ReactNode, useEffect, useState } from "react";
import { useT } from "./i18n/useT";
import { SignOutProvider } from "./shell/signOut";
import {
  AUTH_EXPIRED_EVENT,
  login,
  logout,
  readSession,
  setCsrfToken,
} from "./auth";

type GateState = "checking" | "login" | "offline" | "ready";

export function SessionGate({ children }: { children: ReactNode }) {
  const t = useT();
  const [state, setState] = useState<GateState>("checking");
  const [password, setPassword] = useState("");
  const [wrongPassword, setWrongPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function checkSession() {
    setState("checking");
    const answer = await readSession();
    if (answer === null) setState("offline");
    else setState(answer.authenticated ? "ready" : "login");
  }

  useEffect(() => {
    void checkSession();
    const expired = () => {
      setCsrfToken(null);
      setPassword("");
      setWrongPassword(false);
      setState("login");
    };
    window.addEventListener(AUTH_EXPIRED_EVENT, expired);
    return () => window.removeEventListener(AUTH_EXPIRED_EVENT, expired);
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!password || submitting) return;
    setSubmitting(true);
    setWrongPassword(false);
    const answer = await login(password);
    setPassword("");
    setSubmitting(false);
    if (answer === null) {
      setState("offline");
      return;
    }
    if (!answer.authenticated) {
      setWrongPassword(true);
      return;
    }
    setState("ready");
  }

  async function signOut() {
    await logout();
    setState("login");
  }

  // 떠나는 손잡이는 문서 메뉴가 그린다 — 캔버스 모서리에 고정 버튼을 두지 않는다 (DESIGN §1 우하).
  if (state === "ready") {
    return (
      <SignOutProvider value={() => void signOut()}>{children}</SignOutProvider>
    );
  }

  return (
    <main className="session-screen">
      <section className="session-card" aria-labelledby="session-title">
        <p className="session-card__eyebrow">AGENTCANVAS</p>
        <h1 id="session-title">{t("auth.login.title")}</h1>
        {state === "checking" ? (
          <p className="session-card__message" role="status">{t("auth.checking")}</p>
        ) : state === "offline" ? (
          <>
            <p className="session-card__message" role="alert">{t("auth.offline")}</p>
            <button className="session-card__primary" type="button" onClick={() => void checkSession()}>
              {t("auth.retry")}
            </button>
          </>
        ) : (
          <form className="session-card__form" onSubmit={(event) => void submit(event)}>
            <label htmlFor="admin-password">{t("auth.password.label")}</label>
            <input
              id="admin-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoFocus
            />
            {wrongPassword ? <p className="session-card__error" role="alert">{t("auth.wrongPassword")}</p> : null}
            <button className="session-card__primary" type="submit" disabled={!password || submitting}>
              {submitting ? t("auth.submitting") : t("auth.submit")}
            </button>
          </form>
        )}
      </section>
    </main>
  );
}
