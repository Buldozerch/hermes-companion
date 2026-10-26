import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./ui/dialog";
import { DeploymentPanel } from "./deployment-panel";
import { useLocale } from "./locale-provider";
import type { Server } from "@/lib/types";

export function ServerOperationDrawer({
  server,
  connected,
  open,
  onOpenChange,
}: {
  server: Server;
  connected: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useLocale();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        placement="right"
        className="server-operation-drawer"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          document.getElementById("settings-logs-button")?.focus({ preventScroll: true });
        }}
      >
        <DialogHeader>
          <DialogTitle>{t("Server operation and logs")}</DialogTitle>
          <DialogDescription>
            {server.name} · {t("Live progress and diagnostic output. Credentials are redacted.")}
          </DialogDescription>
        </DialogHeader>
        <div className="server-operation-scroll">
          <DeploymentPanel
            server={server}
            connected={connected}
            showProviderSignIn={false}
            title="Service status"
            autoLogs
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
