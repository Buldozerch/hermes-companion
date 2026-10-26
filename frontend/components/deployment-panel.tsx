import { useSetupCredentials } from "@/components/setup-credentials";
import { ProviderSignIn } from "@/components/provider-sign-in";
import { usesBrowserAuth } from "@/lib/setup-catalog";
import { useEffect, useRef, useState } from "react";
import { Check, Download, FileText, Play, RotateCw, Square, Terminal } from "lucide-react";
import { useLocale } from "@/components/locale-provider";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { DeploymentActivity } from "@/components/deployment-activity";

import { Busy, Notice } from "@/components/shared";
import { api, desktop } from "@/lib/api";
import { errorMessage } from "@/lib/validation";
import type { DeploymentStatus, Server } from "@/lib/types";

const labels = {
  none: "Not installed",
  starting: "Starting",
  running: "Installing",
  succeeded: "Installed",
  failed: "Installation failed",
  interrupted: "Installation interrupted",
};
const stages = ["system", "user", "install", "configure", "service", "complete"];
const stageLabels: Record<string, string> = {
  system: "Update the system",
  backup: "Create a private backup",
  user: "Create the Hermes user",
  install: "Install Hermes Agent",
  configure: "Save your settings",
  service: "Configure continuous operation",
  complete: "Complete",
};

export function DeploymentPanel({
  server,
  connected,
  allowInstall = false,
  blockers = [],
  showProviderSignIn = true,
  title = "Hermes installation",
  autoLogs = false,
}: {
  server: Server;
  connected: boolean;
  allowInstall?: boolean;
  blockers?: string[];
  showProviderSignIn?: boolean;
  title?: string;
  autoLogs?: boolean;
}) {
  const { t } = useLocale();
  const credentials = useSetupCredentials(server.id);
  const [status, setStatus] = useState<DeploymentStatus | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [syncError, setSyncError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [logs, setLogs] = useState<string | null>(null);
  const request = useRef(0);
  useEffect(() => {
    if (!connected || !desktop) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      const current = ++request.current;
      try {
        const next = await api.deployment(server.id);
        if (active && current === request.current) {
          setStatus(next);
          setSyncError(null);
        }
      } catch (error) {
        if (active && current === request.current) setSyncError(error);
      } finally {
        if (active)
          timer = setTimeout(() => {
            void poll();
          }, 3000);
      }
    }
    void poll();
    return () => {
      active = false;
      clearTimeout(timer);
      request.current++;
    };
  }, [connected, server.id]);
  useEffect(() => {
    if (!autoLogs || !connected) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    async function pollLogs() {
      try {
        const result = await api.remoteLogs(server.id);
        if (active) setLogs(result);
      } catch (error) {
        if (active) setError(error);
      } finally {
        if (active) timer = setTimeout(() => void pollLogs(), 6000);
      }
    }
    void pollLogs();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [autoLogs, connected, server.id]);
  const installing = status?.state === "running" || status?.state === "starting";
  const preparing = status?.operation === "provider";
  const updating = status?.operation === "update";
  const configuring = status?.operation === "configure" || preparing;
  const statusLabel = updating
    ? {
        starting: "Starting",
        running: "Updating Hermes…",
        succeeded: "Hermes updated",
        failed: "Hermes update failed",
        interrupted: "Hermes update interrupted",
        none: "Not installed",
      }[status?.state ?? "none"]
    : preparing
      ? {
          starting: "Preparing provider…",
          running: "Preparing provider…",
          succeeded: "Provider support ready",
          failed: "Provider preparation failed",
          interrupted: "Settings interrupted",
          none: "Not installed",
        }[status?.state ?? "none"]
      : configuring
        ? {
            starting: "Starting",
            running: "Applying settings",
            succeeded: "Settings applied",
            failed: "Settings failed",
            interrupted: "Settings interrupted",
            none: "Not installed",
          }[status?.state ?? "none"]
        : labels[status?.state ?? "none"];
  const progress =
    status?.state === "succeeded" ? 5 : Math.max(0, stages.indexOf(status?.step ?? "system"));
  const remainingBlockers = blockers.filter(
    (blocker) =>
      !status?.managed || !blocker.startsWith("An existing Hermes installation was detected."),
  );
  const canInstall =
    desktop &&
    connected &&
    !!status &&
    !installing &&
    status.state !== "succeeded" &&
    remainingBlockers.length === 0;

  async function service(action: "start" | "stop" | "restart") {
    setBusy(true);
    setError(null);
    request.current++;
    try {
      setStatus(await api.service(server.id, action));
    } catch (error) {
      setError(error);
    } finally {
      setBusy(false);
    }
  }

  const visibleError = error ?? syncError;
  if (!allowInstall && !status?.managed && status?.state !== "running" && !visibleError)
    return null;

  return (
    <section className="deployment-panel" aria-label={t(title)}>
      <header className="deployment-heading">
        <h3>
          <Terminal aria-hidden="true" />
          {t(title)}
        </h3>
        <Badge variant="outline">{t(statusLabel)}</Badge>
      </header>
      <dl className="deployment-facts">
        <div>
          <dt>{t("Version")}</dt>
          <dd>{status?.installedVersion ?? status?.version ?? t("Latest stable release")}</dd>
        </div>
        <div>
          <dt>{t("Service")}</dt>
          <dd>{t(status?.serviceActive ? "Running" : "Stopped")}</dd>
        </div>
        <div>
          <dt>{t("Local API")}</dt>
          <dd>{t(status?.apiHealthy ? "Healthy" : "Not ready")}</dd>
        </div>
        <div>
          <dt>{t("Model credentials")}</dt>
          <dd>{t(status?.modelConfigured ? "Configured" : "Not configured")}</dd>
        </div>
      </dl>
      {!desktop && (
        <Notice title="Desktop app required">
          {t("Start the desktop app to install Hermes on your server.")}
        </Notice>
      )}
      {installing && (
        <div className="deployment-progress">
          <div role="status" className="deployment-stage">
            <Busy>
              {t(
                preparing
                  ? "Preparing provider…"
                  : updating && status?.step === "install"
                    ? "Updating Hermes…"
                    : (stageLabels[status?.step ?? "system"] ?? "Installing"),
              )}
            </Busy>
          </div>
          <span className="deployment-stage-count">
            {t("Stage {step} of {total}", { step: progress + 1, total: stages.length })}
          </span>
          <div
            role="progressbar"
            aria-label={t(configuring ? "Settings progress" : "Installation progress")}
            aria-valuemin={0}
            aria-valuemax={5}
            aria-valuenow={progress}
            aria-valuetext={t(stageLabels[status?.step ?? "system"] ?? "Installing")}
          >
            <span style={{ width: `${progress * 20}%` }} />
          </div>
          <p>
            {t(
              configuring
                ? "Changes are applied on the server. Progress updates automatically."
                : "Progress updates automatically. Installation continues on the server if you close this app.",
            )}
          </p>
        </div>
      )}
      {(status?.state === "failed" || status?.state === "interrupted") && (
        <Notice
          error
          title={
            status.state === "failed" ? "Server operation failed" : "Server operation interrupted"
          }
        >
          {t("The operation stopped at: {stage}. Review the output below before retrying.", {
            stage: t(stageLabels[status.step] ?? "Installing"),
          })}
        </Notice>
      )}
      {status && (installing || status.state === "failed" || status.state === "interrupted") && (
        <DeploymentActivity
          key={`${server.id}:${status.jobId}`}
          serverId={server.id}
          status={status}
          connected={connected}
          rawOutput={autoLogs ? (logs ?? "") : undefined}
        />
      )}
      {status?.state === "succeeded" && (
        <p className="saved-message">
          <Check />
          {t(
            preparing
              ? "Provider support ready. Sign in and select a model before applying your settings."
              : updating
                ? "Hermes is updated. Your configuration and connections were preserved."
                : configuring
                  ? "Settings applied. Service health and model credentials are shown above."
                  : "Hermes is installed. Service health and model credentials are shown separately above.",
          )}
        </p>
      )}
      {showProviderSignIn &&
        usesBrowserAuth(server.setup) &&
        status?.managed &&
        status.installedVersion && (
          <ProviderSignIn
            key={server.setup.provider}
            serverId={server.id}
            provider={server.setup.provider}
            disabled={installing || !connected}
          />
        )}
      {!!visibleError && (
        <Notice error title="Operation failed">
          <span lang="en" translate="no">
            {errorMessage(visibleError)}
          </span>
        </Notice>
      )}
      {allowInstall && status?.state !== "succeeded" && !installing && (
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            setBusy(true);
            setError(null);
            request.current++;
            try {
              setStatus(
                await api.install(server.id, {
                  apiKey: "",
                  telegramToken: "",
                  telegramAllowedUsers: "",
                  values: [],
                }),
              );
              credentials.clear();
            } catch (error) {
              setError(error);
            } finally {
              setBusy(false);
            }
          }}
        >
          <p className="deployment-disclosure">
            {t(
              "Installs the latest stable Hermes release, prepares Ubuntu packages, creates the hermes account and enables a background service.",
            )}
          </p>
          <Button type="submit" disabled={!canInstall || busy}>
            {busy ? (
              <Busy>{t("Starting installation…")}</Busy>
            ) : (
              <>
                <Download data-icon="inline-start" />
                {t(
                  status?.state === "failed" || status?.state === "interrupted"
                    ? "Retry installation"
                    : "Install latest Hermes",
                )}
              </>
            )}
          </Button>
        </form>
      )}
      {status?.managed && (
        <div className="deployment-actions">
          <Button
            size="sm"
            variant="outline"
            onClick={() => void service("start")}
            disabled={busy || installing || !status.serviceInstalled || status.serviceActive}
          >
            <Play data-icon="inline-start" />
            {t("Start")}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => void service("stop")}
            disabled={busy || installing || !status.serviceInstalled || !status.serviceActive}
          >
            <Square data-icon="inline-start" />
            {t("Stop")}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => void service("restart")}
            disabled={busy || installing || !status.serviceInstalled}
          >
            <RotateCw data-icon="inline-start" />
            {t("Restart")}
          </Button>
          {!autoLogs && (
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={async () => {
                if (logs !== null) {
                  setLogs(null);
                  return;
                }
                setBusy(true);
                try {
                  setLogs(await api.remoteLogs(server.id));
                } catch (error) {
                  setError(error);
                } finally {
                  setBusy(false);
                }
              }}
            >
              <FileText data-icon="inline-start" />
              {t(logs === null ? "View diagnostic logs" : "Hide diagnostic logs")}
            </Button>
          )}
        </div>
      )}
      {!!status?.events.length && (
        <pre
          className="deployment-log"
          lang="en"
          translate="no"
          aria-label={t("Installation events")}
        >
          {status.events.join("\n")}
        </pre>
      )}
      {logs !== null && (
        <pre className="deployment-log" lang="en" translate="no" aria-label={t("Diagnostic logs")}>
          {logs}
        </pre>
      )}
    </section>
  );
}
