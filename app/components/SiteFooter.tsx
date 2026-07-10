import Link from "next/link";
import { Wordmark } from "./Wordmark";
import styles from "./SiteFooter.module.css";

const REPO_URL = "https://github.com/tm-henningnt/model-discovery-feed";

export function SiteFooter() {
  return (
    <footer className={styles.footer}>
      <div className={`page ${styles.inner}`}>
        <div className={styles.brandCol}>
          <div className={styles.brand}>
            <Wordmark size={20} />
            <span>Model Discovery Feed</span>
          </div>
          <p className={styles.tagline}>
            A provider-agnostic contract for discovering LLM model offerings. Reference implementation,
            not an inference proxy.
          </p>
          <p className={styles.meta}>
            <span className="mono">schema_version 1.0.0</span> · MIT License
          </p>
        </div>

        <nav className={styles.links} aria-label="Footer">
          <div className={styles.group}>
            <h2>Explore</h2>
            <Link href="/">Overview</Link>
            <Link href="/explore">Browse the feed</Link>
            <Link href="/docs">Documentation</Link>
          </div>
          <div className={styles.group}>
            <h2>Contract</h2>
            <Link href="/docs/model-discovery-feed">Feed contract</Link>
            <Link href="/docs/client-integration-guide">Integration guide</Link>
            <a href="/v1/schema">JSON Schema</a>
          </div>
          <div className={styles.group}>
            <h2>Endpoints</h2>
            <a href="/v1/feed" className="mono">/v1/feed</a>
            <a href="/v1/models" className="mono">/v1/models</a>
            <a href="/v1/status" className="mono">/v1/status</a>
          </div>
          <div className={styles.group}>
            <h2>Source</h2>
            <a href={REPO_URL} target="_blank" rel="noreferrer">GitHub</a>
            <a href={`${REPO_URL}/issues`} target="_blank" rel="noreferrer">Issues</a>
          </div>
        </nav>
      </div>
    </footer>
  );
}
