import { describe, expect, it } from "vitest";
import { normalizeSetup } from "./setup-catalog";
import {
  availableCredentials,
  hermesInstalled,
  serverAction,
  settingsChanges,
  validateManagedSettings,
} from "./managed-settings";
import type { DeploymentStatus } from "./types";

const baseline = normalizeSetup({
  provider: "openrouter",
  model: "server-model",
  channels: ["telegram"],
  tools: ["file", "memory", "web", "tts"],
  ttsProvider: "edge",
});
describe("installed Hermes management", () => {
  it("requires browser authorization before applying an OAuth provider", () => {
    const setup = normalizeSetup({ ...baseline, provider: "anthropic", authMethod: "oauth" });
    expect(validateManagedSettings(setup, baseline, {}, new Set(), ["model"])).toHaveProperty(
      "model-auth",
    );
    expect(
      validateManagedSettings(setup, baseline, {}, new Set(), ["model"], ["anthropic"]),
    ).toEqual({});
  });
  it("excludes abandoned API keys when the provider uses OAuth", () => {
    const setup = normalizeSetup({ ...baseline, provider: "anthropic", authMethod: "oauth" });
    expect(settingsChanges(setup, setup, { ANTHROPIC_API_KEY: "unused-private-key" }).count).toBe(
      0,
    );
  });
  it("maps a ChatGPT subscription to the native Codex account provider", () => {
    expect(normalizeSetup({ provider: "openai-codex" }).authMethod).toBe("oauth");
    expect(normalizeSetup({ provider: "openai-api" }).authMethod).toBe("api_key");
  });
  it("ignores ordering and distinguishes settings from replacement keys", () => {
    expect(
      settingsChanges({ ...baseline, tools: [...baseline.tools].reverse() }, baseline, {}),
    ).toEqual({ count: 0, sections: [] });
    expect(
      settingsChanges(baseline, baseline, { OPENROUTER_API_KEY: "replacement-key" }).sections,
    ).toEqual(["model"]);
    expect(settingsChanges(baseline, baseline, { ELEVENLABS_API_KEY: "unused-key" }).count).toBe(0);
  });
  it("does not require messenger credentials while changing the model", () => {
    expect(
      validateManagedSettings(
        { ...baseline, model: "other-model" },
        baseline,
        {},
        new Set(["OPENROUTER_API_KEY"]),
        ["model"],
      ),
    ).toEqual({});
  });
  it("requires the new provider key, without treating the old key as interchangeable", () => {
    expect(
      validateManagedSettings(
        { ...baseline, provider: "deepseek" },
        baseline,
        {},
        new Set(["OPENROUTER_API_KEY"]),
        ["model"],
      ),
    ).toHaveProperty("credential-DEEPSEEK_API_KEY");
  });
  it("reuses messenger credentials by presence and validates replacements", () => {
    const available = new Set(["TELEGRAM_BOT_TOKEN", "TELEGRAM_ALLOWED_USERS"]);
    expect(validateManagedSettings(baseline, baseline, {}, available, ["channels"])).toEqual({});
    expect(
      validateManagedSettings(baseline, baseline, { TELEGRAM_ALLOWED_USERS: "@name" }, available, [
        "channels",
      ]),
    ).toHaveProperty("credential-TELEGRAM_ALLOWED_USERS");
  });
  it("requires a key when a paid service is enabled", () => {
    expect(
      validateManagedSettings(
        { ...baseline, tools: [...baseline.tools, "stt"] },
        baseline,
        {},
        new Set(),
        ["tools"],
      ),
    ).toHaveProperty("credential-GROQ_API_KEY");
  });
  it("does not require unrelated service keys when a tool is disabled", () => {
    const current = { ...baseline, sttProvider: "groq", tools: [...baseline.tools, "stt"] };
    expect(
      validateManagedSettings(
        { ...current, tools: current.tools.filter((tool) => tool !== "memory") },
        current,
        {},
        new Set(),
        ["tools"],
      ),
    ).toEqual({});
  });
  it("does not reuse a custom endpoint key at a new endpoint", () => {
    const original = { ...baseline, provider: "custom", baseUrl: "http://localhost:8000/v1" };
    expect(
      availableCredentials(
        { ...original, baseUrl: "http://localhost:9000/v1" },
        { setup: original, configuredCredentials: ["COMPANION_CUSTOM_API_KEY"] },
      ).has("COMPANION_CUSTOM_API_KEY"),
    ).toBe(false);
  });
  it("routes card actions by installation status and SSH connectivity", () => {
    const installed = {
      managed: true,
      installedVersion: "v1.2.3",
      serviceInstalled: true,
      state: "succeeded",
    } as DeploymentStatus;
    expect(serverAction(false, installed)).toBe("Connect to server");
    expect(serverAction(true, installed)).toBe("Manage Hermes");
    expect(hermesInstalled({ ...installed, serviceInstalled: false })).toBe(false);
    expect(serverAction(true, { ...installed, serviceInstalled: false, state: "failed" })).toBe(
      "Continue installation",
    );
    expect(serverAction(true, { ...installed, state: "running" })).toBe("Show progress");
    expect(
      serverAction(true, { ...installed, managed: false, installedVersion: null, state: "none" }),
    ).toBe("Continue installation");
  });
});
