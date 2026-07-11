"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ModelOffering } from "@/feed/schema";
import { escapeRowSeparator, parseRowSeparator, renderExport, slugify } from "@/feed/export-template";
import { rankByProfile } from "@/feed/ranking";
import { useExportTemplates } from "./use-export-templates";
import { useFocusTrap } from "./use-focus-trap";
import styles from "./ExportDrawer.module.css";

type Props = {
  models: ModelOffering[];
  onClose: () => void;
};

export function ExportDrawer({ models, onClose }: Props) {
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const {
    presets,
    userTemplates,
    selected,
    isUserTemplate,
    saveError,
    setSelectedId,
    updateSelected,
    duplicateSelected,
    deleteSelected
  } = useExportTemplates();

  const [sepDraft, setSepDraft] = useState(() => escapeRowSeparator(selected.rowSeparator));
  useEffect(() => {
    setSepDraft(escapeRowSeparator(selected.rowSeparator));
  }, [selected.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useFocusTrap(panelRef, closeRef, onClose);

  const { output, error } = useMemo(() => {
    try {
      const rows = selected.profileId ? rankByProfile(models, selected.profileId) : models;
      return { output: renderExport(selected, rows), error: null as string | null };
    } catch (e) {
      return { output: "", error: e instanceof Error ? e.message : String(e) };
    }
  }, [selected, models]);

  const validJson = useMemo(() => {
    if (error) return false;
    try {
      JSON.parse(output);
      return true;
    } catch {
      return false;
    }
  }, [output, error]);

  useEffect(() => () => clearTimeout(copyTimerRef.current), []);

  async function copyOutput() {
    clearTimeout(copyTimerRef.current);
    try {
      await navigator.clipboard.writeText(output);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
    copyTimerRef.current = setTimeout(() => setCopyState("idle"), 1600);
  }

  function downloadOutput() {
    const blob = new Blob([output], { type: validJson ? "application/json" : "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${slugify(selected.name) || "export"}${validJson ? ".json" : ".txt"}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function handleDelete() {
    if (confirm(`Delete "${selected.name}"? This can't be undone.`)) {
      deleteSelected();
    }
  }

  return (
    <div className={styles.overlay} role="dialog" aria-modal="true" aria-labelledby="export-title">
      <button
        type="button"
        className={styles.backdrop}
        aria-label="Close export"
        onClick={onClose}
        tabIndex={-1}
      />
      <div className={styles.panel} ref={panelRef}>
        <header className={styles.head}>
          <div className={styles.headTop}>
            <div>
              <h2 id="export-title" className={styles.title}>
                Export
              </h2>
              <p className={styles.sub}>
                {models.length} {models.length === 1 ? "offering" : "offerings"} from the current filters
              </p>
            </div>
            <button type="button" ref={closeRef} className={styles.close} onClick={onClose} aria-label="Close">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="m6 6 12 12M18 6 6 18" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        </header>

        <div className={styles.body}>
          <section className={styles.section}>
            <div className={styles.pickerRow}>
              <label className={styles.pickerLabel}>
                <span>Template</span>
                <select
                  className={styles.select}
                  value={selected.id}
                  onChange={(e) => setSelectedId(e.target.value)}
                >
                  <optgroup label="Presets">
                    {presets.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </optgroup>
                  {userTemplates.length ? (
                    <optgroup label="My templates">
                      {userTemplates.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                        </option>
                      ))}
                    </optgroup>
                  ) : null}
                </select>
              </label>
              <button type="button" className="btn btn-secondary" onClick={duplicateSelected}>
                Duplicate
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={handleDelete}
                disabled={!isUserTemplate}
              >
                Delete
              </button>
            </div>
            {saveError ? (
              <p className={styles.saveError} role="status">
                Couldn&apos;t save templates — browser storage is unavailable or full. Changes will be lost on reload.
              </p>
            ) : null}
          </section>

          <section className={styles.section}>
            {!isUserTemplate ? <p className={styles.hint}>Presets are read-only — duplicate to edit.</p> : null}

            <label className={styles.field}>
              <span className={styles.fieldLabel}>Template name</span>
              <input
                type="text"
                className={styles.input}
                value={selected.name}
                readOnly={!isUserTemplate}
                onChange={(e) => updateSelected({ name: e.target.value })}
              />
            </label>

            <label className={styles.field}>
              <span className={styles.fieldLabel}>Row template — applied to each offering</span>
              <textarea
                className={`mono ${styles.textarea}`}
                rows={7}
                value={selected.rowTemplate}
                readOnly={!isUserTemplate}
                onChange={(e) => updateSelected({ rowTemplate: e.target.value })}
              />
            </label>

            <label className={styles.field}>
              <span className={styles.fieldLabel}>Wrapper template — {"{{rows}}"} is replaced with the joined rows</span>
              <textarea
                className={`mono ${styles.textarea}`}
                rows={7}
                value={selected.wrapperTemplate}
                readOnly={!isUserTemplate}
                onChange={(e) => updateSelected({ wrapperTemplate: e.target.value })}
              />
            </label>

            <label className={styles.field}>
              <span className={styles.fieldLabel}>Row separator</span>
              <input
                type="text"
                className={`mono ${styles.input}`}
                value={sepDraft}
                readOnly={!isUserTemplate}
                onChange={(e) => {
                  setSepDraft(e.target.value);
                  updateSelected({ rowSeparator: parseRowSeparator(e.target.value) });
                }}
              />
            </label>

            <details className={styles.reference}>
              <summary>Placeholder reference</summary>
              <div className={styles.referenceBody}>
                <p className={styles.referenceGroup}>Dot-path examples</p>
                <ul className={styles.referenceList}>
                  <li>
                    <code className="mono">{"{{id}}"}</code> — offering id
                  </li>
                  <li>
                    <code className="mono">{"{{display_name}}"}</code> — display name
                  </li>
                  <li>
                    <code className="mono">{"{{provider.id}}"}</code> — provider id
                  </li>
                  <li>
                    <code className="mono">{"{{provider_model_id}}"}</code> — provider's model id
                  </li>
                  <li>
                    <code className="mono">{"{{limits.context_tokens}}"}</code> — context window, in tokens
                  </li>
                  <li>
                    <code className="mono">{"{{pricing.kind}}"}</code> — pricing category
                  </li>
                  <li>
                    <code className="mono">{"{{pricing.free.confidence}}"}</code> — confidence of the free-tier claim
                  </li>
                  <li>
                    <code className="mono">{"{{availability.status}}"}</code> — availability status
                  </li>
                </ul>
                <p className={styles.referenceGroup}>Filters</p>
                <ul className={styles.referenceList}>
                  <li>
                    <code className="mono">|slug</code> — lowercase, dash-separated
                  </li>
                  <li>
                    <code className="mono">|date</code> — formats a date/time value as YYYY-MM-DD
                  </li>
                  <li>
                    <code className="mono">|tokens</code> — formats a token count (e.g. 128K)
                  </li>
                  <li>
                    <code className="mono">|raw</code> — skip JSON-escaping the value
                  </li>
                </ul>
                <p className={styles.referenceNote}>
                  Values are JSON-escaped unless the <code className="mono">|raw</code> filter is used.
                </p>
              </div>
            </details>
          </section>

          <section className={styles.section}>
            <div className={styles.outputHead}>
              <h3 className={styles.outputTitle}>Output</h3>
              <span className={validJson ? "chip chip-ok" : "chip"}>{validJson ? "Valid JSON" : "Not JSON"}</span>
              <div className={styles.outputActions}>
                <button type="button" className="btn btn-secondary" onClick={copyOutput}>
                  {copyState === "copied" ? "Copied" : copyState === "failed" ? "Copy failed" : "Copy"}
                </button>
                <button type="button" className="btn btn-primary" onClick={downloadOutput}>
                  Download
                </button>
              </div>
            </div>
            <pre className={`mono ${styles.output}`} data-error={Boolean(error)}>
              {error ?? output}
            </pre>
          </section>
        </div>
      </div>
    </div>
  );
}
