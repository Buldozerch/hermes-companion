import { useEffect, useRef, useState } from "react";
import { ArrowRight, Check, FileText, RefreshCw, Save } from "lucide-react";
import { useLocale } from "./locale-provider";
import { SavedCredentialsProvider, useSetupCredentials } from "./setup-credentials";
import { SetupModel } from "./setup-model";
import { SetupChannel } from "./setup-channel";
import { SetupServices } from "./setup-services";
import { ManagedTools } from "./managed-tools";
import { ServerOperationDrawer } from "./server-operation-drawer";
import { HermesUpdater } from "./hermes-updater";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { ToggleGroup, ToggleGroupItem } from "./ui/toggle-group";
import { Busy, Notice } from "./shared";
import { api } from "@/lib/api";
import { normalizeSetup, selectedProvider, usesBrowserAuth } from "@/lib/setup-catalog";
import { activeCredentialNames, validateSetup } from "@/lib/setup-services";
import {
  availableCredentials,
  hermesInstalled,
  settingsChanges,
  settingsSections,
  validateManagedSettings,
} from "@/lib/managed-settings";
import { advanceOnboarding, initialOnboarding } from "@/lib/onboarding";
import { errorMessage } from "@/lib/validation";
import type {
  DeploymentStatus,
  Server,
  SettingsSection,
  SettingsSnapshot,
  SetupOptions,
  OnboardingProgress,
  SettingsNavigation,
} from "@/lib/types";

export function HermesManagement({
  server,
  connected,
  status,
  onConnect,
  onSetup,
  onStatus,
  section,
  onSectionChange,
  onNavigation,
}: {
  server: Server;
  connected: boolean;
  status?: DeploymentStatus;
  onConnect: () => void;
  onSetup: () => void;
  onStatus: (status: DeploymentStatus) => void;
  section: SettingsSection;
  onSectionChange: (section: SettingsSection) => void;
  onNavigation: (state: SettingsNavigation | null) => void;
}) {
  const { t } = useLocale();
  const credentials = useSetupCredentials(server.id);
  const [snapshot, setSnapshot] = useState<SettingsSnapshot | null>(null);
  const [setup, setSetup] = useState<SetupOptions>(() => normalizeSetup(server.setup));
  const [progress, setProgress] = useState<OnboardingProgress | null>(null);
  const loadedWalkthrough = useRef(false);
  const [finishedNow, setFinishedNow] = useState(false);
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
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const wasRunning = useRef(false);
  const installed = hermesInstalled(status);
  const running = status?.state === "starting" || status?.state === "running";
  useEffect(() => {
    if (running) setShowStatus(true);
    else if (wasRunning.current && status?.state === "succeeded" && !pending) setShowStatus(false);
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
  const confirmedSaved = saved && !changes.count && !!status?.apiHealthy && status.serviceActive;
  useEffect(() => {
    if (changes.count) setSaved(false);
  }, [changes.count]);
  const guided = !!progress && !progress.finished;
  useEffect(() => {
    if (status?.state === "failed" || status?.state === "interrupted") setShowStatus(true);
  }, [status?.jobId, status?.state]);
  useEffect(() => {
    if (!pending || !status || !snapshot || running || status.jobId === pending) return;
    setPending(null);
    setSaved(false);
    setError(
      new Error(
        "A different server operation replaced the pending walkthrough job. Reload settings before continuing.",
      ),
    );
    setShowStatus(true);
    if (progress?.pending) void persistProgress({ ...progress, pending: null }).catch(setError);
  }, [pending, status?.jobId, running, !!snapshot]);
  useEffect(() => {
    onNavigation({
      serverId: server.id,
      dirty: changes.sections,
      completed: progress?.completed ?? [],
      skipped: progress?.skipped ?? [],
      blocked,
    });
  }, [
    server.id,
    changes.sections.join(","),
    progress?.completed.join(","),
    progress?.skipped.join(","),
    blocked,
    onNavigation,
  ]);
  useEffect(() => () => onNavigation(null), [onNavigation]);

  async function persistProgress(next: OnboardingProgress) {
    await api.saveOnboarding(server.id, next);
    setProgress(next);
  }
  async function advance(section: SettingsSection, skip = false) {
    if (!progress) return;
    const next = advanceOnboarding(progress, section, skip);
    await persistProgress(next);
    if (!mounted.current) return;
    onSectionChange(next.current);
    setFinishedNow(next.finished);
    requestAnimationFrame(() =>
      document.getElementById("settings-section-heading")?.scrollIntoView({ block: "start" }),
    );
  }
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

  async function reload(keepDraft = false, restorePending = true) {
    const current = ++request.current;
    setBusy(true);
    setError(null);
    try {
      const [next, walkthrough] = await Promise.all([
        api.readSettings(server.id),
        api.onboarding(server.id),
      ]);
      if (current !== request.current) return;
      next.setup = normalizeSetup(next.setup);
      setSnapshot(next);
      setProgress(walkthrough);
      if (!loadedWalkthrough.current) {
        if (walkthrough && !walkthrough.finished) onSectionChange(walkthrough.current);
        loadedWalkthrough.current = true;
      }
      if (restorePending && walkthrough?.pending) setPending(walkthrough.pending.jobId);
      if (!keepDraft) {
        setSetup(next.setup);
        setLinkedProvider(null);
        setResetKey((value) => value + 1);
        credentials.clear();
      }
      setErrors({});
      return next;
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
    if (!pending || !snapshot || status?.jobId !== pending || running) return;
    const job = pending;
    setPending(null);
    if (status.state !== "succeeded") {
      setSaved(false);
      setShowStatus(true);
      setError(
        new Error(
          "The settings operation failed. Review the operation panel, reload the server settings and retry.",
        ),
      );
      if (progress?.pending) void persistProgress({ ...progress, pending: null }).catch(setError);
      return;
    }
    const preparation = preparingProvider.current;
    preparingProvider.current = false;
    void (async () => {
      const next = await reload(preparation, false);
      if (!next) {
        setShowStatus(true);
        return;
      }
      if (!preparation && (!status.apiHealthy || !status.serviceActive)) {
        setSaved(false);
        setShowStatus(true);
        setError(
          new Error(
            "Settings were written, but the Hermes service is not healthy. Review the service logs.",
          ),
        );
        return;
      }
      if (
        progress?.pending?.jobId === job &&
        progress.pending.section === "model" &&
        (next.setup.deferModelSetup || !next.modelConfigured)
      ) {
        setSaved(false);
        setShowStatus(true);
        setError(
          new Error(
            "The model connection is not configured. Check its authorization and saved credentials before continuing.",
          ),
        );
        return;
      }
      if (!preparation && progress?.pending?.jobId === job) {
        await advance(progress.pending.section);
      }
      setSaved(!preparation);
      setShowStatus(false);
    })().catch((error) => {
      setError(error);
      setShowStatus(true);
    });
  }, [pending, status?.jobId, status?.state, !!snapshot]);
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
  async function apply(transportOnly = false, continueAfter = false) {
    if (!snapshot || blocked || (!changes.count && !transportOnly)) return;
    if (transportOnly && (!snapshot.modelTransportNeedsUpdate || changes.count)) return;
    const sections: SettingsSection[] = transportOnly ? ["model"] : changes.sections;
    const nextErrors = validateManagedSettings(
      setup,
      snapshot.setup,
      credentials.values,
      available,
      sections,
      snapshot.authorizedProviders ?? [],
    );
    setErrors(nextErrors);
    const id = Object.keys(nextErrors)[0];
    if (id) {
      const modelErrors = validateSetup(setup, credentials.values, false, "model", available);
      const channelErrors = validateSetup(setup, credentials.values, false, "channels", available);
      onSectionChange(
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
        { setup, sections, revision: snapshot.revision },
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
      if (continueAfter && progress && result.jobId) {
        await persistProgress({
          ...progress,
          current: section,
          pending: { jobId: result.jobId, section },
        });
      }
      credentials.clear();
    } catch (error) {
      setError(error);
    } finally {
      setBusy(false);
    }
  }

  async function continueSetup(skip = false) {
    if (!progress || blocked) return;
    if (!skip && section === "model" && setup.deferModelSetup) {
      setError(
        new Error("Connect and apply a model provider before continuing, or choose Skip for now."),
      );
      return;
    }
    if (changes.count) {
      if (!skip) await apply(false, true);
      return;
    }
    if (
      !skip &&
      section === "model" &&
      (snapshot?.setup.deferModelSetup || !snapshot?.modelConfigured)
    ) {
      setError(
        new Error("Connect and apply a model provider before continuing, or choose Skip for now."),
      );
      return;
    }
    if (!skip && (!status?.apiHealthy || !status.serviceActive)) {
      setError(new Error("Start the Hermes service before continuing the walkthrough."));
      setShowStatus(true);
      return;
    }
    setBusy(true);
    try {
      await advance(section, skip);
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
                : status.operation === "update"
                  ? "Updating Hermes…"
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
      {!guided && (
        <Button
          variant="ghost"
          size="sm"
          disabled={blocked || !snapshot || !!changes.count}
          onClick={async () => {
            setBusy(true);
            try {
              await persistProgress(initialOnboarding());
              if (mounted.current) onSectionChange("model");
              setFinishedNow(false);
            } catch (error) {
              setError(error);
            } finally {
              setBusy(false);
            }
          }}
        >
          {t("Start guided setup")}
        </Button>
      )}
      {guided && (
        <p className="walkthrough-intro">
          {t("First-time settings · Step {step} of {total}", {
            step: settingsSections.findIndex(({ id }) => id === section) + 1,
            total: settingsSections.length,
          })}
        </p>
      )}
      {finishedNow && (
        <Notice title="Settings walkthrough complete">
          <p>
            {t("Your choices were saved. You can edit each section independently from now on.")}
          </p>
        </Notice>
      )}
      <HermesUpdater
        serverId={server.id}
        installedVersion={status.installedVersion}
        disabled={blocked || !!changes.count}
        onStatus={onStatus}
      />
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
              <dd>
                {snapshot.setup.deferModelSetup
                  ? t("Not configured")
                  : selectedProvider(snapshot.setup.provider).name}
              </dd>
            </div>
            <div>
              <dt>{t("Model ID")}</dt>
              <dd translate="no">
                {snapshot.setup.deferModelSetup ? t("Not configured") : snapshot.setup.model}
              </dd>
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
          {snapshot.modelTransportNeedsUpdate && (
            <Notice title="Transport update available">
              <p>
                {t(
                  "Your Responses connection uses legacy anonymous routing. Apply the transport fix to preserve your model, endpoint and saved key while enabling the selected API.",
                )}
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={blocked || !!changes.count}
                onClick={() => void apply(true)}
              >
                {t("Apply transport fix")}
              </Button>
              {!!changes.count && (
                <p>{t("Apply or discard your pending edits before repairing the transport.")}</p>
              )}
            </Notice>
          )}
          <ToggleGroup
            disabled={blocked}
            type="single"
            variant="outline"
            className="management-tabs"
            value={section}
            onValueChange={(value) => {
              if (value) onSectionChange(value as SettingsSection);
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
                if (guided) void continueSetup();
                else void apply();
              }}
            >
              <fieldset
                id="settings-section-heading"
                tabIndex={-1}
                disabled={blocked}
                className="management-content"
                aria-label={t(
                  settingsSections.find(({ id }) => id === section)?.label ?? "Model and provider",
                )}
              >
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
              <footer className="management-save-bar" aria-label={t("Settings actions")}>
                <div
                  role="status"
                  className={confirmedSaved ? "settings-feedback success" : "settings-feedback"}
                >
                  <strong>
                    {busy || running || pending ? (
                      <Busy>
                        {t(
                          busy && !running && !pending
                            ? "Please wait…"
                            : status?.step === "service"
                              ? "Checking Hermes service…"
                              : "Applying settings",
                        )}
                      </Busy>
                    ) : confirmedSaved ? (
                      <>
                        <Check aria-hidden="true" />
                        {t("Changes applied. The Hermes service is healthy.")}
                      </>
                    ) : error ? (
                      t("Settings need attention")
                    ) : (
                      t(changes.count ? "Changed settings: {count}" : "No unsaved changes", {
                        count: changes.count,
                      })
                    )}
                  </strong>
                  <p>
                    {t(
                      "Applying changes restarts Hermes briefly. Existing keys stay on the server.",
                    )}
                  </p>
                </div>
                <div className="setup-footer-actions">
                  <Button
                    id="settings-logs-button"
                    type="button"
                    variant="outline"
                    onClick={() => setShowStatus(true)}
                  >
                    <FileText data-icon="inline-start" />
                    {t("Logs")}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={blocked || !changes.count}
                    onClick={discard}
                  >
                    {t("Discard changes")}
                  </Button>
                  {guided && (
                    <Button
                      type="button"
                      variant="ghost"
                      disabled={blocked || !!changes.count}
                      onClick={() => void continueSetup(true)}
                    >
                      {t("Skip for now")}
                    </Button>
                  )}
                  <Button type="submit" disabled={blocked || (!guided && !changes.count)}>
                    {blocked ? (
                      <Busy>{t("Please wait…")}</Busy>
                    ) : (
                      <>
                        {guided ? (
                          <ArrowRight data-icon="inline-start" />
                        ) : (
                          <Save data-icon="inline-start" />
                        )}
                        {t(
                          guided
                            ? changes.count
                              ? "Save and continue"
                              : section === "tools"
                                ? "Finish setup"
                                : "Next section"
                            : "Apply changes",
                        )}
                      </>
                    )}
                  </Button>
                </div>
              </footer>
            </form>
          </SavedCredentialsProvider>
        </>
      )}
      <ServerOperationDrawer
        server={{ ...server, setup: snapshot?.setup ?? server.setup }}
        connected={connected}
        open={showStatus}
        onOpenChange={setShowStatus}
      />
    </div>
  );
}
