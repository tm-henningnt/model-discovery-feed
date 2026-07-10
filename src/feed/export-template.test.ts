import { describe, expect, it } from "vitest";
import { EXPORT_PRESETS } from "./export-presets";
import {
  escapeRowSeparator,
  parseRowSeparator,
  renderExport,
  slugify,
  type ExportTemplate
} from "./export-template";
import { exampleFeed } from "./fixture";

const template = (rowTemplate: string, wrapperTemplate = "{{rows}}", rowSeparator = ""): ExportTemplate => ({
  name: "Test template",
  rowTemplate,
  wrapperTemplate,
  rowSeparator
});

const cloneModels = () => structuredClone(exampleFeed.models);

describe("renderExport", () => {
  it("resolves nested dot-paths and renders missing paths as empty strings", () => {
    const output = renderExport(
      template("{{provider.id}}|{{pricing.free.confidence}}|{{missing.path}}"),
      [cloneModels()[0]]
    );

    expect(output).toBe("openrouter|high|");
  });

  it("stringifies object and array values before escaping", () => {
    const output = renderExport(template("{{provider}}|{{capabilities}}"), [cloneModels()[0]]);

    expect(output).toBe(
      '{\\"id\\":\\"openrouter\\",\\"name\\":\\"OpenRouter\\"}|[\\"chat\\",\\"coding\\",\\"tool_use\\",\\"structured_output\\",\\"streaming\\"]'
    );
  });

  it("applies slug, date, tokens, raw, unknown, and chained filters", () => {
    const model = cloneModels()[0];
    const output = renderExport(
      template(
        "{{ provider_model_id | slug }}|{{pricing.free.last_verified_at|date}}|{{limits.context_tokens|tokens}}|{{provider.id|raw}}|{{provider.id|unknown}}|{{provider_model_id|unknown|slug|unknown}}"
      ),
      [model]
    );

    expect(output).toBe(
      "qwen-qwen3-coder-free|2026-07-08|262K|openrouter|openrouter|qwen-qwen3-coder-free"
    );
  });

  it("returns empty strings for non-numeric tokens and leaves invalid dates unchanged", () => {
    const output = renderExport(
      template("{{provider.id|tokens}}|{{provider.id|date}}"),
      [cloneModels()[0]]
    );

    expect(output).toBe("|openrouter");
  });

  it("JSON-escapes values by default and preserves raw values verbatim", () => {
    const [model] = cloneModels();
    model.display_name = 'Quoted "name"\nsecond line';

    const escaped = renderExport(template('{"name":"{{display_name}}"}'), [model]);
    const raw = renderExport(template("{{display_name|raw}}"), [model]);

    expect(JSON.parse(escaped)).toEqual({ name: model.display_name });
    expect(raw).toBe(model.display_name);
  });

  it("joins rows, substitutes only the first rows placeholder, and handles empty models", () => {
    const joined = renderExport(
      template("{{provider.id}}", "before {{rows}} after {{rows}}", "|"),
      cloneModels()
    );
    const empty = renderExport(template("{{provider.id}}", "before {{rows}} after"), []);

    expect(joined).toBe("before openrouter|groq after {{rows}}");
    expect(empty).toBe("before  after");
  });

  it("does not interpret $-replacement patterns in row content", () => {
    const [model] = cloneModels();
    model.display_name = "priced at $& or $' or $1";

    const output = renderExport(template("{{display_name|raw}}", "X{{rows}}Y"), [model]);

    expect(output).toBe("Xpriced at $& or $' or $1Y");
  });

  it("leaves wrappers without rows placeholders unchanged", () => {
    const output = renderExport(template("{{provider.id}}", "unchanged"), cloneModels());

    expect(output).toBe("unchanged");
  });

  it("renders the Cline CC Plugin profiles preset as valid JSON", () => {
    const preset = EXPORT_PRESETS[0];
    const output = renderExport(preset, cloneModels());
    const parsed = JSON.parse(output) as {
      ledger: unknown;
      note: string;
      profiles: Array<Record<string, unknown>>;
    };

    expect(preset.name).toBe("Cline CC Plugin profiles");
    expect(parsed.note).toContain('Entries: { "name", "provider", "model"');
    expect(parsed.profiles).toHaveLength(2);
    expect(parsed.profiles[0]).toMatchObject({
      name: "openrouter-qwen-qwen3-coder-free",
      provider: "openrouter",
      model: "qwen/qwen3-coder:free"
    });
    expect(typeof parsed.ledger).toBe("boolean");
  });

  it("renders the JSON array preset as a two-model JSON array", () => {
    const preset = EXPORT_PRESETS[1];
    const parsed = JSON.parse(renderExport(preset, cloneModels())) as unknown[];

    expect(preset.name).toBe("JSON array");
    expect(parsed).toHaveLength(2);
  });

  it("exports the documented presets in order", () => {
    expect(EXPORT_PRESETS.map((preset) => preset.id)).toEqual([
      "preset-cline-cc",
      "preset-json-array",
      "preset-csv"
    ]);
  });

  it("slugifies strings the same way the slug filter does", () => {
    expect(slugify("qwen/qwen3-coder:free")).toBe("qwen-qwen3-coder-free");
    expect(slugify("")).toBe("");
  });

  it("applies the csv filter as raw output with RFC-4180 quote doubling", () => {
    const [model] = cloneModels();
    model.display_name = 'Foo "Bar", Ltd';

    const output = renderExport(template('"{{display_name|csv}}"'), [model]);

    expect(output).toBe('"Foo ""Bar"", Ltd"');
    expect(output).not.toContain('\\"');
  });

  it("renders the CSV preset with quoted fields safe for spreadsheet import", () => {
    const models = cloneModels();
    models[0].display_name = 'Quote "Me", Please';

    const output = renderExport(EXPORT_PRESETS[2], models);
    const lines = output.split("\n");

    expect(lines).toHaveLength(3);
    expect(lines[1]).toContain('""Me""');
    expect(lines[2].split(",")).toHaveLength(6);
  });

  it("round-trips row separators through escape/parse helpers", () => {
    expect(parseRowSeparator("\\n")).toBe("\n");
    expect(parseRowSeparator("\\t")).toBe("\t");
    expect(parseRowSeparator("\\\\")).toBe("\\");
    expect(parseRowSeparator("\\")).toBe("\\");
    expect(escapeRowSeparator(parseRowSeparator(",\\n"))).toBe(",\\n");
  });
});
