"use client";

import { useEffect, useRef } from "react";
import type { ModelOffering, Provider } from "@/feed/schema";
import { CodeBlock } from "../components/CodeBlock";
import { StatusChip } from "../components/StatusChip";
import {
  availabilityTone,
  capabilityLabel,
  formatRelativeTime,
  formatTokens,
  pricingLabel,
  pricingTone,
  protocolLabel,
  safeHttpUrl,
  statusLabel
} from "../lib/format";
import styles from "./ModelDetail.module.css";

type Props = {
  model: ModelOffering;
  provider: Provider | null;
  onClose: () => void;
  nowMs: number;
};

export function ModelDetail({ model, provider, onClose, nowMs }: Props) {
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function focusables(): HTMLElement[] {
      return Array.from(
        panelRef.current?.querySelectorAll<HTMLElement>(
          'a[href], button:not([tabindex="-1"]), input, select, textarea, [tabindex]:not([tabindex="-1"])'
        ) ?? []
      );
    }

    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      if (e.key !== "Tab") return;

      const items = focusables();
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;

      if (!panelRef.current?.contains(active)) {
        e.preventDefault();
        first.focus();
        return;
      }
      if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
      previouslyFocused?.focus?.();
    };
  }, [onClose]);

  const free = model.pricing.free;
  const homepage = safeHttpUrl(provider?.homepage);

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
          <Section title="Endpoint">
            <Field label="Protocol" value={protocolLabel(model.endpoint.protocol)} />
            <Field label="Model" value={model.endpoint.model} mono />
            {model.endpoint.base_url ? <Field label="Base URL" value={model.endpoint.base_url} mono /> : null}
            <Field label="Provider model id" value={model.provider_model_id} mono />
            {model.canonical_model ? (
              <Field
                label="Canonical"
                value={`${model.canonical_model.id} (${model.canonical_model.confidence})`}
                mono
              />
            ) : null}
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

          {(model.quality.coding_score != null ||
            model.quality.reasoning_score != null ||
            model.quality.speed_score != null ||
            model.quality.recommendation_notes.length > 0) && (
            <Section title="Quality (feed opinion)">
              {model.quality.coding_score != null ? (
                <Field label="Coding" value={String(model.quality.coding_score)} />
              ) : null}
              {model.quality.reasoning_score != null ? (
                <Field label="Reasoning" value={String(model.quality.reasoning_score)} />
              ) : null}
              {model.quality.speed_score != null ? (
                <Field label="Speed" value={String(model.quality.speed_score)} />
              ) : null}
              {model.quality.recommendation_notes.map((note, i) => (
                <p key={i} className={styles.note}>
                  {note}
                </p>
              ))}
            </Section>
          )}

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
