import type { Metadata } from "next";
import Link from "next/link";
import { loadFeed } from "../lib/feed-data";
import { safeHttpUrl } from "../lib/format";
import { DocsNav } from "./DocsNav";
import { DOCS } from "./docs";
import styles from "./docs.module.css";

export const metadata: Metadata = {
  title: "Documentation",
  description: "Contract, integration guide, and reference for the Model Discovery Feed."
};

export const dynamic = "force-dynamic";

export default async function DocsIndex() {
  const load = await loadFeed();
  // Keep the documentation readable during an outage. Only the attribution list
  // depends on the feed, so it gets its own unavailable state.
  const attributions = load.ok ? load.feed.attributions : null;

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

        <section className={styles.sources} aria-labelledby="data-sources-title">
          <h2 id="data-sources-title" className={styles.refsTitle}>
            Data sources &amp; attribution
          </h2>
          {attributions === null ? (
            <p className={styles.sourcesEmpty}>
              This deployment cannot read its published feed release, so its data sources cannot be
              listed.
            </p>
          ) : attributions.length === 0 ? (
            <p className={styles.sourcesEmpty}>The current feed snapshot does not include data-source attributions.</p>
          ) : (
            <ul className={styles.sourceList}>
              {attributions.map((attribution) => {
                const url = safeHttpUrl(attribution.url);
                return (
                  <li key={`${attribution.source}-${attribution.url}`} className={styles.sourceRow}>
                    {url ? (
                      <a href={url} target="_blank" rel="noreferrer">
                        {attribution.source}
                      </a>
                    ) : (
                      <span>{attribution.source}</span>
                    )}
                    <span>{attribution.notice}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
