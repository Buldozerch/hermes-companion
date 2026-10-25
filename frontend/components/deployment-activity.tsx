import { useEffect, useMemo, useState } from "react";
import { useLocale } from "@/components/locale-provider";
import { api } from "@/lib/api";
import type { DeploymentStatus } from "@/lib/types";
import { errorMessage } from "@/lib/validation";

function duration(seconds: number) {
  const value = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(value / 60);
  return `${String(minutes).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
}

export function DeploymentActivity({
  serverId,
  status,
  connected,
}: {
  serverId: string;
  status: DeploymentStatus;
  connected: boolean;
}) {
  const { t } = useLocale();
  const [now, setNow] = useState(Date.now);
  const [output, setOutput] = useState("");
  const [error, setError] = useState<unknown>(null);
  const sample = useMemo(() => ({ received: Date.now(), status }), [status]);
  const [openedAt] = useState(Date.now);
  const running = status.state === "running" || status.state === "starting";
  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [running]);
  useEffect(() => {
    if (!connected) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const result = await api.remoteLogs(serverId);
        if (active) {
          // Keep installer progress separate from the service journal and collapse CR redraws.
          const installer = result.split("--- Hermes service journal ---")[0];
          setOutput(installer.replace(/\r\n?/g, "\n").trim().split("\n").slice(-12).join("\n"));
          setError(null);
        }
      } catch (error) {
        if (active) setError(error);
      } finally {
        if (active && running) timer = setTimeout(() => void poll(), 6000);
      }
    }
    void poll();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [connected, serverId, status.jobId, running]);
  const sinceCheck = Math.max(0, (now - sample.received) / 1000);
  // Use the server clock so a difference between laptop/VPS clocks cannot skew elapsed time.
  const serverNow = (status.checkedAt ?? sample.received / 1000) + sinceCheck;
  return (
    <div className="deployment-activity">
      {running && (
        <>
          <dl className="deployment-timing">
            <div>
              <dt>{t(status.startedAt ? "Elapsed" : "Time in this view")}</dt>
              <dd data-testid="installation-elapsed">
                {duration(
                  status.startedAt ? serverNow - status.startedAt : (now - openedAt) / 1000,
                )}
              </dd>
            </div>
            <div>
              <dt>{t("Last status check")}</dt>
              <dd>{t("{time} ago", { time: duration(sinceCheck) })}</dd>
            </div>
            {status.outputUpdatedAt != null && (
              <div>
                <dt>{t("Last installer output")}</dt>
                <dd>{t("{time} ago", { time: duration(serverNow - status.outputUpdatedAt) })}</dd>
              </div>
            )}
          </dl>
          <p>
            {t(
              "Downloads and builds can take several minutes without new output. Elapsed time is not a completion estimate.",
            )}
          </p>
        </>
      )}
      <div className="deployment-output-heading">
        <strong>{t(running ? "Live installer output" : "Last installer output")}</strong>
        {running && <span>{t("Refreshes every 6 seconds")}</span>}
      </div>
      {!!error && (
        <p lang="en" translate="no">
          {errorMessage(error)}
        </p>
      )}
      {output ? (
        <pre
          className="deployment-log live-output"
          lang="en"
          translate="no"
          aria-label={t("Installer output")}
        >
          {output}
        </pre>
      ) : (
        <p>
          {t(
            running
              ? "Waiting for installer output…"
              : "No installer output is available. Open diagnostic logs for details.",
          )}
        </p>
      )}
    </div>
  );
}
