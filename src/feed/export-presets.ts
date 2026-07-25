import type { DelegationProfileId } from "./ranking";
import type { ExportTemplate } from "./export-template";

export type ExportPreset = ExportTemplate & { id: string; profileId?: DelegationProfileId };

const DELEGATION_TABLE_ROW =
  "| {{id|md}} | {{provider.name|md}} | {{_coding_score}} | {{_reasoning_score}} | {{_agentic_score}} | " +
  "{{_speed_score}} | {{limits.context_tokens|tokens}} | {{_blended_price_per_1m}} |";

const DELEGATION_TABLE_WRAPPER =
  "| Model | Provider | Coding | Reasoning | Agentic | Speed | Context | $/1M (blended) |\n" +
  "| --- | --- | --- | --- | --- | --- | --- | --- |\n" +
  "{{rows}}\n\n" +
  "_Scores by [Artificial Analysis](https://artificialanalysis.ai/)._";

function delegationTablePreset(id: string, name: string, profileId?: DelegationProfileId): ExportPreset {
  return {
    id,
    name,
    profileId,
    rowTemplate: DELEGATION_TABLE_ROW,
    wrapperTemplate: DELEGATION_TABLE_WRAPPER,
    rowSeparator: "\n"
  };
}

export const EXPORT_PRESETS: ExportPreset[] = [
  {
    id: "preset-cline-cc",
    name: "Cline CC Plugin profiles",
    rowTemplate: `    {
      "name": "{{provider.id}}-{{provider_model_id|slug}}",
      "provider": "{{provider.id}}",
      "model": "{{provider_model_id}}",
      "guidance": "Model Feed — {{display_name}}: {{_delegation_guidance}}"
    }`,
    wrapperTemplate: `{
  "note": "Project-local profiles for the cline Claude Code plugin (--profile on /cline:delegate and /cline:review). Entries: { \\"name\\", \\"provider\\", \\"model\\" (optional — omit to use the provider's configured default) }. Entries here override the plugin's built-in profiles and the derived ClinePass model names. List everything with /cline:profiles. Safe to commit. Set \\"ledger\\": true to append one line of telemetry per Run (no task text) to .cline-runs.ndjson beside this file — consider gitignoring that file.",
  "profiles": [
{{rows}}
  ],
  "ledger": true
}`,
    rowSeparator: ",\n"
  },
  {
    id: "preset-json-array",
    name: "JSON array",
    rowTemplate:
      '  { "id": "{{id}}", "name": "{{display_name}}", "provider": "{{provider.id}}", "model": "{{provider_model_id}}", "context": "{{limits.context_tokens|tokens}}", "pricing": "{{pricing.kind}}", "status": "{{availability.status}}" }',
    wrapperTemplate: "[\n{{rows}}\n]",
    rowSeparator: ",\n"
  },
  {
    id: "preset-csv",
    name: "CSV",
    rowTemplate:
      '"{{id|csv}}","{{display_name|csv}}","{{provider.id|csv}}","{{provider_model_id|csv}}","{{pricing.kind|csv}}","{{availability.status|csv}}"',
    wrapperTemplate: "id,name,provider,model,pricing,status\n{{rows}}",
    rowSeparator: "\n"
  },
  delegationTablePreset("preset-delegation-table", "Delegation table (Markdown)"),
  delegationTablePreset("preset-best-coder", "Best coder (Markdown)", "best-coder"),
  delegationTablePreset("preset-best-agentic", "Best agentic (Markdown)", "best-agentic"),
  delegationTablePreset("preset-best-value-coder", "Best value coder (Markdown)", "best-value-coder"),
  delegationTablePreset("preset-best-free-coder", "Best free coder (Markdown)", "best-free-coder")
];
