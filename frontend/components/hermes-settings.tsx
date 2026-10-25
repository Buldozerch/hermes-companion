import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Bot,
  Check,
  Download,
  MessageCircle,
  Settings2,
} from "lucide-react";
import { useLocale } from "@/components/locale-provider";
import { useSetupCredentials } from "@/components/setup-credentials";
import { SetupChannel } from "@/components/setup-channel";
import { SetupModel } from "@/components/setup-model";
import { SetupServices } from "@/components/setup-services";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Busy, Notice } from "@/components/shared";
import { api, desktop } from "@/lib/api";
import { normalizeSetup } from "@/lib/setup-catalog";
import { activeCredentialNames, validateSetup } from "@/lib/setup-services";
import { errorMessage } from "@/lib/validation";
import type { Server, SetupOptions } from "@/lib/types";

const sections = [
  { id: "channels", label: "Communication", icon: MessageCircle },
  { id: "model", label: "Agent brain", icon: Bot },
  { id: "services", label: "Services and voice", icon: Settings2 },
] as const;
type Section = (typeof sections)[number]["id"];

export function ModelSettings({
  server,
  onSaved,
  onBack,
  wizard = false,
}: {
  server: Server;
  onSaved: (started?: boolean) => Promise<void>;
  onBack?: () => void;
  wizard?: boolean;
}) {
  const { t } = useLocale();
  const [setup, setSetup] = useState<SetupOptions>(() => normalizeSetup(server.setup));
  const [section, setSection] = useState<Section>("channels");
  const [reached, setReached] = useState(wizard ? 0 : 2);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [operationError, setOperationError] = useState<unknown>(null);
  const [saved, setSaved] = useState<"draft" | "apply" | null>(null);
  const [installed, setInstalled] = useState(false);
  const [modelConfigured, setModelConfigured] = useState(false);
  const credentials = useSetupCredentials(server.id);
  const root = useRef<HTMLDivElement>(null);
  const previousSection = useRef<Section>(section);
  useEffect(() => {
    if (previousSection.current !== section && Object.keys(errors).length === 0) {
      const heading = root.current?.querySelector<HTMLHeadingElement>(".setup-section-intro h3");
      heading?.setAttribute("tabindex", "-1");
      heading?.focus({ preventScroll: true });
    }
    previousSection.current = section;
  }, [section, errors]);
  const index = sections.findIndex((item) => item.id === section);
  useEffect(() => {
    let active = true;
    if (desktop)
      void api
        .deployment(server.id)
        .then((status) => {
          if (active) {
            setInstalled(status.managed && !!status.installedVersion);
            setModelConfigured(status.modelConfigured);
          }
        })
        .catch(() => {});
    return () => {
      active = false;
    };
  }, [server.id]);
  function change(patch: Partial<SetupOptions>) {
    setSetup((previous) => normalizeSetup({ ...previous, ...patch }));
    setSaved(null);
    setErrors({});
    setOperationError(null);
  }
  function showErrors(next: Record<string, string>) {
    setErrors(next);
    const id = Object.keys(next)[0];
    if (!id) return false;
    const target =
      id === "credential-TELEGRAM_BOT_TOKEN" ||
      id === "credential-TELEGRAM_ALLOWED_USERS" ||
      setup.channels.some((channel) => id.includes(channel.toUpperCase()))
        ? "channels"
        : id.startsWith("model-") ||
            id === `credential-${setup.credentialEnv}` ||
            validateSetup(setup, credentials.values, installed, "model")[id]
          ? "model"
          : "services";
    setSection(target);
    setReached((previous) =>
      Math.max(
        previous,
        sections.findIndex((item) => item.id === target),
      ),
    );
    requestAnimationFrame(() => {
      const control = document.getElementById(id);
      control?.focus();
      control?.scrollIntoView({ block: "center", behavior: "instant" });
    });
    return true;
  }
  function next() {
    if (
      showErrors(
        validateSetup(setup, credentials.values, installed, section, new Set(), !installed),
      )
    )
      return;
    setSection(sections[index + 1].id);
    setReached((previous) => Math.max(previous, index + 1));
    root.current?.scrollIntoView({ block: "start", behavior: "instant" });
  }
  async function save(install: boolean) {
    if (
      install &&
      showErrors(
        validateSetup(setup, credentials.values, installed, undefined, new Set(), !installed),
      )
    )
      return;
    setBusy(true);
    setOperationError(null);
    setSaved(null);
    try {
      await api.saveSetup(server.id, setup);
      if (install) {
        const secrets = {
          apiKey: "",
          telegramToken: "",
          telegramAllowedUsers: "",
          values: Object.entries(credentials.values)
            .filter(([name]) => activeCredentialNames(setup).has(name))
            .map(([name, value]) => ({
              name,
              value: value.trim(),
            })),
        };
        if (installed) await api.applySetup(server.id, secrets);
        else await api.install(server.id, secrets);
        credentials.clear();
        setSaved("apply");
      } else setSaved("draft");
      await onSaved(install);
    } catch (error) {
      setOperationError(error);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="hermes-settings setup-master" ref={root}>
      <div className="panel-heading">
        <span className="step-counter">{t("Configure Hermes")}</span>
        <h2>{t("Make Hermes yours")}</h2>
        <p>{t("Connect Telegram, choose a model, then add the services you want.")}</p>
      </div>
      <ToggleGroup
        type="single"
        value={section}
        onValueChange={(value) => {
          if (sections.some((item) => item.id === value)) setSection(value as Section);
        }}
        variant="outline"
        className="setup-step-tabs"
        aria-label={t("Configuration steps")}
      >
        {sections.map((item, i) => (
          <ToggleGroupItem
            key={item.id}
            value={item.id}
            disabled={i > reached || busy}
            aria-label={t(item.label)}
          >
            <span className="setup-step-number">{i < index ? <Check /> : i + 1}</span>
            <item.icon />
            <span>{t(item.label)}</span>
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          if (index < 2) next();
          else void save(true);
        }}
      >
        <fieldset disabled={busy} className="setup-step-content">
          {section === "channels" && (
            <SetupChannel
              setup={setup}
              change={change}
              serverId={server.id}
              installed={installed}
              errors={errors}
            />
          )}
          {section === "model" && (
            <SetupModel
              setup={setup}
              change={change}
              server={server}
              installed={installed}
              modelConfigured={modelConfigured}
              errors={errors}
            />
          )}
          {section === "services" && (
            <SetupServices
              setup={setup}
              change={change}
              serverId={server.id}
              installed={installed}
              errors={errors}
            />
          )}
        </fieldset>
        {Object.keys(errors).length > 0 && (
          <p className="setup-validation-summary" role="alert">
            {t("Complete the highlighted fields before continuing.")}
          </p>
        )}
        {!!operationError && (
          <Notice error title="Could not complete setup">
            <span lang="en" translate="no">
              {errorMessage(operationError)}
            </span>
          </Notice>
        )}
        {saved && (
          <p role="status" className="saved-message">
            <Check />
            {t(
              saved === "draft"
                ? "Settings draft saved"
                : installed
                  ? "Settings are being applied on the server. Open the server panel to follow progress."
                  : "Installation started. You can follow progress in the server panel.",
            )}
          </p>
        )}
        {index === 2 && !installed && (
          <p className="setup-secondary setup-install-disclosure">
            {t(
              "Installs the latest stable Hermes release, prepares Ubuntu packages, creates the hermes account and enables a background service.",
            )}
          </p>
        )}
        <footer className="form-footer setup-master-footer">
          <div>
            {index > 0 ? (
              <Button
                type="button"
                variant="ghost"
                disabled={busy}
                onClick={() => setSection(sections[index - 1].id)}
              >
                <ArrowLeft />
                {t("Back")}
              </Button>
            ) : (
              onBack && (
                <Button type="button" variant="ghost" disabled={busy} onClick={onBack}>
                  <ArrowLeft />
                  {t("Back")}
                </Button>
              )
            )}
          </div>
          <div className="setup-footer-actions">
            <Button type="button" variant="ghost" disabled={busy} onClick={() => void save(false)}>
              {t("Save draft")}
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? (
                <Busy>{t("Preparing…")}</Busy>
              ) : (
                <>
                  {index === 2 ? <Download /> : null}
                  {t(
                    index === 0
                      ? "Continue to model"
                      : index === 1
                        ? "Continue to services"
                        : installed
                          ? "Apply to server"
                          : "Finish setup and install",
                  )}
                  {index < 2 && <ArrowRight />}
                </>
              )}
            </Button>
          </div>
        </footer>
      </form>
    </div>
  );
}
