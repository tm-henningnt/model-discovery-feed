import type { ExportTemplate } from "./export-template";

export type ExportPreset = ExportTemplate & { id: string };

export const EXPORT_PRESETS: ExportPreset[] = [
  {
    id: "preset-cline-cc",
    name: "Cline CC Plugin profiles",
    rowTemplate: `    {
      "name": "{{provider.id}}-{{provider_model_id|slug}}",
      "provider": "{{provider.id}}",
      "model": "{{provider_model_id}}",
      "guidance": "Model Feed: {{pricing.kind}} candidate. Context {{limits.context_tokens|tokens}}. Free-claim verified {{pricing.free.last_verified_at|date}} ({{pricing.free.confidence}} confidence)."
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
  }
];
