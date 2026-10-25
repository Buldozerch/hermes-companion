import { describe, expect, it } from "vitest";
import russian from "@/locales/ru.json";
import { englishMessage, localeStorageKey, readLanguage, saveLanguage, translate } from "./i18n";
import { errorMessage, serverSchema } from "./validation";

describe("language selection", () => {
  it.each([null, "en", "unknown", "RU"])("defaults to English for %s", (value) => {
    expect(readLanguage({ getItem: () => value })).toBe("en");
  });

  it("restores and saves an explicit Russian preference", () => {
    const storage = new Map<string, string>([[localeStorageKey, "ru"]]);
    expect(readLanguage({ getItem: (key) => storage.get(key) ?? null })).toBe("ru");
    saveLanguage({ setItem: (key, value) => storage.set(key, value) }, "en");
    expect(storage.get(localeStorageKey)).toBe("en");
  });

  it("supports blocked storage", () => {
    const fail = () => {
      throw new Error("Storage access denied");
    };
    expect(readLanguage({ getItem: fail })).toBe("en");
    expect(() => saveLanguage({ setItem: fail }, "ru")).not.toThrow();
  });
});

describe("localized UI and English diagnostics", () => {
  it("uses English source messages and translates Russian labels", () => {
    expect(translate("en", "Add server")).toBe("Add server");
    expect(translate("ru", "Add server")).toBe(russian["Add server"]);
    expect(translate("ru", "Unknown diagnostic: EOF")).toBe("Unknown diagnostic: EOF");
    expect(translate("ru", "constructor")).toBe("constructor");
  });

  it("interpolates values without interpreting their content", () => {
    const name = "<vps> {step} $&";
    expect(translate("en", "Remove profile “{name}”?", { name })).toBe(`Remove profile “${name}”?`);
    expect(translate("ru", "Step {step} of {total}", { step: 2, total: 5 })).toBe(
      russian["Step {step} of {total}"].replace("{step}", "2").replace("{total}", "5"),
    );
  });

  it("preserves all interpolation parameters in the Russian catalog", () => {
    const parameters = (message: string) =>
      [...message.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
    for (const [english, localized] of Object.entries(russian)) {
      expect(localized.trim(), english).not.toBe("");
      expect(parameters(localized), english).toEqual(parameters(english));
    }
  });

  it("keeps recorded diagnostics in English while translating inline guidance", () => {
    const message = "The server rejected authentication. Check the username, password or SSH key.";
    const error = { code: "authentication", message };
    expect(errorMessage(error)).toBe(message);
    expect(errorMessage(error, (text) => translate("ru", text))).toBe(russian[message]);
    expect(error.message).toBe(message);
    expect(englishMessage(russian[message])).toBe(message);
    expect(englishMessage("SSH: handshake failed (EOF)")).toBe("SSH: handshake failed (EOF)");
  });

  it("retains validation messages as English source text", () => {
    const result = serverSchema.safeParse({
      name: "VPS",
      host: "",
      port: Number.NaN,
      username: "root",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((issue) => issue.message)).toEqual([
        "Enter the server IP address",
        "Enter an IP address or domain without https:// or spaces",
        "The port must be a whole number",
      ]);
    }
  });
});
