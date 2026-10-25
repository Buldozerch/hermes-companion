import { describe, expect, it } from "vitest";
import { baseTools, normalizeSetup, providers } from "./setup-catalog";
import { activeCredentialNames, validateSetup } from "./setup-services";

const telegram = {
  TELEGRAM_BOT_TOKEN: "123456789:AA_test_token_12345678901234567890",
  TELEGRAM_ALLOWED_USERS: "123456789",
};
describe("guided installation requirements", () => {
  it("starts with all core capabilities and independent free service defaults", () => {
    const setup = normalizeSetup({});
    expect(baseTools).toEqual(
      expect.arrayContaining([
        "terminal",
        "file",
        "code_execution",
        "memory",
        "web",
        "browser",
        "delegation",
      ]),
    );
    expect(setup.tools).toEqual(expect.arrayContaining([...baseTools, "tts", "stt"]));
    expect(setup).toMatchObject({
      ttsProvider: "edge",
      sttProvider: "groq",
      searchBackend: "ddgs",
      extractBackend: "builtin",
    });
  });
  it("requires Telegram token and a numeric owner ID before the model step", () => {
    const setup = normalizeSetup({ channels: ["telegram"] });
    expect(Object.keys(validateSetup(setup, {}, false, "channels"))).toHaveLength(2);
    expect(validateSetup(setup, telegram, false, "channels")).toEqual({});
    expect(
      validateSetup(setup, { ...telegram, TELEGRAM_ALLOWED_USERS: "@user" }, false, "channels"),
    ).toHaveProperty("credential-TELEGRAM_ALLOWED_USERS");
  });
  it("requires model and Groq keys while keyless services need no dummy credentials", () => {
    const setup = normalizeSetup({ channels: ["telegram"] });
    expect(validateSetup(setup, telegram)).toHaveProperty("credential-OPENROUTER_API_KEY");
    expect(
      validateSetup(setup, { ...telegram, OPENROUTER_API_KEY: "test", GROQ_API_KEY: "test" }),
    ).toEqual({});
  });
  it("requires a custom gateway key unless keyless access was explicitly selected", () => {
    const setup = normalizeSetup({
      provider: "custom",
      baseUrl: "http://localhost:8000/v1",
      model: "gateway/model",
    });
    expect(validateSetup(setup, {}, false, "model")).toHaveProperty(
      "credential-COMPANION_CUSTOM_API_KEY",
    );
    expect(
      validateSetup({ ...setup, allowUnauthenticatedModel: true }, {}, false, "model"),
    ).toEqual({});
  });
  it("does not accept an OpenAI model key in place of an ElevenLabs key", () => {
    const setup = normalizeSetup({ ttsProvider: "elevenlabs", tools: ["tts"] });
    expect(
      validateSetup(setup, { OPENAI_API_KEY: "other-service" }, false, "services"),
    ).toHaveProperty("credential-ELEVENLABS_API_KEY");
  });
  it("validates each selected paid service separately", () => {
    const setup = normalizeSetup({
      tools: ["web", "image_gen"],
      searchBackend: "brave-free",
      extractBackend: "firecrawl",
      imageProvider: "replicate",
    });
    expect(Object.keys(validateSetup(setup, {}, false, "services"))).toEqual([
      "credential-BRAVE_SEARCH_API_KEY",
      "credential-FIRECRAWL_API_KEY",
      "credential-REPLICATE_API_TOKEN",
    ]);
  });
  it("does not transmit abandoned paid-service credentials after selecting free alternatives", () => {
    const names = activeCredentialNames(normalizeSetup({ channels: ["telegram"] }));
    expect(names.has("GROQ_API_KEY")).toBe(true);
    for (const key of [
      "FIRECRAWL_API_KEY",
      "BRAVE_SEARCH_API_KEY",
      "ELEVENLABS_API_KEY",
      "REPLICATE_API_TOKEN",
    ])
      expect(names.has(key)).toBe(false);
  });
  it("preserves all 53 native providers and defers OAuth authorization until installation", () => {
    expect(providers).toHaveLength(54);
    expect(providers.find((item) => item.id === "antigravity-oauth")?.authType).toBe(
      "external_process",
    );
    const setup = normalizeSetup({ provider: "openai-codex", model: "test-model" });
    expect(validateSetup(setup, {}, false, "model")).toEqual({});
  });
  it("defers the Antigravity model only in the initial installation wizard", () => {
    const setup = normalizeSetup({ provider: "antigravity-oauth", model: "", channels: [] });
    expect(setup.authMethod).toBe("oauth");
    expect(validateSetup(setup, {}, false, "model", new Set(), true)).toEqual({});
    expect(validateSetup(setup, {}, false, "model")).toHaveProperty("model-name");
  });
});
