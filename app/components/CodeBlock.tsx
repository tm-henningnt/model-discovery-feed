"use client";

import { useState } from "react";
import styles from "./CodeBlock.module.css";

type Props = {
  code: string;
  label?: string;
  lang?: string;
};

export function CodeBlock({ code, label, lang }: Props) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard unavailable */
    }
  }

  return (
    <figure className={styles.block}>
      <div className={styles.chrome}>
        <span className={styles.label}>{label ?? lang ?? "code"}</span>
        <button type="button" className={styles.copy} onClick={copy} aria-live="polite">
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className={styles.pre}>
        <code>{code}</code>
      </pre>
    </figure>
  );
}
