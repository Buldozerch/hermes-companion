import { useEffect, useState } from "react";
import { Download, RefreshCw } from "lucide-react";
import { api } from "@/lib/api";
import type { DeploymentStatus, HermesUpdate } from "@/lib/types";
import { errorMessage } from "@/lib/validation";
import { useLocale } from "./locale-provider";
import { Button } from "./ui/button";
import { Busy, Notice } from "./shared";

export function HermesUpdater({
  serverId,
  installedVersion,
  disabled,
  onStatus,
}: {
  serverId: string;
  installedVersion: string | null;
  disabled: boolean;
  onStatus: (status: DeploymentStatus) => void;
}) {
  const { t } = useLocale();
  const [update, setUpdate] = useState<HermesUpdate | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  async function check() {
    setBusy(true);
    setError(null);
    try {
      setUpdate(await api.checkHermesUpdate(serverId));
    } catch (error) {
      setError(error);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    void check();
  }, [serverId, installedVersion]);
  async function install() {
    setBusy(true);
    setError(null);
    try {
      onStatus(await api.updateHermes(serverId));
    } catch (error) {
      setError(error);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="hermes-update-bar" aria-label={t("Hermes Agent updates")}>
      <div>
        <strong>{t("Hermes Agent updates")}</strong>
        <p>
          {t(
            update?.available
              ? "Latest stable release: {version}"
              : update
                ? "Hermes is up to date"
                : "Check the latest stable Hermes release",
            { version: update?.latestVersion ?? "" },
          )}
        </p>
        <p>
          {t(
            "A private backup is created before updating. Your model, keys and channels are preserved. Hermes restarts briefly.",
          )}
        </p>
      </div>
      <div className="setup-footer-actions">
        <Button
          size="sm"
          variant="outline"
          disabled={disabled || busy}
          onClick={() => void check()}
        >
          {busy ? (
            <Busy>{t("Please wait…")}</Busy>
          ) : (
            <>
              <RefreshCw data-icon="inline-start" />
              {t("Check for updates")}
            </>
          )}
        </Button>
        {update?.available && (
          <Button size="sm" disabled={disabled || busy} onClick={() => void install()}>
            <Download data-icon="inline-start" />
            {t("Update Hermes to {version}", { version: update.latestVersion })}
          </Button>
        )}
      </div>
      {!!error && (
        <Notice error title="Update failed">
          <span lang="en" translate="no">
            {errorMessage(error)}
          </span>
        </Notice>
      )}
    </section>
  );
}
