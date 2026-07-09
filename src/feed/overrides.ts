import type { FeedDocument, ModelOffering, SourceClaim } from "./schema";

export type ManualOverrideInput = {
  targetFieldPath: string;
  value: unknown;
  reason: string;
  operator: string;
  sourceUrl: string | null;
  visibleInSourceClaims: boolean;
  expiresAt: string;
  createdAt: string;
};

export function applyManualOverrides(feed: FeedDocument, overrides: ManualOverrideInput[], now = new Date()): FeedDocument {
  if (overrides.length === 0) return feed;

  let models = feed.models;

  for (const override of overrides) {
    if (Date.parse(override.expiresAt) <= now.getTime()) continue;

    const parsed = parseTarget(override.targetFieldPath, models);
    if (!parsed) continue;

    models = models.map((model) => {
      if (model.id !== parsed.modelOfferingId) return model;
      return applyModelOverride(model, parsed.path, override);
    });
  }

  return {
    ...feed,
    models
  };
}

function parseTarget(targetFieldPath: string, models: ModelOffering[]): { modelOfferingId: string; path: string[] } | null {
  const prefix = "models.";
  if (!targetFieldPath.startsWith(prefix)) return null;
  const withoutPrefix = targetFieldPath.slice(prefix.length);

  const matchingModel = models
    .map((model) => model.id)
    .filter((id) => withoutPrefix.startsWith(`${id}.`))
    .sort((a, b) => b.length - a.length)[0];

  if (!matchingModel) return null;
  const path = withoutPrefix.slice(matchingModel.length + 1).split(".");
  if (path.length === 0 || path.some((part) => part.length === 0)) return null;
  return { modelOfferingId: matchingModel, path };
}

function applyModelOverride(model: ModelOffering, path: string[], override: ManualOverrideInput): ModelOffering {
  const clone = structuredClone(model) as Record<string, unknown>;
  setNestedValue(clone, path, override.value);

  if (override.visibleInSourceClaims) {
    const sourceClaim: SourceClaim = {
      id: `manual_override_${safeId(model.id)}_${safeId(path.join("_"))}_${Date.parse(override.createdAt)}`,
      source_type: "manual_override",
      source_url: override.sourceUrl,
      collector: "manual_override",
      observed_at: override.createdAt,
      field_paths: [path.join(".")],
      confidence: "high",
      raw_reference: {
        reason: override.reason,
        operator: override.operator,
        expires_at: override.expiresAt
      }
    };

    clone.source_claims = [...model.source_claims, sourceClaim];
  }

  return clone as ModelOffering;
}

function setNestedValue(target: Record<string, unknown>, path: string[], value: unknown) {
  let cursor: Record<string, unknown> = target;
  for (const part of path.slice(0, -1)) {
    const next = cursor[part];
    if (!next || typeof next !== "object" || Array.isArray(next)) {
      cursor[part] = {};
    }
    cursor = cursor[part] as Record<string, unknown>;
  }
  cursor[path[path.length - 1]] = value;
}

function safeId(value: string): string {
  return value.replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}
