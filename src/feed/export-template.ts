import { formatScore, formatSpeed, formatTokens } from "./format";
import { blendedPricePer1M } from "./ranking";
import type { ModelOffering } from "./schema";

// Computed fields no ordinary model path expresses: derived pricing and
// display-formatted scores. Resolved before the generic path-based lookup so
// existing presets (which only ever reference real model paths) are
// unaffected.
const VIRTUAL_FIELDS: Record<string, (model: ModelOffering) => string> = {
  _coding_score: (model) => formatScore(model.quality.coding_score),
  _reasoning_score: (model) => formatScore(model.quality.reasoning_score),
  _agentic_score: (model) => formatScore(model.quality.agentic_score),
  _speed_score: (model) => formatSpeed(model.quality.speed_score),
  _blended_price_per_1m: (model) => {
    const price = blendedPricePer1M(model);
    return Number.isFinite(price) ? `$${price.toFixed(2)}` : "—";
  }
};

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

// GFM table cells break on an unescaped "|"; escape it (and any literal
// backslash first, so escaping is unambiguous to reverse) rather than the
// generic JSON-string escaping renderRow applies to non-raw fields, which
// would add spurious backslashes before quotes that don't need escaping in
// Markdown.
export function escapeMarkdownTableCell(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\|/g, "\\|")
    .replace(/\r\n|\r|\n/g, " ");
}

function renderRow(rowTemplate: string, model: ModelOffering): string {
  return rowTemplate.replace(/\{\{([^{}]*)\}\}/g, (_placeholder, expression: string) => {
    const [path, ...filters] = expression.split("|").map((part) => part.trim());
    const virtual = VIRTUAL_FIELDS[path];
    let value = virtual ? virtual(model) : stringifyValue(resolvePath(model, path));
    let isRaw = Boolean(virtual);

    for (const filter of filters) {
      if (filter === "raw") {
        isRaw = true;
      } else if (filter === "csv") {
        // csv implies raw: RFC-4180 quote doubling instead of JSON escaping.
        isRaw = true;
        value = value.replace(/"/g, '""');
      } else if (filter === "md") {
        // md implies raw: GFM pipe escaping instead of JSON escaping.
        isRaw = true;
        value = escapeMarkdownTableCell(value);
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
