import type { Metadata } from "next";
import Link from "next/link";
import { DocsNav } from "./DocsNav";
import { DOCS } from "./docs";
import styles from "./docs.module.css";

export const metadata: Metadata = {
  title: "Documentation",
  description: "Contract, integration guide, and reference for the Model Discovery Feed."
};

export default function DocsIndex() {
  return (
    <div className={`page ${styles.shell}`}>
      <DocsNav />
      <div className={styles.main}>
        <header className={styles.docsHeader}>
          <p className="eyebrow">Documentation</p>
          <h1>Build against the feed.</h1>
          <p className={styles.lead}>
            Everything you need to consume or implement the Model Discovery Feed contract — the object
            model, HTTP endpoints, caching, and the adapter boundary that keeps feed data separate from
            your client config.
          </p>
        </header>

        <div className={styles.cards}>
          {DOCS.map((doc) => (
            <Link key={doc.slug} href={`/docs/${doc.slug}`} className={styles.card}>
              <h2>{doc.title}</h2>
              <p>{doc.summary}</p>
              <span className={styles.cardLink}>Read →</span>
            </Link>
          ))}
        </div>

        <section className={styles.refs}>
          <h2 className={styles.refsTitle}>Machine-readable reference</h2>
          <div className={styles.refRow}>
            <a href="/v1/schema" className="mono">
              GET /v1/schema
            </a>
            <span>Authoritative JSON Schema for feed documents.</span>
          </div>
          <div className={styles.refRow}>
            <a href="/v1/feed" className="mono">
              GET /v1/feed
            </a>
            <span>The current feed snapshot as served by this deployment.</span>
          </div>
        </section>
      </div>
    </div>
  );
}
