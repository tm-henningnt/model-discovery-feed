"use client";

import { useRef } from "react";
import type { FeedDocument, ModelOffering, Provider, SourceClaim } from "@/feed/schema";
import { CodeBlock } from "../components/CodeBlock";
import { StatusChip } from "../components/StatusChip";
import {
  availabilityTone,
  capabilityLabel,
  formatRelativeTime,
  formatScore,
  formatSpeed,
  formatTokens,
  pricingLabel,
  pricingTone,
  protocolLabel,
  safeHttpUrl,
  statusLabel,
  subBenchmarkLabel
} from "../lib/format";
import { useFocusTrap } from "./use-focus-trap";
import styles from "./ModelDetail.module.css";

type Props = {
  model: ModelOffering;
  provider: Provider | null;
  artificialAnalysisAttribution: FeedDocument["attributions"][number] | undefined;
  onClose: () => void;
  nowMs: number;
};

const ARTIFICIAL_ANALYSIS_URL = "https://artificialanalysis.ai/";

export function ModelDetail({ model, provider, artificialAnalysisAttribution, onClose, nowMs }: Props) {
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useFocusTrap(panelRef, closeRef, onClose);

  const free = model.pricing.free;
  const homepage = safeHttpUrl(provider?.homepage);
  const canonical = model.canonical_model;
  const artificialAnalysisClaim = model.source_claims.find(
    (claim) => sourceName(claim) === "Artificial Analysis" && claim.field_paths.some((path) => path.startsWith("quality."))
  );
  const artificialAnalysisUrl = safeHttpUrl(artificialAnalysisAttribution?.url) ?? ARTIFICIAL_ANALYSIS_URL;

  return (
    <div className={styles.overlay} role="dialog" aria-modal="true" aria-labelledby="detail-title">
      <button
        type="button"
        className={styles.backdrop}
        aria-label="Close details"
        onClick={onClose}
        tabIndex={-1}
      />
      <div className={styles.panel} ref={panelRef}>
        <header className={styles.head}>
          <div className={styles.headTop}>
            <div className={styles.chips}>
              <StatusChip tone={availabilityTone(model.availability.status)}>
                {statusLabel(model.availability.status)}
              </StatusChip>
              <StatusChip tone={pricingTone(model, new Date(nowMs))} dot={false}>
                {pricingLabel(model.pricing.kind)}
              </StatusChip>
            </div>
            <button type="button" ref={closeRef} className={styles.close} onClick={onClose} aria-label="Close">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="m6 6 12 12M18 6 6 18" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
              </svg>
            </button>
          </div>
          <h2 id="detail-title" className={styles.title}>
            {model.display_name}
          </h2>
          <p className={styles.provider}>
            {homepage ? (
              <a href={homepage} target="_blank" rel="noreferrer">
                {model.provider.name}
              </a>
            ) : (
              model.provider.name
            )}
          </p>
          <p className={`mono ${styles.id}`}>{model.id}</p>
          {model.description ? <p className={styles.desc}>{model.description}</p> : null}
        </header>

        <div className={styles.body}>
          <Section title="Overview">
            <Field label="Canonical model" value={canonical?.id ?? "—"} mono />
            <Field label="Canonical confidence" value={canonical?.confidence ?? "—"} />
            <Field label="Knowledge cutoff" value={canonical?.knowledge_cutoff ?? "—"} />
            <Field label="Release date" value={canonical?.release_date ?? "—"} />
            <Field label="Open weights" value={boolLabel(canonical?.open_weights)} />
          </Section>

          <Section title="Endpoint">
            <Field label="Protocol" value={protocolLabel(model.endpoint.protocol)} />
            <Field label="Model" value={model.endpoint.model} mono />
            {model.endpoint.base_url ? <Field label="Base URL" value={model.endpoint.base_url} mono /> : null}
            <Field label="Provider model id" value={model.provider_model_id} mono />
          </Section>

          <Section title="Capabilities">
            <div className={styles.tags}>
              {model.capabilities.map((c) => (
                <span key={c} className="tag">
                  {capabilityLabel(c)}
                </span>
              ))}
            </div>
          </Section>

          <Section title="Limits & pricing">
            <Field label="Context window" value={`${formatTokens(model.limits.context_tokens)} tokens`} />
            <Field label="Max output" value={`${formatTokens(model.limits.max_output_tokens)} tokens`} />
            <Field
              label="Input / output"
              value={
                model.pricing.input_usd_per_1m_tokens == null && model.pricing.output_usd_per_1m_tokens == null
                  ? "—"
                  : `$${model.pricing.input_usd_per_1m_tokens ?? "?"} / $${model.pricing.output_usd_per_1m_tokens ?? "?"} per 1M`
              }
            />
            {free ? (
              <div className={styles.freeBox}>
                <p className={styles.freeTitle}>Free classification</p>
                <Field label="Currently free" value={free.is_currently_free ? "Yes" : "No"} />
                <Field label="Basis" value={statusLabel(free.basis)} />
                <Field label="Requires account" value={boolLabel(free.requires_account)} />
                <Field label="Requires API key" value={boolLabel(free.requires_api_key)} />
                <Field label="Requires credit card" value={boolLabel(free.requires_credit_card)} />
                {free.quota ? <Field label="Quota" value={free.quota} /> : null}
                <Field label="Verified" value={formatRelativeTime(free.last_verified_at, nowMs)} />
                {free.expires_at ? <Field label="Expires" value={formatRelativeTime(free.expires_at, nowMs)} /> : null}
                <Field label="Confidence" value={statusLabel(free.confidence)} />
              </div>
            ) : null}
          </Section>

          <Section title="Quality (feed opinion)">
            {hasAnyQualityData(model) ? (
              <>
                {artificialAnalysisClaim ? (
                  <p className={styles.qualityCredit}>
                    <a href={artificialAnalysisUrl} target="_blank" rel="noreferrer">
                      Scores by Artificial Analysis
                    </a>{" "}
                    · observed {formatRelativeTime(artificialAnalysisClaim.observed_at, nowMs)}
                  </p>
                ) : null}

                <div className={styles.qualityGroup}>
                  <QualityMetric model={model} label="Coding" value={formatScore(model.quality.coding_score)} fieldPath="quality.coding_score" nowMs={nowMs} />
                  <QualityMetric model={model} label="Reasoning" value={formatScore(model.quality.reasoning_score)} fieldPath="quality.reasoning_score" nowMs={nowMs} />
                  <QualityMetric model={model} label="Agentic" value={formatScore(model.quality.agentic_score)} fieldPath="quality.agentic_score" nowMs={nowMs} />
                  <QualityMetric model={model} label="Speed" value={formatSpeed(model.quality.speed_score)} fieldPath="quality.speed_score" nowMs={nowMs} />
                </div>

                <div className={styles.benchmarkGroup}>
                  <h4 className={styles.benchmarkTitle}>Benchmarks</h4>
                  <QualityMetric
                    model={model}
                    label="Math"
                    value={formatScore(model.quality.benchmarks?.math_score)}
                    fieldPath="quality.benchmarks.math_score"
                    nowMs={nowMs}
                  />
                  <QualityMetric
                    model={model}
                    label="TTFT"
                    value={
                      model.quality.benchmarks?.ttft_seconds == null
                        ? "—"
                        : `${model.quality.benchmarks.ttft_seconds} s`
                    }
                    fieldPath="quality.benchmarks.ttft_seconds"
                    nowMs={nowMs}
                  />
                </div>

                <BenchmarkDetails model={model} nowMs={nowMs} />

                {model.quality.recommendation_notes.map((note, i) => (
                  <p key={i} className={styles.note}>
                    {note}
                  </p>
                ))}
              </>
            ) : (
              <p className={styles.note}>No quality scores available for this offering.</p>
            )}
          </Section>

          <Section title="Policy">
            <Field label="Visibility" value={statusLabel(model.policy.visibility)} />
            {model.policy.recommended_for_agentic_workflows != null ? (
              <Field
                label="Agentic-recommended"
                value={boolLabel(model.policy.recommended_for_agentic_workflows)}
              />
            ) : null}
            {model.policy.tags.length ? (
              <div className={styles.tags}>
                {model.policy.tags.map((t) => (
                  <span key={t} className="tag">
                    {t}
                  </span>
                ))}
              </div>
            ) : null}
          </Section>

          <Section title={`Provenance (${model.source_claims.length})`}>
            {model.source_claims.length === 0 ? (
              <p className={styles.note}>No source claims recorded.</p>
            ) : (
              <ul className={styles.claims}>
                {model.source_claims.map((claim) => {
                  const url = safeHttpUrl(claim.source_url);
                  return (
                    <li key={claim.id} className={styles.claim}>
                      <div className={styles.claimHead}>
                        <span className="mono">{statusLabel(claim.source_type)}</span>
                        <StatusChip
                          tone={claim.confidence === "high" ? "ok" : claim.confidence === "medium" ? "warn" : "bad"}
                          dot={false}
                        >
                          {claim.confidence}
                        </StatusChip>
                      </div>
                      <p className={styles.claimMeta}>
                        {claim.collector} · {formatRelativeTime(claim.observed_at, nowMs)}
                      </p>
                      {url ? (
                        <a className={styles.claimUrl} href={url} target="_blank" rel="noreferrer">
                          {url}
                        </a>
                      ) : claim.source_url ? (
                        <span className={styles.claimUrl}>{claim.source_url}</span>
                      ) : null}
                      <p className={styles.claimFields}>
                        {claim.field_paths.map((f) => (
                          <span key={f} className="mono">
                            {f}
                          </span>
                        ))}
                      </p>
                    </li>
                  );
                })}
              </ul>
            )}
          </Section>

          <Section title="Raw offering">
            <CodeBlock code={JSON.stringify(model, null, 2)} label="model_offering" />
          </Section>
        </div>
      </div>
    </div>
  );
}

function boolLabel(value: boolean | null | undefined): string {
  if (value === true) return "Yes";
  if (value === false) return "No";
  return "Unknown";
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className={styles.section}>
      <h3 className={styles.sectionTitle}>{title}</h3>
      <div className={styles.sectionBody}>{children}</div>
    </section>
  );
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className={styles.field}>
      <span className={styles.fieldLabel}>{label}</span>
      <span className={mono ? `mono ${styles.fieldValue}` : styles.fieldValue}>{value}</span>
    </div>
  );
}

function hasAnyQualityData(model: ModelOffering): boolean {
  return (
    model.quality.coding_score != null ||
    model.quality.reasoning_score != null ||
    model.quality.agentic_score != null ||
    model.quality.speed_score != null ||
    model.quality.benchmarks?.math_score != null ||
    model.quality.benchmarks?.ttft_seconds != null ||
    Boolean(model.quality.benchmarks?.artificial_analysis && Object.keys(model.quality.benchmarks.artificial_analysis).length > 0) ||
    Boolean(model.quality.benchmarks?.design_arena && model.quality.benchmarks.design_arena.length > 0) ||
    model.quality.recommendation_notes.length > 0
  );
}

function QualityMetric({
  model,
  label,
  value,
  fieldPath,
  nowMs
}: {
  model: ModelOffering;
  label: string;
  value: string;
  fieldPath: string;
  nowMs: number;
}) {
  return (
    <div className={styles.qualityMetric}>
      <Field label={label} value={value} mono />
      {value !== "—" ? (
        <ClaimAttribution claim={findCoveringClaim(model.source_claims, fieldPath)} nowMs={nowMs} />
      ) : null}
    </div>
  );
}

function BenchmarkDetails({ model, nowMs }: { model: ModelOffering; nowMs: number }) {
  const benchmarks = model.quality.benchmarks;
  const subBenchmarks = benchmarks?.artificial_analysis;
  const designArena = benchmarks?.design_arena;
  const subBenchmarkClaim = findCoveringClaim(model.source_claims, "quality.benchmarks.artificial_analysis");
  const designArenaClaim = findCoveringClaim(model.source_claims, "quality.benchmarks.design_arena");

  return (
    <>
      <div className={styles.benchmarkGroup}>
        <h4 className={styles.benchmarkTitle}>Artificial Analysis sub-benchmarks</h4>
        {subBenchmarks && Object.keys(subBenchmarks).length > 0 ? (
          <>
            <div className={styles.subBenchmarkList}>
              {Object.entries(subBenchmarks).map(([name, score]) => (
                <Field key={name} label={subBenchmarkLabel(name)} value={formatScore(score)} mono />
              ))}
            </div>
            <ClaimAttribution claim={subBenchmarkClaim} nowMs={nowMs} />
          </>
        ) : (
          <QualityMetric
            model={model}
            label="Sub-benchmarks"
            value="—"
            fieldPath="quality.benchmarks.artificial_analysis"
            nowMs={nowMs}
          />
        )}
      </div>

      <div className={styles.benchmarkGroup}>
        <h4 className={styles.benchmarkTitle}>Design Arena</h4>
        {designArena && designArena.length > 0 ? (
          <div className={styles.arenaEntries}>
            {designArena.map((entry, index) => (
              <div key={`${entry.arena ?? "arena"}-${entry.category ?? "category"}-${index}`} className={styles.arenaEntry}>
                <p className={styles.arenaTitle}>
                  {entry.category && entry.arena && entry.category !== entry.arena
                    ? `${entry.arena} · ${entry.category}`
                    : entry.category ?? entry.arena ?? `Arena entry ${index + 1}`}
                </p>
                <Field label="Elo" value={formatScore(entry.elo)} mono />
                <Field label="Rank" value={formatScore(entry.rank)} mono />
                <Field label="Win rate" value={formatScore(entry.win_rate)} mono />
                <ClaimAttribution claim={designArenaClaim} nowMs={nowMs} />
              </div>
            ))}
          </div>
        ) : (
          <QualityMetric
            model={model}
            label="Arena entries"
            value="—"
            fieldPath="quality.benchmarks.design_arena"
            nowMs={nowMs}
          />
        )}
      </div>
    </>
  );
}

function ClaimAttribution({ claim, nowMs }: { claim: SourceClaim | undefined; nowMs: number }) {
  if (!claim) {
    return <p className={styles.qualitySource}>Source claim unavailable</p>;
  }

  const url = safeHttpUrl(claim.source_url);
  const name = sourceName(claim);
  return (
    <p className={styles.qualitySource}>
      Source: {url ? <a href={url} target="_blank" rel="noreferrer">{name}</a> : name} · observed{" "}
      {formatRelativeTime(claim.observed_at, nowMs)}
    </p>
  );
}

function findCoveringClaim(claims: SourceClaim[], fieldPath: string): SourceClaim | undefined {
  return claims.find((claim) =>
    claim.field_paths.some(
      (claimedPath) =>
        claimedPath === fieldPath || claimedPath.startsWith(`${fieldPath}.`) || fieldPath.startsWith(`${claimedPath}.`)
    )
  );
}

function sourceName(claim: SourceClaim): string {
  const url = safeHttpUrl(claim.source_url);
  if (url) {
    const hostname = new URL(url).hostname;
    if (hostname.endsWith("artificialanalysis.ai")) return "Artificial Analysis";
    if (hostname.endsWith("designarena.ai")) return "Design Arena";
    if (hostname.endsWith("models.dev")) return "models.dev";
  }
  return statusLabel(claim.collector.replaceAll("-", "_"));
}
