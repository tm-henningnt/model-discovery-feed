"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { FeedDocument, ModelOffering, Provider } from "@/feed/schema";
import { isConfidentlyFree } from "@/feed/classification";
import { compareNullableNumbersDescending, compareRecommended } from "@/feed/ranking";
import { computeFacetCounts, filterExplorerModels, type ExplorerFilters } from "@/feed/facets";
import { StatusChip } from "../components/StatusChip";
import {
  availabilityTone,
  capabilityLabel,
  formatPrice,
  formatRelativeTime,
  formatScore,
  formatSpeed,
  formatTokens,
  pricingLabel,
  pricingTone,
  protocolLabel,
  safeHttpUrl,
  statusLabel
} from "../lib/format";
import { ModelDetail } from "./ModelDetail";
import { ExportDrawer } from "./ExportDrawer";
import styles from "./Explorer.module.css";

type Props = {
  models: ModelOffering[];
  providers: Provider[];
  attributions: FeedDocument["attributions"];
  generatedAt: string;
  stale: boolean;
  usingFixture: boolean;
  nowMs: number;
};

type SortKey = "default" | "name" | "context" | "price" | "coding" | "reasoning" | "speed";

const SORT_KEYS: SortKey[] = ["default", "name", "context", "price", "coding", "reasoning", "speed"];

// Explorer state <-> URL query param mapping. Names mirror the API's own
// filter params (src/feed/filter.ts) where a counterpart exists, so the
// explorer's shareable URLs read the same way the API does.
const PARAMS = {
  query: "q",
  provider: "provider",
  capabilities: "capabilities",
  pricing: "pricing_kind",
  availability: "availability",
  protocol: "protocol",
  free: "free",
  minContext: "min_context_tokens",
  sort: "sort",
  model: "model"
} as const;

function parseSet(params: URLSearchParams, key: string): Set<string> {
  return new Set(params.get(key)?.split(",").filter(Boolean) ?? []);
}

const CONTEXT_STEPS = [
  { label: "Any", value: 0 },
  { label: "≥ 16K", value: 16_000 },
  { label: "≥ 64K", value: 64_000 },
  { label: "≥ 128K", value: 128_000 },
  { label: "≥ 256K", value: 256_000 }
];

function countBy<T extends string>(models: ModelOffering[], pick: (m: ModelOffering) => T[]): Map<T, number> {
  const map = new Map<T, number>();
  for (const m of models) {
    for (const key of pick(m)) {
      map.set(key, (map.get(key) ?? 0) + 1);
    }
  }
  return map;
}

export function Explorer({ models, providers, attributions, generatedAt, stale, usingFixture, nowMs }: Props) {
  const now = useMemo(() => new Date(nowMs), [nowMs]);
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [query, setQuery] = useState(() => searchParams.get(PARAMS.query) ?? "");
  const [selProviders, setSelProviders] = useState<Set<string>>(() => parseSet(searchParams, PARAMS.provider));
  const [selCaps, setSelCaps] = useState<Set<string>>(() => parseSet(searchParams, PARAMS.capabilities));
  const [selPricing, setSelPricing] = useState<Set<string>>(() => parseSet(searchParams, PARAMS.pricing));
  const [selAvail, setSelAvail] = useState<Set<string>>(() => parseSet(searchParams, PARAMS.availability));
  const [selProtocols, setSelProtocols] = useState<Set<string>>(() => parseSet(searchParams, PARAMS.protocol));
  const [freeOnly, setFreeOnly] = useState(() => searchParams.get(PARAMS.free) === "true");
  const [minContext, setMinContext] = useState(() => Number(searchParams.get(PARAMS.minContext)) || 0);
  const [sort, setSort] = useState<SortKey>(() => {
    const fromUrl = searchParams.get(PARAMS.sort);
    return (SORT_KEYS as string[]).includes(fromUrl ?? "") ? (fromUrl as SortKey) : "default";
  });
  const [openId, setOpenId] = useState<string | null>(() => searchParams.get(PARAMS.model));
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);

  // State -> URL only. We never read searchParams back into state outside the
  // lazy initializers above, so this effect can't loop against itself; back/
  // forward navigation re-inits state only on a full remount, which is an
  // accepted, predictable tradeoff (see plan 021).
  useEffect(() => {
    const timer = setTimeout(() => {
      const params = new URLSearchParams();
      if (query.trim()) params.set(PARAMS.query, query.trim());
      if (selProviders.size) params.set(PARAMS.provider, [...selProviders].join(","));
      if (selCaps.size) params.set(PARAMS.capabilities, [...selCaps].join(","));
      if (selPricing.size) params.set(PARAMS.pricing, [...selPricing].join(","));
      if (selAvail.size) params.set(PARAMS.availability, [...selAvail].join(","));
      if (selProtocols.size) params.set(PARAMS.protocol, [...selProtocols].join(","));
      if (freeOnly) params.set(PARAMS.free, "true");
      if (minContext) params.set(PARAMS.minContext, String(minContext));
      if (sort !== "default") params.set(PARAMS.sort, sort);
      if (openId) params.set(PARAMS.model, openId);

      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    }, 250);
    return () => clearTimeout(timer);
  }, [
    router,
    pathname,
    query,
    selProviders,
    selCaps,
    selPricing,
    selAvail,
    selProtocols,
    freeOnly,
    minContext,
    sort,
    openId
  ]);

  const providerName = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of providers) map.set(p.id, p.name);
    for (const m of models) map.set(m.provider.id, m.provider.name);
    return map;
  }, [providers, models]);

  // Facet universes (from all listed models) fix which values are shown and
  // in which order — ordering by live counts would shuffle rows mid-filter.
  const providerUniverse = useMemo(() => countBy(models, (m) => [m.provider.id]), [models]);
  const capUniverse = useMemo(() => countBy(models, (m) => m.capabilities as string[]), [models]);
  const pricingUniverse = useMemo(() => countBy(models, (m) => [m.pricing.kind]), [models]);
  const availUniverse = useMemo(() => countBy(models, (m) => [m.availability.status]), [models]);
  const protocolUniverse = useMemo(() => countBy(models, (m) => [m.endpoint.protocol]), [models]);

  const filters = useMemo<ExplorerFilters>(
    () => ({
      query,
      freeOnly,
      providers: selProviders,
      capabilities: selCaps,
      pricing: selPricing,
      availability: selAvail,
      protocols: selProtocols,
      minContext
    }),
    [query, freeOnly, selProviders, selCaps, selPricing, selAvail, selProtocols, minContext]
  );

  // Displayed counts follow the active filters (each facet ignores only its
  // own selection), so a value's count reads "results if I pick this".
  const facetCounts = useMemo(() => computeFacetCounts(models, filters, now), [models, filters, now]);

  const filtered = useMemo(() => {
    const list = filterExplorerModels(models, filters, now);

    const byName = (a: ModelOffering, b: ModelOffering) => a.display_name.localeCompare(b.display_name);
    const context = (m: ModelOffering) => m.limits.context_tokens ?? 0;
    const price = (m: ModelOffering) =>
      isConfidentlyFree(m, now) ? 0 : m.pricing.input_usd_per_1m_tokens ?? Number.POSITIVE_INFINITY;

    const sorted = [...list];
    if (sort === "name") sorted.sort(byName);
    else if (sort === "context") sorted.sort((a, b) => context(b) - context(a) || byName(a, b));
    else if (sort === "price") sorted.sort((a, b) => price(a) - price(b) || byName(a, b));
    else if (sort === "coding") {
      sorted.sort((a, b) => compareNullableNumbersDescending(a.quality.coding_score, b.quality.coding_score) || byName(a, b));
    } else if (sort === "reasoning") {
      sorted.sort((a, b) => compareNullableNumbersDescending(a.quality.reasoning_score, b.quality.reasoning_score) || byName(a, b));
    } else if (sort === "speed") {
      sorted.sort((a, b) => compareNullableNumbersDescending(a.quality.speed_score, b.quality.speed_score) || byName(a, b));
    }
    else sorted.sort((a, b) => compareRecommended(a, b, now));
    return sorted;
  }, [models, filters, sort, now]);

  const artificialAnalysisAttribution = attributions.find((attribution) => {
    const url = safeHttpUrl(attribution.url);
    return url ? new URL(url).hostname.endsWith("artificialanalysis.ai") : false;
  });

  const activeCount =
    selProviders.size +
    selCaps.size +
    selPricing.size +
    selAvail.size +
    selProtocols.size +
    (freeOnly ? 1 : 0) +
    (minContext ? 1 : 0) +
    (query.trim() ? 1 : 0);

  const clearAll = useCallback(() => {
    setQuery("");
    setSelProviders(new Set());
    setSelCaps(new Set());
    setSelPricing(new Set());
    setSelAvail(new Set());
    setSelProtocols(new Set());
    setFreeOnly(false);
    setMinContext(0);
  }, []);

  function toggle(setter: React.Dispatch<React.SetStateAction<Set<string>>>, value: string) {
    setter((prev) => {
      const next = new Set(prev);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      return next;
    });
  }

  const openModel = useMemo(() => filtered.find((m) => m.id === openId) ?? models.find((m) => m.id === openId), [filtered, models, openId]);

  return (
    <div className={`page ${styles.wrap}`}>
      <header className={styles.head}>
        <div>
          <p className="eyebrow">Feed explorer</p>
          <h1 className={styles.title}>Browse model offerings</h1>
          <p className={styles.sub}>
            {models.length} listed {models.length === 1 ? "offering" : "offerings"} · generated{" "}
            {formatRelativeTime(generatedAt, nowMs)}
            {stale ? " · feed is stale" : ""}
          </p>
        </div>
      </header>

      {usingFixture ? (
        <p className={styles.fixtureBanner} role="status">
          <strong>Example data.</strong> No feed release is published, so these offerings come from
          the bundled fixture. Their scores are invented and describe no real model.
        </p>
      ) : null}

      <div className={styles.toolbar}>
        <div className={styles.search}>
          <SearchIcon />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name, id, or provider…"
            aria-label="Search offerings"
          />
        </div>
        <button
          type="button"
          className={`btn btn-secondary ${styles.filterToggle}`}
          onClick={() => setFiltersOpen((v) => !v)}
          aria-expanded={filtersOpen}
        >
          Filters{activeCount ? ` (${activeCount})` : ""}
        </button>
        <label className={styles.sort}>
          <span>Sort</span>
          <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
            <option value="default">Recommended</option>
            <option value="name">Name (A–Z)</option>
            <option value="context">Context (high→low)</option>
            <option value="price">Price (low→high)</option>
            <option value="coding">Coding (high→low)</option>
            <option value="reasoning">Reasoning (high→low)</option>
            <option value="speed">Speed (high→low)</option>
          </select>
        </label>
        <button
          type="button"
          className={`btn btn-secondary ${styles.exportToggle}`}
          onClick={() => {
            setOpenId(null);
            setExportOpen(true);
          }}
        >
          Export
        </button>
      </div>

      <div className={styles.layout}>
        <aside className={styles.rail} data-open={filtersOpen} aria-label="Filters">
          <div className={styles.railHead}>
            <span>Filters</span>
            {activeCount ? (
              <button type="button" className={styles.clear} onClick={clearAll}>
                Clear all
              </button>
            ) : null}
          </div>
          <FacetToggle
            label="Free right now"
            checked={freeOnly}
            onChange={() => setFreeOnly((v) => !v)}
            hint="Confidently zero-priced offerings"
          />

          <Facet title="Provider">
            {[...providerUniverse.entries()]
              .sort((a, b) => b[1] - a[1])
              .map(([id]) => (
                <FacetCheck
                  key={id}
                  label={providerName.get(id) ?? id}
                  count={facetCounts.providers.get(id) ?? 0}
                  checked={selProviders.has(id)}
                  onChange={() => toggle(setSelProviders, id)}
                />
              ))}
          </Facet>

          <Facet title="Capability" hint="Matches offerings with all selected">
            {[...capUniverse.entries()]
              .sort((a, b) => b[1] - a[1])
              .map(([cap]) => (
                <FacetCheck
                  key={cap}
                  label={capabilityLabel(cap)}
                  count={facetCounts.capabilities.get(cap) ?? 0}
                  checked={selCaps.has(cap)}
                  onChange={() => toggle(setSelCaps, cap)}
                />
              ))}
          </Facet>

          <Facet title="Pricing">
            {[...pricingUniverse.entries()]
              .sort((a, b) => b[1] - a[1])
              .map(([kind]) => (
                <FacetCheck
                  key={kind}
                  label={pricingLabel(kind as never)}
                  count={facetCounts.pricing.get(kind) ?? 0}
                  checked={selPricing.has(kind)}
                  onChange={() => toggle(setSelPricing, kind)}
                />
              ))}
          </Facet>

          <Facet title="Availability">
            {[...availUniverse.entries()]
              .sort((a, b) => b[1] - a[1])
              .map(([status]) => (
                <FacetCheck
                  key={status}
                  label={statusLabel(status)}
                  count={facetCounts.availability.get(status) ?? 0}
                  checked={selAvail.has(status)}
                  onChange={() => toggle(setSelAvail, status)}
                />
              ))}
          </Facet>

          <Facet title="Context window">
            <div className={styles.steps}>
              {CONTEXT_STEPS.map((step) => (
                <button
                  key={step.value}
                  type="button"
                  className={styles.step}
                  aria-pressed={minContext === step.value}
                  onClick={() => setMinContext(step.value)}
                >
                  {step.label}
                </button>
              ))}
            </div>
          </Facet>

          <Facet title="Protocol">
            {[...protocolUniverse.entries()]
              .sort((a, b) => b[1] - a[1])
              .map(([protocol]) => (
                <FacetCheck
                  key={protocol}
                  label={protocolLabel(protocol)}
                  count={facetCounts.protocols.get(protocol) ?? 0}
                  checked={selProtocols.has(protocol)}
                  onChange={() => toggle(setSelProtocols, protocol)}
                />
              ))}
          </Facet>
        </aside>

        <section className={styles.results}>
          <div className={styles.resultsHead}>
            <span className={styles.count} role="status" aria-live="polite">
              {filtered.length} {filtered.length === 1 ? "result" : "results"}
            </span>
            {activeCount ? (
              <div className={styles.activeChips}>
                {query.trim() ? (
                  <ActiveChip label={`“${query.trim()}”`} onRemove={() => setQuery("")} />
                ) : null}
                {freeOnly ? <ActiveChip label="Free now" onRemove={() => setFreeOnly(false)} /> : null}
                {minContext ? (
                  <ActiveChip
                    label={`≥ ${formatTokens(minContext)} ctx`}
                    onRemove={() => setMinContext(0)}
                  />
                ) : null}
                {[...selProviders].map((id) => (
                  <ActiveChip
                    key={`p-${id}`}
                    label={providerName.get(id) ?? id}
                    onRemove={() => toggle(setSelProviders, id)}
                  />
                ))}
                {[...selCaps].map((c) => (
                  <ActiveChip key={`c-${c}`} label={capabilityLabel(c)} onRemove={() => toggle(setSelCaps, c)} />
                ))}
                {[...selPricing].map((k) => (
                  <ActiveChip key={`k-${k}`} label={pricingLabel(k as never)} onRemove={() => toggle(setSelPricing, k)} />
                ))}
                {[...selAvail].map((s) => (
                  <ActiveChip key={`a-${s}`} label={statusLabel(s)} onRemove={() => toggle(setSelAvail, s)} />
                ))}
                {[...selProtocols].map((p) => (
                  <ActiveChip key={`pr-${p}`} label={protocolLabel(p)} onRemove={() => toggle(setSelProtocols, p)} />
                ))}
              </div>
            ) : null}
          </div>

          <p className={styles.attribution}>
            <a
              href={artificialAnalysisAttribution?.url ?? "https://artificialanalysis.ai/"}
              target="_blank"
              rel="noreferrer"
            >
              Scores by Artificial Analysis
            </a>
          </p>

          {filtered.length === 0 ? (
            <div className={styles.empty}>
              <p>No offerings match these filters.</p>
              <button type="button" className="btn btn-secondary" onClick={clearAll}>
                Clear filters
              </button>
            </div>
          ) : (
            <div className={styles.tableWrap} role="region" aria-label="Model offerings" tabIndex={0}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th scope="col">Offering</th>
                    <th scope="col">Provider</th>
                    <th scope="col">Capabilities</th>
                    <th scope="col" className={styles.num}>
                      Context
                    </th>
                    <th scope="col">Pricing</th>
                    <th scope="col" className={`${styles.num} ${styles.scoreColumn}`}>
                      Coding
                    </th>
                    <th scope="col" className={`${styles.num} ${styles.scoreColumn}`}>
                      Reasoning
                    </th>
                    <th scope="col" className={`${styles.num} ${styles.scoreColumn} ${styles.speedColumn}`}>
                      Speed
                    </th>
                    <th scope="col">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((m) => (
                    <tr
                      key={m.id}
                      className={styles.row}
                      tabIndex={0}
                      role="button"
                      aria-label={`View ${m.display_name}`}
                      onClick={() => setOpenId(m.id)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          setOpenId(m.id);
                        }
                      }}
                    >
                      <td>
                        <span className={styles.offerName}>{m.display_name}</span>
                        <span className={`mono ${styles.offerId}`}>{m.id}</span>
                      </td>
                      <td>{m.provider.name}</td>
                      <td>
                        <span className={styles.caps}>
                          {m.capabilities.slice(0, 3).map((c) => (
                            <span key={c} className="tag">
                              {capabilityLabel(c)}
                            </span>
                          ))}
                          {m.capabilities.length > 3 ? (
                            <span className={styles.capMore}>+{m.capabilities.length - 3}</span>
                          ) : null}
                        </span>
                      </td>
                      <td className={`mono ${styles.num}`}>{formatTokens(m.limits.context_tokens)}</td>
                      <td>
                        <span className={styles.priceCell}>
                          <StatusChip tone={pricingTone(m, now)} dot={false}>
                            {pricingLabel(m.pricing.kind)}
                          </StatusChip>
                          <span className={`mono ${styles.priceNum}`}>{formatPrice(m, now)}</span>
                        </span>
                      </td>
                      <td className={`mono ${styles.num} ${styles.scoreColumn}`}>{formatScore(m.quality.coding_score)}</td>
                      <td className={`mono ${styles.num} ${styles.scoreColumn}`}>{formatScore(m.quality.reasoning_score)}</td>
                      <td className={`mono ${styles.num} ${styles.scoreColumn} ${styles.speedColumn}`}>
                        {formatSpeed(m.quality.speed_score)}
                      </td>
                      <td>
                        <StatusChip tone={availabilityTone(m.availability.status)}>
                          {statusLabel(m.availability.status)}
                        </StatusChip>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      {openModel ? (
        <ModelDetail
          model={openModel}
          provider={providers.find((p) => p.id === openModel.provider.id) ?? null}
          artificialAnalysisAttribution={artificialAnalysisAttribution}
          onClose={() => setOpenId(null)}
          nowMs={nowMs}
        />
      ) : null}

      {exportOpen ? <ExportDrawer models={filtered} onClose={() => setExportOpen(false)} /> : null}
    </div>
  );
}

function Facet({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className={styles.facet}>
      <h2 className={styles.facetTitle}>{title}</h2>
      {hint ? <p className={styles.facetHint}>{hint}</p> : null}
      <div className={styles.facetBody}>{children}</div>
    </section>
  );
}

function FacetCheck({
  label,
  count,
  checked,
  onChange
}: {
  label: string;
  count: number;
  checked: boolean;
  onChange: () => void;
}) {
  return (
    <label className={styles.check} data-checked={checked} data-zero={!checked && count === 0}>
      <input type="checkbox" checked={checked} onChange={onChange} />
      <span className={styles.checkBox} aria-hidden="true" />
      <span className={styles.checkLabel}>{label}</span>
      <span className={styles.checkCount}>{count}</span>
    </label>
  );
}

function FacetToggle({
  label,
  hint,
  checked,
  onChange
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: () => void;
}) {
  return (
    <label className={styles.toggle} data-checked={checked}>
      <span>
        <span className={styles.toggleLabel}>{label}</span>
        {hint ? <span className={styles.toggleHint}>{hint}</span> : null}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        className={styles.switch}
        onClick={onChange}
      >
        <span className={styles.knob} aria-hidden="true" />
      </button>
    </label>
  );
}

function ActiveChip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <button type="button" className={styles.activeChip} onClick={onRemove}>
      {label}
      <span aria-hidden="true">×</span>
      <span className="sr-only">Remove filter</span>
    </button>
  );
}

function SearchIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="10.5" cy="10.5" r="6.5" stroke="currentColor" strokeWidth="1.7" />
      <path d="m20 20-4.5-4.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}
