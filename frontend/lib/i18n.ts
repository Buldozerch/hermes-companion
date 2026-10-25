import russian from "@/locales/ru.json";

export type Language = "en" | "ru";
export type Parameters = Record<string, string | number>;
export type Translator = (message: string, parameters?: Parameters) => string;
export const localeStorageKey = "hermes-companion.locale";

const translations: Record<string, string> = russian;
const legacyMessages = new Map(
  Object.entries(translations).map(([english, localized]) => [localized, english]),
);

// Normalize messages saved by older releases without translating user data.
export function englishMessage(message: string): string {
  return legacyMessages.get(message) ?? message;
}

export function translate(
  language: Language,
  message: string,
  parameters: Parameters = {},
): string {
  const template =
    language === "ru" && Object.hasOwn(translations, message) ? translations[message] : message;
  return template.replace(/\{(\w+)\}/g, (placeholder, key: string) =>
    Object.hasOwn(parameters, key) ? String(parameters[key]) : placeholder,
  );
}

export function readLanguage(storage: Pick<Storage, "getItem">): Language {
  try {
    return storage.getItem(localeStorageKey) === "ru" ? "ru" : "en";
  } catch {
    return "en";
  }
}

export function saveLanguage(storage: Pick<Storage, "setItem">, language: Language): void {
  try {
    storage.setItem(localeStorageKey, language);
  } catch {
    // Language switching must also work when persistent storage is unavailable.
  }
}
