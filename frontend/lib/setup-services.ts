import type { SetupOptions } from "./types";
import { compatibleProviders, selectedProvider, setupCatalog } from "./setup-catalog";

export const serviceKeys: Record<string, { name: string; url: string }> = {
  ELEVENLABS_API_KEY: { name: "ElevenLabs", url: "https://elevenlabs.io/app/settings/api-keys" },
  GROQ_API_KEY: { name: "Groq", url: "https://console.groq.com/keys" },
  VOICE_TOOLS_OPENAI_KEY: { name: "OpenAI", url: "https://platform.openai.com/api-keys" },
  OPENAI_API_KEY: { name: "OpenAI", url: "https://platform.openai.com/api-keys" },
  BRAVE_SEARCH_API_KEY: {
    name: "Brave Search",
    url: "https://api-dashboard.search.brave.com/app/keys",
  },
  FIRECRAWL_API_KEY: { name: "Firecrawl", url: "https://www.firecrawl.dev/app/api-keys" },
  FAL_KEY: { name: "fal.ai", url: "https://fal.ai/dashboard/keys" },
  REPLICATE_API_TOKEN: { name: "Replicate", url: "https://replicate.com/account/api-tokens" },
  XAI_API_KEY: { name: "xAI", url: "https://console.x.ai/team/default/api-keys" },
  MINIMAX_API_KEY: {
    name: "MiniMax",
    url: "https://platform.minimax.io/user-center/basic-information/interface-key",
  },
  MISTRAL_API_KEY: { name: "Mistral", url: "https://console.mistral.ai/api-keys" },
  GEMINI_API_KEY: { name: "Google", url: "https://aistudio.google.com/apikey" },
  DEEPINFRA_API_KEY: { name: "DeepInfra", url: "https://deepinfra.com/dash/api_keys" },
};

export function modelKey(setup: SetupOptions): string {
  if (setup.authMethod === "oauth") return "";
  const preset = compatibleProviders.find((item) => item.id === setup.providerPreset);
  if (setup.provider === "custom") return preset?.keyVar || "COMPANION_CUSTOM_API_KEY";
  const provider = selectedProvider(setup.provider);
  return provider.keyVars.includes(setup.credentialEnv)
    ? setup.credentialEnv
    : (provider.keyVars[0] ?? "");
}

export function activeCredentialNames(setup: SetupOptions): Set<string> {
  const names = new Set<string>();
  const key = modelKey(setup);
  if (key) names.add(key);
  const add = (...items: string[]) => items.forEach((item) => names.add(item));
  if (setup.provider === "bedrock")
    add("AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_SESSION_TOKEN", "AWS_REGION");
  if (setup.provider === "vertex")
    add("GOOGLE_CLOUD_PROJECT", "GOOGLE_CLOUD_LOCATION", "GOOGLE_SERVICE_ACCOUNT_JSON");
  if (setup.provider === "qwen-oauth") add("QWEN_AUTH_JSON");
  if (setup.provider === "copilot-acp") add("COPILOT_GITHUB_TOKEN");
  if (setup.provider === "moa")
    for (const provider of setupCatalog.providers) for (const name of provider.keyVars) add(name);
  for (const channel of setupCatalog.channels.filter((item) => setup.channels.includes(item.id)))
    for (const field of channel.fields) add(field.name);
  for (const [tool, collection, provider] of [
    ["tts", setupCatalog.ttsProviders, setup.ttsProvider],
    ["stt", setupCatalog.sttProviders, setup.sttProvider],
  ] as const)
    if (setup.tools.includes(tool)) {
      const key = collection.find((item) => item.id === provider)?.keyVar;
      if (key) add(key);
      if (key === "VOICE_TOOLS_OPENAI_KEY") add("OPENAI_API_KEY");
    }
  if (setup.tools.includes("web")) {
    if (setup.searchBackend === "brave-free") add("BRAVE_SEARCH_API_KEY");
    if (setup.extractBackend === "firecrawl") add("FIRECRAWL_API_KEY");
  }
  if (setup.tools.includes("image_gen"))
    add(
      { fal: "FAL_KEY", replicate: "REPLICATE_API_TOKEN", openai: "OPENAI_API_KEY" }[
        setup.imageProvider
      ] ?? "",
    );
  if (setup.tools.includes("x_search")) add("XAI_API_KEY");
  return names;
}

export function validateSetup(
  setup: SetupOptions,
  values: Record<string, string>,
  installed = false,
  section?: "channels" | "model" | "services",
  configured: Set<string> = new Set(),
  deferModel = false,
): Record<string, string> {
  const errors: Record<string, string> = {};
  const requireKey = (key: string, alternatives: string[] = []) => {
    if (
      key &&
      !installed &&
      ![key, ...alternatives].some((name) => values[name]?.trim() || configured.has(name))
    )
      errors[`credential-${key}`] = "Enter the API key for the selected service.";
  };
  if (!section || section === "channels") {
    if (setup.channels.includes("telegram")) {
      const token = values.TELEGRAM_BOT_TOKEN?.trim() ?? "";
      const id = values.TELEGRAM_ALLOWED_USERS?.trim() ?? "";
      if (
        (token || (!installed && !configured.has("TELEGRAM_BOT_TOKEN"))) &&
        !/^\d+:[A-Za-z0-9_-]{20,}$/.test(token)
      )
        errors["credential-TELEGRAM_BOT_TOKEN"] = "Paste the bot token provided by BotFather.";
      if (
        (id || (!installed && !configured.has("TELEGRAM_ALLOWED_USERS"))) &&
        !/^\d+(?:\s*,\s*\d+)*$/.test(id)
      )
        errors["credential-TELEGRAM_ALLOWED_USERS"] = "Enter your numeric Telegram user ID.";
    }
    if (!installed)
      for (const channel of setupCatalog.channels.filter(
        (item) => item.id !== "telegram" && setup.channels.includes(item.id),
      )) {
        for (const field of channel.fields)
          if (field.required && !values[field.name]?.trim() && !configured.has(field.name))
            errors[`credential-${field.name}`] = "Complete the required connection field.";
        const allowlists = channel.fields.filter((field) => field.name.endsWith("ALLOWED_USERS"));
        if (
          allowlists.length &&
          !allowlists.some((field) => values[field.name]?.trim() || configured.has(field.name))
        )
          errors[`credential-${allowlists[0].name}`] = "Set an allowed-user list for this channel.";
      }
  }
  if (!section || section === "model") {
    if (!setup.model.trim() && !(deferModel && setup.provider === "antigravity-oauth"))
      errors["model-name"] = "Enter the exact model ID.";
    const provider = selectedProvider(setup.provider);
    if (
      provider.authType === "api_key" &&
      setup.authMethod !== "oauth" &&
      provider.id !== "lmstudio" &&
      !(provider.id === "custom" && setup.allowUnauthenticatedModel)
    )
      requireKey(modelKey(setup));
    if (setup.provider === "custom" || setup.baseUrl) {
      try {
        const url = new URL(setup.baseUrl);
        if (
          !["http:", "https:"].includes(url.protocol) ||
          !url.hostname ||
          url.username ||
          url.password ||
          url.search ||
          url.hash
        )
          throw new Error();
      } catch {
        errors["model-base-url"] =
          "Enter an HTTP or HTTPS base URL without credentials or query parameters.";
      }
    }
    if (provider.id === "moa" && !setup.moaConfig)
      errors["model-name"] = "Configure the reference models and aggregator.";
  }
  if (!section || section === "services") {
    if (
      setup.tools.includes("tts") &&
      !(setup.ttsProvider === "xai" && setup.provider === "xai-oauth")
    )
      requireKey(
        setupCatalog.ttsProviders.find((item) => item.id === setup.ttsProvider)?.keyVar ?? "",
        setup.ttsProvider === "openai" ? ["OPENAI_API_KEY"] : [],
      );
    if (
      setup.tools.includes("stt") &&
      !(setup.sttProvider === "xai" && setup.provider === "xai-oauth")
    )
      requireKey(
        setupCatalog.sttProviders.find((item) => item.id === setup.sttProvider)?.keyVar ?? "",
        setup.sttProvider === "openai" ? ["OPENAI_API_KEY"] : [],
      );
    if (setup.tools.includes("web") && setup.searchBackend === "brave-free")
      requireKey("BRAVE_SEARCH_API_KEY");
    if (setup.tools.includes("web") && setup.extractBackend === "firecrawl")
      requireKey("FIRECRAWL_API_KEY");
    if (setup.tools.includes("image_gen"))
      requireKey(
        { fal: "FAL_KEY", replicate: "REPLICATE_API_TOKEN", openai: "OPENAI_API_KEY" }[
          setup.imageProvider
        ] ?? "",
      );
  }
  return errors;
}
