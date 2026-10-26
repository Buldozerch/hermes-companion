import { useState } from "react";
import { Power } from "lucide-react";
import { Button } from "./ui/button";
import { Busy, Notice } from "./shared";
import { useLocale } from "./locale-provider";
import { api } from "@/lib/api";
import { errorMessage } from "@/lib/validation";
import type { DeploymentStatus, Server } from "@/lib/types";

export function ServerRebootNotice({
  server,
  status,
  dirty,
  blocked,
  onReboot,
}: {
  server: Server;
  status: DeploymentStatus;
  dirty: boolean;
  blocked: boolean;
  onReboot: () => void;
}) {
  const { t } = useLocale();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const running = status.state === "starting" || status.state === "running";
  return (
    <section className="server-reboot-notice" aria-label={t("Reboot required")}>
      <div>
        <Power aria-hidden="true" />
        <div>
          <strong>
            {server.name}: {t("Ubuntu requires a reboot")}
          </strong>
          <p>
            {t(
              running
                ? "Finish the current server operation before rebooting Ubuntu."
                : dirty
                  ? "Save or discard your settings before rebooting."
                  : blocked
                    ? "Wait for the current settings operation to finish before rebooting."
                    : "You can reboot now. SSH will disconnect briefly; reconnect when the server starts.",
            )}
          </p>
        </div>
      </div>
      <Button
        disabled={busy || running || dirty || blocked}
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            await api.rebootServer(server.id);
            onReboot();
          } catch (error) {
            setError(error);
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? (
          <Busy>{t("Requesting reboot…")}</Busy>
        ) : (
          <>
            <Power data-icon="inline-start" />
            {t("Reboot server")}
          </>
        )}
      </Button>
      {!!error && (
        <Notice error title="Operation failed">
          <span lang="en" translate="no">
            {errorMessage(error)}
          </span>
        </Notice>
      )}
    </section>
  );
}
