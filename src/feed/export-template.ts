import { formatTokens } from "./format";
import type { ModelOffering } from "./schema";

export type ExportTemplate = {
  name: string;
  rowTemplate: string;
  wrapperTemplate: string;
  rowSeparator: string;
};

function resolvePath(model: ModelOffering, path: string): unknown {
  let value: unknown = model;

  for (const segment of path.split(".").map((part) => part.trim())) {
    if (
      value == null ||
      typeof value !== "object" ||
      !Object.prototype.hasOwnProperty.call(value, segment)
    ) {
      return undefined;
    }

    value = (value as Record<string, unknown>)[segment];
  }

  return value;
}

function stringifyValue(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value) ?? "";
}

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[/:.\s]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function applyFilter(value: string, filter: string): string {
  if (filter === "slug") {
    return slugify(value);
  }

  if (filter === "date") {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? value : new Date(parsed).toISOString().slice(0, 10);
  }

  if (filter === "tokens") {
    const tokens = Number(value);
    return value.trim() === "" || !Number.isFinite(tokens) ? "" : formatTokens(tokens);
  }

  return value;
}

function renderRow(rowTemplate: string, model: ModelOffering): string {
  return rowTemplate.replace(/\{\{([^{}]*)\}\}/g, (_placeholder, expression: string) => {
    const [path, ...filters] = expression.split("|").map((part) => part.trim());
    let value = stringifyValue(resolvePath(model, path));
    let isRaw = false;

    for (const filter of filters) {
      if (filter === "raw") {
        isRaw = true;
      } else if (filter === "csv") {
        // csv implies raw: RFC-4180 quote doubling instead of JSON escaping.
        isRaw = true;
        value = value.replace(/"/g, '""');
      } else {
        value = applyFilter(value, filter);
      }
    }

    return isRaw ? value : JSON.stringify(value).slice(1, -1);
  });
}

// Displays a separator like "\n" as the two literal characters \n so it's
// editable in a single-line text input, and parses that back on the way in.
export function escapeRowSeparator(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/\t/g, "\\t");
}

export function parseRowSeparator(display: string): string {
  let result = "";
  for (let i = 0; i < display.length; i++) {
    const ch = display[i];
    if (ch === "\\" && i + 1 < display.length) {
      const next = display[i + 1];
      if (next === "\\") {
        result += "\\";
        i++;
      } else if (next === "n") {
        result += "\n";
        i++;
      } else if (next === "t") {
        result += "\t";
        i++;
      } else {
        result += ch;
      }
    } else {
      result += ch;
    }
  }
  return result;
}

export function renderExport(template: ExportTemplate, models: ModelOffering[]): string {
  const rows = models.map((model) => renderRow(template.rowTemplate, model)).join(template.rowSeparator);
  // Function replacement so `$`-sequences in row content are never interpreted
  // as replacement patterns by String.prototype.replace.
  return template.wrapperTemplate.replace("{{rows}}", () => rows);
}
