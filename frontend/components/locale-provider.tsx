import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { Languages } from "lucide-react";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { readLanguage, saveLanguage, translate, type Language, type Translator } from "@/lib/i18n";

interface LocaleContextValue {
  language: Language;
  setLanguage: (language: Language) => void;
  t: Translator;
  formatDate: (timestamp: number) => string;
  formatNumber: (value: number) => string;
}

const LocaleContext = createContext<LocaleContextValue | null>(null);

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [language, setLanguage] = useState<Language>(() => {
    try {
      return readLanguage(window.localStorage);
    } catch {
      return "en";
    }
  });
  const t: Translator = (message, parameters) => translate(language, message, parameters);
  useEffect(() => {
    try {
      saveLanguage(window.localStorage, language);
    } catch {
      // Some WebViews block access to localStorage itself.
    }
    document.documentElement.lang = language;
    document.title = `Hermes — ${translate(language, "Manage Hermes servers")}`;
    document
      .querySelector('meta[name="description"]')
      ?.setAttribute(
        "content",
        translate(language, "Set up and manage Hermes Agent on your own VPS."),
      );
  }, [language]);
  return (
    <LocaleContext.Provider
      value={{
        language,
        setLanguage,
        t,
        formatDate: (timestamp) =>
          new Intl.DateTimeFormat(language, { dateStyle: "short", timeStyle: "short" }).format(
            new Date(timestamp * 1000),
          ),
        formatNumber: (value) =>
          new Intl.NumberFormat(language, {
            minimumFractionDigits: 1,
            maximumFractionDigits: 1,
          }).format(value),
      }}
    >
      {children}
    </LocaleContext.Provider>
  );
}

export function useLocale(): LocaleContextValue {
  const context = useContext(LocaleContext);
  if (!context) throw new Error("useLocale must be used inside LocaleProvider.");
  return context;
}

export function LanguageSwitcher() {
  const { language, setLanguage, t } = useLocale();
  return (
    <div className="language-switcher">
      <Languages aria-hidden="true" />
      <ToggleGroup
        type="single"
        value={language}
        onValueChange={(value) => {
          if (value === "en" || value === "ru") setLanguage(value);
        }}
        variant="outline"
        size="sm"
        aria-label={t("Language")}
      >
        <ToggleGroupItem value="en" aria-label="English" title="English">
          EN
        </ToggleGroupItem>
        <ToggleGroupItem
          value="ru"
          aria-label={translate("ru", "Russian")}
          title={translate("ru", "Russian")}
        >
          RU
        </ToggleGroupItem>
      </ToggleGroup>
    </div>
  );
}
