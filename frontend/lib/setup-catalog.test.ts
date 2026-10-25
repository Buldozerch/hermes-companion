import { describe, expect, it } from "vitest";
import { normalizeSetup, selectedProvider, setupCatalog } from "./setup-catalog";
import { translate } from "./i18n";

describe("setup compatibility", () => {
  it("migrates the old OpenAI ID away from the upstream OpenRouter alias", () => {
    expect(normalizeSetup({ provider: "openai" }).provider).toBe("openai-api");
    expect(selectedProvider("openai-api").keyVars).toContain("OPENAI_API_KEY");
  });
  it("migrates existing messenger/browser choices and preserves explicit empty selections", () => {
    expect(normalizeSetup({ telegram: true, browser: true }).channels).toEqual(["telegram"]);
    expect(normalizeSetup({ telegram: true, browser: true }).tools).toContain("browser");
    expect(
      normalizeSetup({ channels: [], tools: [], telegram: true, browser: true }),
    ).toMatchObject({ telegram: false, browser: false, channels: [], tools: [] });
  });
  it("keeps custom API and voice choices through workspace normalization", () => {
    const setup = normalizeSetup({
      provider: "custom",
      baseUrl: "http://localhost:11434/v1",
      apiMode: "codex_responses",
      ttsProvider: "piper",
      ttsVoice: "voice-id",
      tools: ["tts"],
    });
    expect(normalizeSetup(setup)).toEqual(setup);
  });
  it("localizes all connection field labels without translating diagnostic variable names", () => {
    for (const channel of setupCatalog.channels)
      for (const field of channel.fields) {
        if (field.label !== "WebSocket URL")
          expect(translate("ru", field.label)).not.toBe(field.label);
        expect(translate("en", field.name)).toBe(field.name);
      }
  });
});
