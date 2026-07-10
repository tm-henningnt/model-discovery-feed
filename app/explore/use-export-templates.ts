"use client";

import { useEffect, useMemo, useState } from "react";
import type { ExportPreset } from "@/feed/export-presets";
import { EXPORT_PRESETS } from "@/feed/export-presets";

const STORAGE_KEY = "mdf-export-templates-v1";

type Stored = {
  templates: ExportPreset[];
  selectedId: string;
};

function isValidTemplate(value: unknown): value is ExportPreset {
  if (!value || typeof value !== "object") return false;
  const o = value as Record<string, unknown>;
  return (
    typeof o.id === "string" &&
    typeof o.name === "string" &&
    typeof o.rowTemplate === "string" &&
    typeof o.wrapperTemplate === "string" &&
    typeof o.rowSeparator === "string"
  );
}

function fallbackState(): Stored {
  return { templates: [], selectedId: EXPORT_PRESETS[0].id };
}

function loadStored(): Stored {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return fallbackState();

    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return fallbackState();

    const record = parsed as Record<string, unknown>;
    const templates = Array.isArray(record.templates) ? record.templates.filter(isValidTemplate) : [];
    const selectedId = typeof record.selectedId === "string" ? record.selectedId : EXPORT_PRESETS[0].id;
    return { templates, selectedId };
  } catch {
    return fallbackState();
  }
}

function nextDuplicateName(baseName: string, existingNames: string[]): string {
  const base = baseName.replace(/ copy(?: \d+)?$/, "");
  const taken = new Set(existingNames);
  if (!taken.has(`${base} copy`)) return `${base} copy`;
  let n = 2;
  while (taken.has(`${base} copy ${n}`)) n++;
  return `${base} copy ${n}`;
}

export function useExportTemplates() {
  const [state, setState] = useState<Stored>(() => loadStored());
  const [saveError, setSaveError] = useState(false);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      setSaveError(false);
    } catch {
      setSaveError(true);
    }
  }, [state]);

  const allTemplates = useMemo(() => [...EXPORT_PRESETS, ...state.templates], [state.templates]);

  const selected = useMemo(
    () => allTemplates.find((t) => t.id === state.selectedId) ?? EXPORT_PRESETS[0],
    [allTemplates, state.selectedId]
  );

  const isUserTemplate = state.templates.some((t) => t.id === selected.id);

  function setSelectedId(id: string) {
    setState((prev) => ({ ...prev, selectedId: id }));
  }

  function updateSelected(patch: Partial<Omit<ExportPreset, "id">>) {
    setState((prev) => ({
      ...prev,
      templates: prev.templates.map((t) => (t.id === selected.id ? { ...t, ...patch } : t))
    }));
  }

  function duplicateSelected() {
    const existingNames = allTemplates.map((t) => t.name);
    const copy: ExportPreset = {
      ...selected,
      id: crypto.randomUUID(),
      name: nextDuplicateName(selected.name, existingNames)
    };
    setState((prev) => ({ templates: [...prev.templates, copy], selectedId: copy.id }));
  }

  function deleteSelected() {
    if (!isUserTemplate) return;
    setState((prev) => ({
      templates: prev.templates.filter((t) => t.id !== selected.id),
      selectedId: EXPORT_PRESETS[0].id
    }));
  }

  return {
    presets: EXPORT_PRESETS,
    userTemplates: state.templates,
    selected,
    isUserTemplate,
    saveError,
    setSelectedId,
    updateSelected,
    duplicateSelected,
    deleteSelected
  };
}
