"use client";

import { Suspense, useActionState } from "react";
import { useSearchParams } from "next/navigation";
import { Wordmark } from "../components/Wordmark";
import { login, type LoginState } from "./actions";
import styles from "./login.module.css";

const initialState: LoginState = {};

export default function LoginPage() {
  return (
    <div className={`page ${styles.wrap}`}>
      <div className={`panel ${styles.card}`}>
        <Wordmark size={32} />
        <h1 className={styles.title}>Enter the feed key</h1>
        <p className={styles.lede}>This deployment requires a key to view the site.</p>
        <Suspense fallback={<LoginForm from="/" />}>
          <LoginFormWithFrom />
        </Suspense>
      </div>
    </div>
  );
}

function LoginFormWithFrom() {
  const searchParams = useSearchParams();
  const from = searchParams.get("from") ?? "/";
  return <LoginForm from={from} />;
}

function LoginForm({ from }: { from: string }) {
  const [state, formAction, pending] = useActionState(login, initialState);

  return (
    <form action={formAction} className={styles.form}>
      <input type="hidden" name="from" value={from} />
      <div className={styles.field}>
        <label className={styles.label} htmlFor="key">
          Feed key
        </label>
        <input
          id="key"
          type="password"
          name="key"
          autoComplete="current-password"
          required
          className={styles.input}
        />
      </div>
      {state.error ? (
        <p className={styles.error} role="alert">
          {state.error}
        </p>
      ) : null}
      <button type="submit" className={`btn btn-primary ${styles.submit}`} disabled={pending}>
        {pending ? "Checking…" : "Continue"}
      </button>
    </form>
  );
}
