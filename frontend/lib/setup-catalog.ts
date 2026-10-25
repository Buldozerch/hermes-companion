import source from "../../catalog/hermes-options.json";
import type { SetupOptions } from "./types";

export interface CredentialField {
  name: string;
  label: string;
  description: string;
  secret: boolean;
  required: boolean;
  url: string;
}
export interface ModelProvider {
  id: string;
  name: string;
  description: string;
  authType: string;
  keyVars: string[];
  baseUrl: string;
  docsUrl: string;
  keyUrl: string;
  models: string[];
  apiMode: string;
}
export const setupCatalog = {
  ...source,
  providers: [...source.providers, ...source.additionalProviders],
};
export const nativeProviderCount = source.providers.length;
export const providers: ModelProvider[] = setupCatalog.providers;
export const browserLoginProviders = new Set([
  "nous",
  "openai-codex",
  "minimax-oauth",
  "xai-oauth",
  "anthropic",
  "openrouter",
  "antigravity-oauth",
]);
export function usesBrowserAuth(setup: SetupOptions) {
  return (
    browserLoginProviders.has(setup.provider) &&
    (setup.authMethod === "oauth" ||
      ["nous", "openai-codex", "minimax-oauth", "xai-oauth", "antigravity-oauth"].includes(
        setup.provider,
      ))
  );
}
export const baseTools = source.tools
  .map((tool) => tool.id)
  .filter(
    (id) =>
      ![
        "tts",
        "stt",
        "image_gen",
        "video_gen",
        "x_search",
        "computer_use",
        "discord_admin",
        "yuanbao",
      ].includes(id),
  );
export const defaultTools = [...baseTools, "tts", "stt"];
export const compatibleProviders = source.compatibleProviders;

export function normalizeSetup(setup: Partial<SetupOptions>): SetupOptions {
  return {
    provider: setup.provider === "openai" ? "openai-api" : (setup.provider ?? "openrouter"),
    authMethod: [
      "nous",
      "openai-codex",
      "minimax-oauth",
      "xai-oauth",
      "qwen-oauth",
      "antigravity-oauth",
    ].includes(setup.provider ?? "")
      ? "oauth"
      : (setup.authMethod ?? "api_key"),
    providerPreset: setup.providerPreset ?? "",
    allowUnauthenticatedModel: setup.allowUnauthenticatedModel ?? false,
    model: setup.model ?? "anthropic/claude-sonnet-4.6",
    baseUrl: setup.baseUrl ?? "",
    apiMode: setup.apiMode ?? "chat_completions",
    credentialEnv: setup.credentialEnv ?? "",
    moaConfig: setup.moaConfig ?? "",
    channels: setup.channels ?? (setup.telegram ? ["telegram"] : []),
    tools: setup.tools ?? [...defaultTools, ...(setup.browser ? ["browser"] : [])],
    ttsProvider: setup.ttsProvider ?? "edge",
    ttsVoice: setup.ttsVoice ?? "",
    sttProvider: setup.sttProvider ?? "groq",
    searchBackend: setup.searchBackend ?? "ddgs",
    extractBackend: setup.extractBackend ?? "builtin",
    imageProvider: setup.imageProvider ?? "fal",
    updateSystem: setup.updateSystem ?? true,
    telegram: setup.channels ? setup.channels.includes("telegram") : (setup.telegram ?? false),
    browser: setup.tools ? setup.tools.includes("browser") : (setup.browser ?? false),
  };
}

export function selectedProvider(id: string): ModelProvider {
  return providers.find((provider) => provider.id === id) ?? providers[0];
}
