import Link from "next/link";
import { isConfidentlyFree } from "@/feed/classification";
import type { FeedDocument } from "@/feed/schema";
import { CodeBlock } from "./components/CodeBlock";
import { FeedReleaseNotice } from "./components/FeedReleaseNotice";
import { FeedUnavailable } from "./components/FeedUnavailable";
import { loadFeed } from "./lib/feed-data";
import { capabilityLabel, formatRelativeTime, formatTokens } from "./lib/format";
import styles from "./home.module.css";

export const dynamic = "force-dynamic";

const ENDPOINTS = [
  { method: "GET", path: "/v1/feed", purpose: "Latest feed snapshot (ETag + conditional requests)." },
  { method: "GET", path: "/v1/models", purpose: "Model offerings with additive filtering." },
  { method: "GET", path: "/v1/models/{id}", purpose: "A single model offering by id." },
  { method: "GET", path: "/v1/providers", purpose: "Providers with additive filtering." },
  { method: "GET", path: "/v1/status", purpose: "Freshness, counts, and collector health." },
  { method: "GET", path: "/v1/schema", purpose: "Authoritative JSON Schema for the contract." }
];

const OBJECTS = [
  {
    name: "provider",
    body: "A runtime or vendor a client can call — its protocols, authentication, and signup requirements."
  },
  {
    name: "model_offering",
    body: "A provider-specific way to call a model: endpoint, capabilities, limits, pricing, and availability."
  },
  {
    name: "profile",
    body: "A feed-authored recommendation over one or more offerings, with the criteria behind it."
  },
  {
    name: "source_claim",
    body: "Provenance for every fact — where it came from, when it was observed, and how confident the feed is."
  }
];

function specimen(feed: FeedDocument): string {
  const model = feed.models.find((m) => m.policy.visibility === "listed");
  if (!model) return "{}";
  const trimmed = {
    id: model.id,
    object: model.object,
    display_name: model.display_name,
    provider: model.provider,
    capabilities: model.capabilities,
    limits: model.limits,
    pricing: {
      kind: model.pricing.kind,
      input_usd_per_1m_tokens: model.pricing.input_usd_per_1m_tokens,
      output_usd_per_1m_tokens: model.pricing.output_usd_per_1m_tokens,
      free: model.pricing.free
        ? {
            is_currently_free: model.pricing.free.is_currently_free,
            basis: model.pricing.free.basis,
            last_verified_at: model.pricing.free.last_verified_at,
            confidence: model.pricing.free.confidence
          }
        : null
    },
    availability: { status: model.availability.status },
    policy: { visibility: model.policy.visibility, tags: model.policy.tags }
  };
  return JSON.stringify(trimmed, null, 2);
}

export default async function Home() {
  const load = await loadFeed();
  if (!load.ok) {
    return (
      <section className={`page ${styles.hero}`}>
        <FeedUnavailable surface="the overview" />
      </section>
    );
  }

  const { feed, status, usingFixture } = load;
  const now = new Date();
  const freeCount = feed.models.filter((m) => isConfidentlyFree(m, now)).length;
  const capabilities = Array.from(new Set(feed.models.flatMap((m) => m.capabilities)));
  const maxContext = Math.max(0, ...feed.models.map((m) => m.limits.context_tokens ?? 0));

  return (
    <>
      <section className={`page ${styles.hero}`}>
        <div className={styles.heroCopy}>
          <p className={`eyebrow ${styles.kicker}`}>
            <span className="mono">schema_version 1.0.0</span> · provider-agnostic contract
          </p>
          <h1 className={styles.title}>
            Find usable models without hardcoding provider catalogs.
          </h1>
          <p className={styles.lede}>
            The Model Discovery Feed is a provider-agnostic, JSON-over-HTTP contract for discovering LLM
            offerings — their capabilities, pricing, and availability, with the free and free-tier options
            surfaced honestly. This repository is the reference implementation.
          </p>
          <div className={styles.ctas}>
            <Link href="/explore" className="btn btn-primary">
              Browse the feed →
            </Link>
            <Link href="/docs" className="btn btn-secondary">
              Read the docs
            </Link>
          </div>
          <dl className={styles.stats}>
            <div>
              <dt>Offerings</dt>
              <dd className="mono">{status.model_count}</dd>
            </div>
            <div>
              <dt>Providers</dt>
              <dd className="mono">{status.provider_count}</dd>
            </div>
            <div>
              <dt>Free now</dt>
              <dd className="mono">{freeCount}</dd>
            </div>
            <div>
              <dt>Generated</dt>
              <dd className="mono">{formatRelativeTime(status.generated_at)}</dd>
            </div>
          </dl>
          {usingFixture ? (
            <p className={styles.fixtureNote}>
              Stats reflect the bundled example fixture — no published feed release is being served.
            </p>
          ) : null}
        </div>

        <div className={styles.specimen}>
          <CodeBlock code={specimen(feed)} label="GET /v1/models · offering" />
          <p className={styles.specimenNote}>
            A live model offering from this deployment&rsquo;s feed, trimmed for reading.
          </p>
        </div>
      </section>

      <section className={`page ${styles.scopeSection}`} aria-labelledby="scope-heading">
        <h2 id="scope-heading" className="sr-only">
          Scope
        </h2>
        <div className={styles.scope}>
          <div className={styles.scopeCol}>
            <h3 className={styles.scopeTitle}>What it is</h3>
            <ul className={styles.scopeList}>
              <li>A versioned JSON contract for model discovery.</li>
              <li>Facts with provenance, kept separate from feed opinions.</li>
              <li>Honest free classification — not a boolean.</li>
              <li>Additive filtering that clients can extend safely.</li>
            </ul>
          </div>
          <div className={`${styles.scopeCol} ${styles.scopeNot}`}>
            <h3 className={styles.scopeTitle}>What it is not</h3>
            <ul className={styles.scopeList}>
              <li>An inference proxy or gateway.</li>
              <li>A model router or load balancer.</li>
              <li>A provider credential store.</li>
              <li>A client profile or config format.</li>
            </ul>
          </div>
        </div>
      </section>

      <section className={`page ${styles.section}`} aria-labelledby="endpoints-heading">
        <div className={styles.sectionHead}>
          <h2 id="endpoints-heading">Endpoints</h2>
          <p>Six read endpoints. Authentication is optional and enabled per deployment.</p>
        </div>
        <div className={`panel ${styles.endpoints}`}>
          {ENDPOINTS.map((e) =>
            e.path.includes("{") ? (
              <span key={e.path} className={styles.endpointRow}>
                <span className={styles.method}>{e.method}</span>
                <span className={`mono ${styles.epath}`}>{e.path}</span>
                <span className={styles.epurpose}>{e.purpose}</span>
              </span>
            ) : (
              <a key={e.path} href={e.path} className={styles.endpointRow}>
                <span className={styles.method}>{e.method}</span>
                <span className={`mono ${styles.epath}`}>{e.path}</span>
                <span className={styles.epurpose}>{e.purpose}</span>
              </a>
            )
          )}
        </div>
      </section>

      <section className={`page ${styles.section}`} aria-labelledby="model-heading">
        <div className={styles.sectionHead}>
          <h2 id="model-heading">The object model</h2>
          <p>Four object types carry the entire contract.</p>
        </div>
        <dl className={styles.objects}>
          {OBJECTS.map((o) => (
            <div key={o.name} className={styles.objectRow}>
              <dt className="mono">{o.name}</dt>
              <dd>{o.body}</dd>
            </div>
          ))}
        </dl>
        <p className={styles.freeNote}>
          <strong>Free is not a boolean.</strong> When an offering is free, the feed records why (
          <span className="mono">basis</span>), whether it needs an account, API key, or card, when the
          claim was last verified, and when it expires.
        </p>
      </section>

      <section className={`page ${styles.section}`} aria-labelledby="cli-heading">
        <div className={styles.sectionHead}>
          <h2 id="cli-heading">Try the reference CLI</h2>
          <p>
            Fetch a feed, validate its version, filter, and emit JSON your adapter can transform — currently
            spanning {capabilities.length} capabilities and context windows up to{" "}
            {formatTokens(maxContext)} tokens.
          </p>
        </div>
        <div className={styles.cliGrid}>
          <CodeBlock
            label="shell"
            code={`# list coding-capable offerings from a feed
npm run model-feed -- list \\
  --feed https://example.com/v1/feed \\
  --capability coding --json`}
          />
          <ul className={styles.capList} aria-label="Capabilities in the current feed">
            {capabilities.slice(0, 12).map((c) => (
              <li key={c} className="tag">
                {capabilityLabel(c)}
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className={`page ${styles.closer}`}>
        <div className={styles.closerInner}>
          <h2>Browse what the feed knows.</h2>
          <p>Search and filter every offering by provider, capability, pricing, and availability.</p>
          <Link href="/explore" className="btn btn-primary">
            Open the explorer →
          </Link>
        </div>
      </section>

      <FeedReleaseNotice generatedAt={status.generated_at} sourceRevision={status.source_revision} />
    </>
  );
}
