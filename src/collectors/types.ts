import type {
  AvailabilityStatus,
  Capability,
  EndpointProtocol,
  FeedDocument,
  FeedProfile,
  ModelOffering,
  Provider,
  SourceClaim
} from "../feed/schema";

export type CollectorId =
  | "openrouter"
  | "groq"
  | "gemini"
  | "github-models"
  | "opencode-go"
  | "opencode-zen"
  | "cline"
  | "cline-pass";

export type CollectorNotice = Record<string, unknown>;

export interface CollectorContext {
  now: Date;
  fetch: typeof fetch;
  env: Record<string, string | undefined>;
}

export interface CollectorResult {
  provider: Provider;
  models: ModelOffering[];
  notices: CollectorNotice[];
}

export interface Collector {
  id: CollectorId;
  collect(context: CollectorContext): Promise<CollectorResult>;
}

export type FeedRecord = FeedDocument;

export type NormalizedProvider = Provider;
export type NormalizedModelOffering = ModelOffering;
export type NormalizedProfile = FeedProfile;
export type NormalizedSourceClaim = SourceClaim;
export type NormalizedCapability = Capability;
export type NormalizedEndpointProtocol = EndpointProtocol;
export type NormalizedAvailabilityStatus = AvailabilityStatus;
