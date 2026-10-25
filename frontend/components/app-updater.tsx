import { useEffect, useState } from "react";
import { Download, RefreshCw } from "lucide-react";
import { api, desktop } from "@/lib/api";
import type { CompanionUpdate, UpdateProgress } from "@/lib/types";
import { errorMessage } from "@/lib/validation";
import { useLocale } from "./locale-provider";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./ui/dialog";
import { Busy, ExternalLink, Notice } from "./shared";

export function AppUpdater() {
  const { t } = useLocale();
  const [update, setUpdate] = useState<CompanionUpdate | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [progress, setProgress] = useState<UpdateProgress | null>(null);
  async function check() {
    setBusy(true);
    setError(null);
    try {
      setUpdate(await api.checkCompanionUpdate());
    } catch (error) {
      setError(error);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    if (!desktop) return;
    void check();
    const timer = window.setInterval(
      () => {
        void check();
      },
      6 * 60 * 60 * 1000,
    );
    return () => window.clearInterval(timer);
  }, []);
  if (!desktop) return null;
  async function install() {
    setInstalling(true);
    setError(null);
    setProgress({ stage: "downloading", downloaded: 0, total: null });
    try {
      await api.installCompanionUpdate(setProgress);
    } catch (error) {
      setError(error);
      setInstalling(false);
      setProgress(null);
    }
  }
  const percent = progress?.total
    ? Math.min(100, Math.round((progress.downloaded / progress.total) * 100))
    : null;
  return (
    <>
      <Button
        size="sm"
        variant={update?.available ? "default" : "ghost"}
        onClick={() => setOpen(true)}
        aria-label={t("Companion updates")}
      >
        <Download data-icon="inline-start" />
        {t(update?.available ? "Update Companion {version}" : "App updates", {
          version: update?.latestVersion ?? "",
        })}
      </Button>
      <Dialog
        open={open}
        onOpenChange={(value) => {
          if (!installing) setOpen(value);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("Companion updates")}</DialogTitle>
            <DialogDescription>
              {t("Update this desktop application. Your servers keep running during the restart.")}
            </DialogDescription>
          </DialogHeader>
          {update && (
            <dl className="deployment-facts">
              <div>
                <dt>{t("Installed version")}</dt>
                <dd>{update.currentVersion}</dd>
              </div>
              <div>
                <dt>{t("Latest version")}</dt>
                <dd>{update.latestVersion}</dd>
              </div>
            </dl>
          )}
          {!busy && update && !update.available && (
            <p role="status">{t("Companion is up to date")}</p>
          )}
          {update?.notes && (
            <details>
              <summary>{t("Release notes")}</summary>
              <p className="update-notes" lang="en" translate="no">
                {update.notes}
              </p>
            </details>
          )}
          {installing && (
            <div role="status">
              <Busy>
                {t(
                  progress?.stage === "installing"
                    ? "Installing update…"
                    : progress?.stage === "restarting"
                      ? "Restarting application…"
                      : "Downloading update…",
                )}
              </Busy>
              <progress
                aria-label={t("Update download progress")}
                max={100}
                value={percent ?? undefined}
              />
              {percent !== null && <span>{percent}%</span>}
            </div>
          )}
          {!!error && (
            <Notice error title="Update failed">
              <span lang="en" translate="no">
                {errorMessage(error)}
              </span>
            </Notice>
          )}
          {update?.available && !installing && (
            <p>
              {t(
                "Save any unsaved settings first. The app will verify the download, install it and restart.",
              )}
            </p>
          )}
          <div className="setup-footer-actions">
            <Button variant="outline" disabled={busy || installing} onClick={() => void check()}>
              {busy ? (
                <Busy>{t("Checking updates…")}</Busy>
              ) : (
                <>
                  <RefreshCw data-icon="inline-start" />
                  {t("Check for updates")}
                </>
              )}
            </Button>
            {update?.available &&
              (update.canInstall ? (
                <Button disabled={installing || busy} onClick={() => void install()}>
                  {t("Install and restart")}
                </Button>
              ) : (
                <ExternalLink url="https://github.com/Buldozerch/hermes-companion/releases">
                  {t("Download latest version")}
                </ExternalLink>
              ))}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
