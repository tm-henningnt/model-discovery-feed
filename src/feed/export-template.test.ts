import { describe, expect, it } from "vitest";
import { EXPORT_PRESETS } from "./export-presets";
import {
  escapeMarkdownTableCell,
  escapeRowSeparator,
  parseRowSeparator,
  renderExport,
  slugify,
  type ExportTemplate
} from "./export-template";
import { exampleFeed } from "./fixture";
import { rankByProfile } from "./ranking";

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
      "preset-csv",
      "preset-delegation-table",
      "preset-best-coder",
      "preset-best-agentic",
      "preset-best-value-coder",
      "preset-best-free-coder"
    ]);
  });

  describe("recommendation-rich virtual fields", () => {
    it("_capabilities joins the capability list with slashes", () => {
      const output = renderExport(template("{{_capabilities}}"), [cloneModels()[0]]);
      expect(output).toBe("chat/coding/tool_use/structured_output/streaming");
    });

    it("_delegation_guidance composes pricing, context, scores, blended price, and caps", () => {
      const model = cloneModels()[0]; // openrouter qwen3-coder:free — scored, free
      const output = renderExport(template("{{_delegation_guidance}}"), [model]);
      expect(output).toContain("free");
      expect(output).toContain("coding 71.4");
      expect(output).toContain("reasoning 51.2");
      expect(output).toContain("ctx 262K");
      expect(output).toContain("caps chat/coding");
    });

    it("appends recommendation notes and neutralizes JSON-breaking characters", () => {
      const model = cloneModels()[0];
      model.quality.recommendation_notes = ['Great "coder"\nreliable'];
      const output = renderExport(template("{{_delegation_guidance}}"), [model]);
      expect(output).toContain("Great 'coder' reliable");
      expect(output).not.toContain('"');
      expect(output).not.toContain("\n");
    });

    it("neutralizes C0 control characters in raw-emitted guidance", () => {
      const model = cloneModels()[0];
      model.quality.recommendation_notes = ["col1" + String.fromCharCode(9) + "col2" + String.fromCharCode(1) + "x"];
      const output = renderExport(template("{{_delegation_guidance}}"), [model]);
      expect(output).not.toContain(String.fromCharCode(9));
      expect(output).not.toContain(String.fromCharCode(1));
      expect(() => JSON.parse('"' + output + '"')).not.toThrow();
    });


    it("renders the Cline CC preset as valid JSON with rich per-profile guidance", () => {
      const preset = EXPORT_PRESETS.find((p) => p.id === "preset-cline-cc")!;
      const parsed = JSON.parse(renderExport(preset, cloneModels())) as {
        profiles: Array<{ name: string; provider: string; model: string; guidance: string }>;
      };

      expect(parsed.profiles).toHaveLength(2);
      const first = parsed.profiles[0];
      expect(first.provider).toBe("openrouter");
      // Guidance now carries the feed's recommendation data, not just pricing.kind.
      expect(first.guidance).toContain("Model Feed —");
      expect(first.guidance).toContain("coding 71.4");
    });
  });

  describe("delegation-table preset (AC-008)", () => {
    const preset = EXPORT_PRESETS.find((p) => p.id === "preset-delegation-table")!;

    it("renders a golden GFM table with verbatim scores, a $0.00 free price, and em-dash nulls", () => {
      const output = renderExport(preset, cloneModels());

      expect(output).toBe(
        "| Model | Provider | Coding | Reasoning | Agentic | Speed | Context | $/1M (blended) |\n" +
          "| --- | --- | --- | --- | --- | --- | --- | --- |\n" +
          "| openrouter:qwen/qwen3-coder:free | OpenRouter | 71.4 | 51.2 | 45.6 | 245 t/s | 262K | $0.00 |\n" +
          "| groq:openai/gpt-oss-120b | Groq | — | — | — | — | 131K | — |\n" +
          "\n" +
          "_Scores by [Artificial Analysis](https://artificialanalysis.ai/)._"
      );
    });

    it("escapes a pipe in the provider name so the table structure survives", () => {
      const models = cloneModels();
      models[0].provider = { id: "openrouter", name: "Weird | Provider" };

      const output = renderExport(preset, [models[0]]);
      const firstDataRow = output.split("\n")[2];

      expect(firstDataRow).toContain("Weird \\| Provider");
      // Splitting on an UNESCAPED pipe still yields exactly 10 segments
      // (8 columns + 2 boundary empties from the leading/trailing "|"); an
      // unescaped "|" in the field would add an extra, breaking the table.
      expect(firstDataRow.split(/(?<!\\)\|/)).toHaveLength(10);
    });

    it("collapses a newline injected into the provider name so the row count is unaffected", () => {
      const models = cloneModels();
      models[0].provider = { id: "openrouter", name: "Injected\nRow" };

      const output = renderExport(preset, [models[0]]);

      // Header + separator + exactly ONE data row for the one offering + the
      // blank line + attribution note. An unescaped newline would insert an
      // extra line, splitting the row in two.
      expect(output.split("\n")).toHaveLength(5);
      expect(output).toContain("Injected Row");
      expect(output).not.toContain("Injected\nRow");
    });

    it("renders an unknown/missing price as an em-dash, not $NaN or $Infinity", () => {
      const model = cloneModels()[0];
      model.pricing.kind = "paid";
      model.pricing.free = null;
      model.pricing.input_usd_per_1m_tokens = null;
      model.pricing.output_usd_per_1m_tokens = null;

      const output = renderExport(preset, [model]);
      expect(output.split("\n")[2]).toContain("| — |");
      expect(output).not.toContain("NaN");
      expect(output).not.toContain("Infinity");
    });
  });

  describe("escapeMarkdownTableCell", () => {
    it("escapes backslashes before pipes so escaping is unambiguous to reverse", () => {
      expect(escapeMarkdownTableCell("a|b")).toBe("a\\|b");
      expect(escapeMarkdownTableCell("a\\b")).toBe("a\\\\b");
      expect(escapeMarkdownTableCell("a\\|b")).toBe("a\\\\\\|b");
    });

    it("collapses embedded newlines so a table row can't be split in two", () => {
      expect(escapeMarkdownTableCell("a\nb")).toBe("a b");
      expect(escapeMarkdownTableCell("a\r\nb")).toBe("a b");
      expect(escapeMarkdownTableCell("a\rb")).toBe("a b");
      expect(escapeMarkdownTableCell("a|b\nc")).toBe("a\\|b c");
    });
  });

  describe("profile export presets", () => {
    it("best-value-coder excludes free/unpriced offerings, matching the ranking profile's rule", () => {
      const preset = EXPORT_PRESETS.find((p) => p.id === "preset-best-value-coder")!;
      const models = cloneModels(); // includes the free qwen3-coder offering

      const ranked = rankByProfile(models, "best-value-coder");
      expect(ranked).toHaveLength(0); // neither fixture offering is paid with known pricing

      const output = renderExport(preset, ranked);
      // Header + separator + (empty rows placeholder leaves a blank line) +
      // blank + attribution note — no actual data row present.
      expect(output.split("\n")).toEqual([
        "| Model | Provider | Coding | Reasoning | Agentic | Speed | Context | $/1M (blended) |",
        "| --- | --- | --- | --- | --- | --- | --- | --- |",
        "",
        "",
        "_Scores by [Artificial Analysis](https://artificialanalysis.ai/)._"
      ]);
    });

    it("best-coder excludes offerings without tool_use or a coding score", () => {
      const models = cloneModels();
      const ranked = rankByProfile(models, "best-coder");

      // The scored fixture model (tool_use, coding 71.4) qualifies; the other
      // fixture model has neither tool_use nor a coding score.
      expect(ranked.map((m) => m.id)).toEqual(["openrouter:qwen/qwen3-coder:free"]);
    });
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
