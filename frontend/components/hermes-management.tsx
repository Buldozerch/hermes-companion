import { useEffect, useRef, useState } from "react";
import { Check, RefreshCw, Save } from "lucide-react";
import { useLocale } from "./locale-provider";
import { SavedCredentialsProvider, useSetupCredentials } from "./setup-credentials";
import { SetupModel } from "./setup-model";
import { SetupChannel } from "./setup-channel";
import { SetupServices } from "./setup-services";
import { ManagedTools } from "./managed-tools";
import { DeploymentPanel } from "./deployment-panel";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { ToggleGroup, ToggleGroupItem } from "./ui/toggle-group";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "./ui/accordion";
import { Busy, Notice } from "./shared";
import { api } from "@/lib/api";
import { normalizeSetup, selectedProvider, usesBrowserAuth } from "@/lib/setup-catalog";
import { activeCredentialNames, validateSetup } from "@/lib/setup-services";
import {
  availableCredentials,
  settingsChanges,
  settingsSections,
  validateManagedSettings,
} from "@/lib/managed-settings";
import { errorMessage } from "@/lib/validation";
import type {
  DeploymentStatus,
  Server,
  SettingsSection,
  SettingsSnapshot,
  SetupOptions,
} from "@/lib/types";

export function HermesManagement({
  server,
  connected,
  status,
  onConnect,
  onSetup,
  onStatus,
}: {
  server: Server;
  connected: boolean;
  status?: DeploymentStatus;
  onConnect: () => void;
  onSetup: () => void;
  onStatus: (status: DeploymentStatus) => void;
}) {
  const { t } = useLocale();
  const credentials = useSetupCredentials(server.id);
  const [snapshot, setSnapshot] = useState<SettingsSnapshot | null>(null);
  const [setup, setSetup] = useState<SetupOptions>(() => normalizeSetup(server.setup));
  const [section, setSection] = useState<SettingsSection>("model");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, setPending] = useState<string | null>(null);
  const preparingProvider = useRef(false);
  const [saved, setSaved] = useState(false);
  const [linkedProvider, setLinkedProvider] = useState<string | null>(null);
  const [resetKey, setResetKey] = useState(0);
  const [showStatus, setShowStatus] = useState(false);
  const request = useRef(0);
  const wasRunning = useRef(false);
  const installed = !!status?.managed && !!status.installedVersion;
  const running = status?.state === "starting" || status?.state === "running";
  useEffect(() => {
    if (running) setShowStatus(true);
  }, [running]);
  const changes = snapshot
    ? settingsChanges(setup, snapshot.setup, credentials.values)
    : { count: 0, sections: [] };
  if (linkedProvider === setup.provider && usesBrowserAuth(setup)) {
    changes.count++;
    if (!changes.sections.includes("model")) changes.sections.push("model");
  }
  const available = snapshot ? availableCredentials(setup, snapshot) : new Set<string>();
  const blocked = busy || running || !!pending || !connected;
  useEffect(() => {
    const finished = wasRunning.current && !running;
    wasRunning.current = running;
    if (finished && !pending && snapshot && connected) {
      if (changes.count)
        setError(
          new Error("The server settings changed. Reload them before applying your changes."),
        );
      else void reload();
    }
  }, [running]);

  async function reload(keepDraft = false) {
    const current = ++request.current;
    setBusy(true);
    setError(null);
    try {
      const next = await api.readSettings(server.id);
      if (current !== request.current) return;
      next.setup = normalizeSetup(next.setup);
      setSnapshot(next);
      if (!keepDraft) {
        setSetup(next.setup);
        setLinkedProvider(null);
        setResetKey((value) => value + 1);
        credentials.clear();
      }
      setErrors({});
    } catch (error) {
      if (current === request.current) setError(error);
    } finally {
      if (current === request.current) setBusy(false);
    }
  }
  useEffect(() => {
    if (connected && installed) void reload();
    return () => {
      request.current++;
    };
  }, [server.id, connected, installed]);
  useEffect(() => {
    if (!pending || status?.jobId !== pending || running) return;
    setPending(null);
    if (status.state === "succeeded") {
      setSaved(!preparingProvider.current);
      void reload(preparingProvider.current);
      preparingProvider.current = false;
    } else {
      setError(
        new Error(
          "The settings operation failed. Open service status and logs for details, then reload the server settings before retrying.",
        ),
      );
    }
  }, [pending, status?.jobId, status?.state]);
  useEffect(() => {
    if (!changes.count) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [changes.count]);

  function change(patch: Partial<SetupOptions>) {
    setSetup((current) => normalizeSetup({ ...current, ...patch }));
    setErrors({});
    setSaved(false);
  }
  function discard() {
    if (!snapshot) return;
    setSetup(snapshot.setup);
    setLinkedProvider(null);
    setResetKey((value) => value + 1);
    credentials.clear();
    setErrors({});
    setError(null);
    setSaved(false);
  }
  async function apply() {
    if (!snapshot || blocked || !changes.count) return;
    const nextErrors = validateManagedSettings(
      setup,
      snapshot.setup,
      credentials.values,
      available,
      changes.sections,
      snapshot.authorizedProviders ?? [],
    );
    setErrors(nextErrors);
    const id = Object.keys(nextErrors)[0];
    if (id) {
      const modelErrors = validateSetup(setup, credentials.values, false, "model", available);
      const channelErrors = validateSetup(setup, credentials.values, false, "channels", available);
      setSection(
        id === "model-auth" || modelErrors[id]
          ? "model"
          : channelErrors[id]
            ? "channels"
            : "services",
      );
      requestAnimationFrame(() => {
        document.getElementById(id)?.focus();
        document.getElementById(id)?.scrollIntoView({ block: "center" });
      });
      return;
    }
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const active = activeCredentialNames(setup);
      const result = await api.applySettings(
        server.id,
        { setup, sections: changes.sections, revision: snapshot.revision },
        {
          apiKey: "",
          telegramToken: "",
          telegramAllowedUsers: "",
          values: Object.entries(credentials.values)
            .filter(([name, value]) => active.has(name) && value.trim())
            .map(([name, value]) => ({ name, value: value.trim() })),
        },
      );
      setPending(result.jobId);
      setShowStatus(true);
      onStatus(result);
      credentials.clear();
    } catch (error) {
      setError(error);
    } finally {
      setBusy(false);
    }
  }

  async function authorized() {
    setBusy(true);
    try {
      const current = await api.readSettings(server.id);
      if (!snapshot || current.revision !== snapshot.revision)
        throw new Error("The server settings changed. Reload them before applying your changes.");
      setSnapshot({
        ...snapshot,
        configuredCredentials: current.configuredCredentials,
        authorizedProviders: current.authorizedProviders,
        modelConfigured: current.modelConfigured,
      });
      setLinkedProvider(setup.provider);
      setErrors({});
    } finally {
      setBusy(false);
    }
  }

  if (!connected)
    return (
      <Notice title="Connect to edit settings">
        <p>{t("Connect to this server to load its current Hermes configuration.")}</p>
        <Button onClick={onConnect}>{t("Connect to server")}</Button>
      </Notice>
    );
  if (!status) return <Busy>{t("Checking server…")}</Busy>;
  if (!installed)
    return (
      <div>
        <Notice title="Hermes setup is not complete">
          <p>
            {t(
              running
                ? "Installation is running. Open its progress to follow the remaining steps."
                : "Install Hermes before managing its settings.",
            )}
          </p>
          <Button onClick={onSetup}>
            {t(running ? "Show progress" : "Continue installation")}
          </Button>
        </Notice>
      </div>
    );
  return (
    <div className="hermes-management">
      <header className="management-heading">
        <div>
          <h2>{server.name}</h2>
          <p>{t("Current configuration from your server")}</p>
        </div>
        <Badge variant="outline">
          {t(
            running || pending
              ? status.operation === "provider"
                ? "Preparing provider…"
                : "Applying settings"
              : status.serviceActive
                ? "Running"
                : "Stopped",
          )}
        </Badge>
        <Button
          variant="outline"
          size="sm"
          disabled={busy || running || !!pending || (!!changes.count && !error)}
          onClick={() => {
            setSaved(false);
            void reload();
          }}
        >
          <RefreshCw data-icon="inline-start" />
          {t(changes.count && error ? "Discard changes and reload" : "Reload from server")}
        </Button>
      </header>
      {!!error && (
        <Notice error title="Could not update settings">
          <span lang="en" translate="no">
            {errorMessage(error)}
          </span>
        </Notice>
      )}
      {!snapshot ? (
        busy ? (
          <Busy>{t("Loading server settings…")}</Busy>
        ) : null
      ) : (
        <>
          <dl className="management-summary">
            <div>
              <dt>{t("Provider")}</dt>
              <dd>{selectedProvider(snapshot.setup.provider).name}</dd>
            </div>
            <div>
              <dt>{t("Model ID")}</dt>
              <dd translate="no">{snapshot.setup.model}</dd>
            </div>
            <div>
              <dt>{t("Version")}</dt>
              <dd>{status.installedVersion}</dd>
            </div>
          </dl>
          {snapshot.warnings.map((warning) => (
            <Notice key={warning} title="Custom server settings">
              <span>{t(warning)}</span>
            </Notice>
          ))}
          <ToggleGroup
            type="single"
            variant="outline"
            className="management-tabs"
            value={section}
            onValueChange={(value) => {
              if (value) setSection(value as SettingsSection);
            }}
            aria-label={t("Hermes settings sections")}
          >
            {settingsSections.map(({ id, label }) => (
              <ToggleGroupItem key={id} value={id} aria-label={t(label)}>
                {t(label)}
                {changes.sections.includes(id) && (
                  <span aria-hidden="true" title={t("Unsaved changes")}>
                    *
                  </span>
                )}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          <SavedCredentialsProvider key={resetKey} configured={available}>
            <form
              noValidate
              onSubmit={(event) => {
                event.preventDefault();
                void apply();
              }}
            >
              <fieldset disabled={blocked} className="management-content">
                {section === "model" && (
                  <SetupModel
                    setup={setup}
                    change={change}
                    server={{ ...server, setup: snapshot.setup }}
                    installed
                    modelConfigured={snapshot.modelConfigured}
                    errors={errors}
                    authDisabled={blocked}
                    onAuthorized={authorized}
                    authorizedProviders={snapshot.authorizedProviders ?? []}
                    preparedProviders={snapshot.preparedProviders ?? []}
                    onPreparing={(result) => {
                      preparingProvider.current = true;
                      setPending(result.jobId);
                      setShowStatus(true);
                      onStatus(result);
                    }}
                  />
                )}
                {section === "channels" && (
                  <SetupChannel
                    setup={setup}
                    change={change}
                    serverId={server.id}
                    installed
                    errors={errors}
                    management
                  />
                )}
                {section === "services" && (
                  <SetupServices
                    setup={setup}
                    change={change}
                    serverId={server.id}
                    installed
                    errors={errors}
                    management
                  />
                )}
                {section === "tools" && (
                  <ManagedTools setup={setup} change={change} serverId={server.id} />
                )}
              </fieldset>
              {Object.keys(errors).length > 0 && (
                <p role="alert" className="setup-validation-summary">
                  {t("Complete the highlighted fields before continuing.")}
                </p>
              )}
              {saved && (
                <p role="status" className="saved-message">
                  <Check />
                  {t("Changes applied. The Hermes service is healthy.")}
                </p>
              )}
              <footer className="management-save-bar">
                <div>
                  <strong>
                    {t(changes.count ? "Changed settings: {count}" : "No unsaved changes", {
                      count: changes.count,
                    })}
                  </strong>
                  <p>
                    {t(
                      "Applying changes restarts Hermes briefly. Existing keys stay on the server.",
                    )}
                  </p>
                </div>
                <div className="setup-footer-actions">
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={blocked || !changes.count}
                    onClick={discard}
                  >
                    {t("Discard changes")}
                  </Button>
                  <Button type="submit" disabled={blocked || !changes.count}>
                    {blocked ? (
                      <Busy>{t("Please wait…")}</Busy>
                    ) : (
                      <>
                        <Save data-icon="inline-start" />
                        {t("Apply changes")}
                      </>
                    )}
                  </Button>
                </div>
              </footer>
            </form>
          </SavedCredentialsProvider>
        </>
      )}
      <Accordion
        type="single"
        collapsible
        value={showStatus ? "status" : ""}
        onValueChange={(value) => setShowStatus(!!value)}
      >
        <AccordionItem value="status">
          <AccordionTrigger>{t("Service status and logs")}</AccordionTrigger>
          <AccordionContent>
            <DeploymentPanel
              server={{ ...server, setup: snapshot?.setup ?? server.setup }}
              connected={connected}
              showProviderSignIn={false}
              title="Service status"
            />
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </div>
  );
}
