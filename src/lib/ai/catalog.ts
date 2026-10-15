/**
 * Provider catalog shared by the settings UI, the API route and the provider
 * factory.
 *
 * Pure data — no secrets and no runtime dependencies — so it is safe to import
 * from client components. Each entry maps a stored provider id onto the wire
 * protocol the provider client speaks.
 */

export type ProviderProtocol = "gemini" | "anthropic" | "openai" | "ollama";

export interface ProviderPreset {
  /** Stored in AccountProvider.type and validated by the API. */
  id: string;
  label: string;
  protocol: ProviderProtocol;
  /**
   * Default endpoint. Empty when the protocol has no URL (Gemini) or when the
   * user must supply their own (custom).
   */
  baseUrl: string;
  /** Suggested model id — always editable. */
  model: string;
  keyPlaceholder: string;
  /** Local servers usually run without authentication. */
  keyOptional: boolean;
  help: string;
  group: "cloud" | "local";
}

export const PROVIDER_PRESETS: readonly ProviderPreset[] = [
  {
    id: "gemini",
    label: "Google Gemini",
    protocol: "gemini",
    baseUrl: "",
    model: "gemini-2.5-flash",
    keyPlaceholder: "AIza...",
    keyOptional: false,
    help: "A Google AI Studio key (the free tier works). The model is a Gemini id such as gemini-2.5-flash.",
    group: "cloud",
  },
  {
    id: "openai",
    label: "OpenAI",
    protocol: "openai",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4o-mini",
    keyPlaceholder: "sk-...",
    keyOptional: false,
    help: "An OpenAI API key and a model id such as gpt-4o-mini.",
    group: "cloud",
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    protocol: "openai",
    baseUrl: "https://openrouter.ai/api/v1",
    model: "google/gemini-2.5-flash",
    keyPlaceholder: "sk-or-...",
    keyOptional: false,
    help: "One key for many vendors. The model is vendor/model, e.g. google/gemini-2.5-flash.",
    group: "cloud",
  },
  {
    id: "anthropic",
    label: "Anthropic (Claude)",
    protocol: "anthropic",
    baseUrl: "https://api.anthropic.com/v1",
    model: "claude-sonnet-4-5",
    keyPlaceholder: "sk-ant-...",
    keyOptional: false,
    help: "An Anthropic API key and a model id such as claude-sonnet-4-5.",
    group: "cloud",
  },
  {
    id: "xai",
    label: "xAI (Grok)",
    protocol: "openai",
    baseUrl: "https://api.x.ai/v1",
    model: "grok-3",
    keyPlaceholder: "xai-...",
    keyOptional: false,
    help: "An xAI API key. The endpoint speaks the OpenAI protocol.",
    group: "cloud",
  },
  {
    id: "groq",
    label: "Groq",
    protocol: "openai",
    baseUrl: "https://api.groq.com/openai/v1",
    model: "llama-3.3-70b-versatile",
    keyPlaceholder: "gsk_...",
    keyOptional: false,
    help: "Very fast hosted open-weight models, e.g. llama-3.3-70b-versatile.",
    group: "cloud",
  },
  {
    id: "mistral",
    label: "Mistral",
    protocol: "openai",
    baseUrl: "https://api.mistral.ai/v1",
    model: "mistral-large-latest",
    keyPlaceholder: "Mistral API key",
    keyOptional: false,
    help: "A Mistral API key and a model id such as mistral-large-latest.",
    group: "cloud",
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    protocol: "openai",
    baseUrl: "https://api.deepseek.com/v1",
    model: "deepseek-chat",
    keyPlaceholder: "sk-...",
    keyOptional: false,
    help: "A DeepSeek API key; deepseek-chat or deepseek-reasoner.",
    group: "cloud",
  },
  {
    id: "ollama",
    label: "Ollama (local)",
    protocol: "ollama",
    baseUrl: "http://localhost:11434",
    model: "qwen3.5:9b",
    keyPlaceholder: "",
    keyOptional: true,
    help:
      "Models running on your own machine through Ollama's native API — no key needed. " +
      "Requests run with thinking disabled and a large context window, which reasoning models need to produce usable output.",
    group: "local",
  },
  {
    id: "custom",
    label: "Custom (OpenAI-compatible)",
    protocol: "openai",
    baseUrl: "",
    model: "",
    keyPlaceholder: "sk-... (blank for a local server)",
    keyOptional: true,
    help:
      "Any OpenAI-compatible server — LM Studio, vLLM, llama.cpp, an internal proxy. " +
      "Set the base URL (usually ending in /v1); the key is optional.",
    group: "cloud",
  },
];

export function presetFor(type: string | undefined | null): ProviderPreset | undefined {
  if (!type) return undefined;
  return PROVIDER_PRESETS.find((p) => p.id === type);
}
