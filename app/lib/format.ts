import type {
  AvailabilityStatus,
  Capability,
  ModelOffering,
  PricingKind
} from "@/feed/schema";
import { isConfidentlyFree } from "@/feed/classification";

export { formatScore, formatSpeed, formatTokens, safeHttpUrl } from "@/feed/format";

export type Tone = "ok" | "warn" | "bad" | "neutral";

export function availabilityTone(status: AvailabilityStatus): Tone {
  switch (status) {
    case "available":
      return "ok";
    case "limited":
    case "degraded":
      return "warn";
    case "deprecated":
    case "retired":
    case "blocked":
      return "bad";
    default:
      return "neutral";
  }
}

export function pricingTone(model: ModelOffering, now: Date): Tone {
  const kind = model.pricing.kind;
  if (kind === "free" && isConfidentlyFree(model, now)) return "ok";
  if (kind === "free" || kind === "free_tier" || kind === "trial" || kind === "subscription_included") return "warn";
  if (kind === "paid") return "neutral";
  return "neutral";
}

const PRICING_LABEL: Record<PricingKind, string> = {
  free: "Free",
  free_tier: "Free tier",
  trial: "Trial",
  subscription_included: "Subscription",
  paid: "Paid",
  local: "Local",
  unknown: "Unknown"
};

export function pricingLabel(kind: PricingKind): string {
  return PRICING_LABEL[kind] ?? kind;
}

const CAPABILITY_LABEL: Partial<Record<Capability, string>> = {
  chat: "Chat",
  coding: "Coding",
  reasoning: "Reasoning",
  tool_use: "Tools",
  structured_output: "Structured",
  json_mode: "JSON",
  streaming: "Streaming",
  vision: "Vision",
  image_generation: "Image gen",
  embeddings: "Embeddings",
  reranking: "Reranking",
  speech_to_text: "Speech→text",
  text_to_speech: "Text→speech",
  batch: "Batch",
  prompt_caching: "Caching",
  files: "Files"
};

export function capabilityLabel(cap: string): string {
  return CAPABILITY_LABEL[cap as Capability] ?? cap.replace(/_/g, " ");
}

export function statusLabel(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1).replace(/_/g, " ");
}

const SUB_BENCHMARK_LABEL: Record<string, string> = {
  mmlu_pro: "MMLU-Pro",
  gpqa: "GPQA",
  hle: "HLE",
  livecodebench: "LiveCodeBench",
  scicode: "SciCode",
  math_500: "MATH-500",
  aime: "AIME",
  aime_25: "AIME 25",
  ifbench: "IFBench",
  lcr: "LCR",
  terminalbench_hard: "Terminal-Bench Hard",
  terminalbench_v2_1: "Terminal-Bench v2.1",
  tau2: "τ²-Bench",
  tau_banking: "τ-Bench Banking"
};

export function subBenchmarkLabel(key: string): string {
  return SUB_BENCHMARK_LABEL[key] ?? statusLabel(key);
}

const PROTOCOL_LABEL: Record<string, string> = {
  openai_chat_completions: "OpenAI Chat Completions",
  openai_responses: "OpenAI Responses",
  anthropic_messages: "Anthropic Messages",
  gemini_generate_content: "Gemini generateContent",
  github_models: "GitHub Models",
  huggingface_inference: "Hugging Face Inference",
  local_openai_compatible: "Local (OpenAI-compatible)",
  unknown: "Unknown"
};

export function protocolLabel(protocol: string): string {
  return PROTOCOL_LABEL[protocol] ?? protocol;
}

export function formatPrice(model: ModelOffering, now: Date): string {
  const { pricing } = model;
  if (isConfidentlyFree(model, now)) return "$0";
  const input = pricing.input_usd_per_1m_tokens;
  const output = pricing.output_usd_per_1m_tokens;
  if (input == null && output == null) return "—";
  const fmt = (n: number | null) => (n == null ? "?" : `$${n}`);
  return `${fmt(input)} / ${fmt(output)}`;
}

export function formatRelativeTime(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return "—";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "—";
  const diffMs = now - then;
  const abs = Math.abs(diffMs);
  const min = 60_000;
  const hour = 60 * min;
  const day = 24 * hour;
  const suffix = diffMs >= 0 ? "ago" : "from now";
  if (abs < hour) return `${Math.max(1, Math.round(abs / min))}m ${suffix}`;
  if (abs < day) return `${Math.round(abs / hour)}h ${suffix}`;
  if (abs < 30 * day) return `${Math.round(abs / day)}d ${suffix}`;
  return new Date(iso).toISOString().slice(0, 10);
}
