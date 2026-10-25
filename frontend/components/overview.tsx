import { useLocale } from "@/components/locale-provider";
import {
  ArrowRight,
  BookOpen,
  Check,
  ChevronRight,
  Cloud,
  Cpu,
  KeyRound,
  Plus,
  Server as ServerIcon,
  Settings2,
  ShieldCheck,
  Terminal,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ConnectionBadge, PageTitle, TrustNote } from "./shared";
import { HostingGuide } from "./server-purchase";
import { RECOMMENDED_VPS } from "@/lib/links";
import type { Page, Server, DeploymentStatus } from "@/lib/types";
import { serverAction } from "@/lib/managed-settings";

const setupFlow = [
  { icon: Cloud, title: "Buy a VPS", text: "Hosting providers and recommended specifications" },
  { icon: ServerIcon, title: "Server profile", text: "SSH address, port and username" },
  { icon: KeyRound, title: "SSH check", text: "Host key, access and resources" },
  { icon: Settings2, title: "Hermes settings", text: "Model and selected integrations" },
  { icon: Check, title: "Installation plan", text: "Review the changes before installation" },
];

export function Overview({
  servers,
  connectedIds,
  deployments,
  start,
  select,
  navigate,
  showGuide,
}: {
  servers: Server[];
  connectedIds: string[];
  deployments: Record<string, DeploymentStatus>;
  start: () => void;
  select: (server: Server) => void;
  navigate: (page: Page) => void;
  showGuide: () => void;
}) {
  const { t } = useLocale();
  return (
    <div className="overview-page">
      <PageTitle
        title="Manage Hermes"
        description="Connect, inspect and configure your own servers."
        action={
          <Button variant="outline" onClick={showGuide}>
            <BookOpen data-icon="inline-start" />
            {t("Documentation")}
          </Button>
        }
      />
      <dl className="workspace-spec" aria-label={t("Workspace properties")}>
        <div>
          <dt>{t("Transport")}</dt>
          <dd>SSH</dd>
        </div>
        <div>
          <dt>{t("Storage")}</dt>
          <dd>{t("Local")}</dd>
        </div>
        <div>
          <dt>{t("Profiles")}</dt>
          <dd>{String(servers.length).padStart(2, "0")}</dd>
        </div>
        <div>
          <dt>{t("SSH sessions")}</dt>
          <dd>{String(connectedIds.length).padStart(2, "0")}</dd>
        </div>
      </dl>
      {servers.length ? (
        <>
          <div className="section-heading">
            <h2>{t("Server profiles")}</h2>
            <div className="section-actions">
              <Button variant="ghost" size="sm" onClick={() => navigate("servers")}>
                {t("All servers")}
                <ChevronRight data-icon="inline-end" />
              </Button>
              <Button size="sm" onClick={start}>
                <Plus data-icon="inline-start" />
                {t("Add server")}
              </Button>
            </div>
          </div>
          <div className="server-grid">
            {servers.slice(0, 4).map((server) => (
              <ServerTile
                key={server.id}
                server={server}
                connected={connectedIds.includes(server.id)}
                deployment={deployments[server.id]}
                onSelect={() => select(server)}
              />
            ))}
          </div>
          <div className="getting-started">
            <BookOpen aria-hidden="true" />
            <div>
              <h3>{t("Documentation and requirements")}</h3>
              <p>{t("VPS preparation, access checks and model provider setup.")}</p>
            </div>
            <Button variant="outline" onClick={showGuide}>
              {t("Open documentation")}
              <ArrowRight data-icon="inline-end" />
            </Button>
          </div>
        </>
      ) : (
        <>
          <div className="overview-grid">
            <section className="connection-panel" aria-labelledby="first-server-title">
              <header className="panel-toolbar">
                <h2 id="first-server-title">
                  <Terminal aria-hidden="true" />
                  {t("Server connection")}
                </h2>
                <Badge variant="outline">{t("Not configured")}</Badge>
              </header>
              <div className="connection-panel-body">
                <h3>{t("Add your first server")}</h3>
                <p>
                  {t(
                    "Enter your VPS address and SSH credentials. The app will check access and prepare your Hermes configuration.",
                  )}
                </p>
                <dl className="connection-spec">
                  <div>
                    <dt>{t("Target")}</dt>
                    <dd>{t("Remote Linux server")}</dd>
                  </div>
                  <div>
                    <dt>{t("Authentication")}</dt>
                    <dd>{t("Password / SSH key")}</dd>
                  </div>
                  <div>
                    <dt>{t("Host verification")}</dt>
                    <dd>{t("SHA-256 fingerprint")}</dd>
                  </div>
                  <div>
                    <dt>{t("Status")}</dt>
                    <dd>{t("No profile added")}</dd>
                  </div>
                </dl>
                <div className="connection-panel-actions">
                  <Button onClick={start}>
                    <Plus data-icon="inline-start" />
                    {t("Set up Hermes")}
                  </Button>
                  <span>
                    <ShieldCheck aria-hidden="true" />
                    {t("Direct SSH connection")}
                  </span>
                </div>
              </div>
            </section>
            <aside className="requirements-panel" aria-labelledby="requirements-title">
              <header className="panel-toolbar">
                <h2 id="requirements-title">
                  <Cpu aria-hidden="true" />
                  {t("Recommended VPS")}
                </h2>
              </header>
              <div className="requirements-panel-body">
                <dl className="requirements">
                  {RECOMMENDED_VPS.map((item) => (
                    <div key={item.label}>
                      <dt>{t(item.label)}</dt>
                      <dd>{t(item.value)}</dd>
                    </div>
                  ))}
                </dl>
                <p>
                  {t(
                    "Cloud models do not require a GPU. The VPS and model usage are billed separately.",
                  )}
                </p>
                <Button variant="outline" size="sm" onClick={showGuide}>
                  <Cloud data-icon="inline-start" />
                  {t("Choose and prepare a VPS")}
                </Button>
              </div>
            </aside>
          </div>
          <section className="journey" aria-label={t("Setup stages")}>
            <div className="section-heading">
              <h2>{t("Setup sequence")}</h2>
              <span>{t("5 stages")}</span>
            </div>
            <ol>
              {setupFlow.map(({ icon: Icon, title, text }, index) => (
                <li key={title}>
                  <div className="journey-top">
                    <span className="journey-number">{String(index + 1).padStart(2, "0")}</span>
                    <Icon aria-hidden="true" />
                  </div>
                  <h3>{t(title)}</h3>
                  <p>{t(text)}</p>
                </li>
              ))}
            </ol>
          </section>
        </>
      )}
      <TrustNote />
    </div>
  );
}

export function ServerTile({
  server,
  connected,
  deployment,
  onSelect,
}: {
  server: Server;
  connected: boolean;
  deployment?: DeploymentStatus;
  onSelect: () => void;
}) {
  const { t, formatDate, formatNumber } = useLocale();
  const report = server.report;
  return (
    <article className="server-tile">
      <header className="server-tile-top">
        <div className="server-tile-identity">
          <ServerIcon aria-hidden="true" />
          <h3>{server.name}</h3>
        </div>
        <ConnectionBadge connected={connected} />
      </header>
      <p className="server-address" translate="no">
        {server.username}@{server.host}:{server.port}
      </p>
      {report ? (
        <dl className="server-facts">
          <div>
            <dt>{t("System")}</dt>
            <dd>{report.osName}</dd>
          </div>
          <div>
            <dt>{t("Resources")}</dt>
            <dd>
              {report.cpuCount} vCPU / {formatNumber(report.memoryMb / 1024)} {t("GB RAM")}
            </dd>
          </div>
          <div>
            <dt>{t("Available")}</dt>
            <dd>
              {formatNumber(report.diskAvailableMb / 1024)} {t("GB")}
            </dd>
          </div>
          <div>
            <dt>{t("Last checked")}</dt>
            <dd>{formatDate(report.checkedAt)}</dd>
          </div>
        </dl>
      ) : (
        <p className="server-unchecked">
          {t("Profile saved. Connect to inspect the system and available resources.")}
        </p>
      )}
      <Button variant="outline" onClick={onSelect}>
        {t(serverAction(connected, deployment))}
        <ArrowRight data-icon="inline-end" />
      </Button>
    </article>
  );
}

export function ServerGuide() {
  return <HostingGuide />;
}
