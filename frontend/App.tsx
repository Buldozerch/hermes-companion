import { LanguageSwitcher, useLocale } from "@/components/locale-provider";
import { version as appVersion } from "../package.json";
import { englishMessage } from "@/lib/i18n";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Activity as ActivityIcon,
  ArrowRight,
  Check,
  ChevronRight,
  CircleHelp,
  Cloud,
  FileClock,
  FolderClosed,
  LayoutGrid,
  Laptop,
  Menu,
  Plus,
  Server as ServerIcon,
  Settings2,
  ShieldCheck,
  Trash2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Separator } from "@/components/ui/separator";
import { api, desktop } from "@/lib/api";
import { AUTHOR_URL } from "@/lib/links";
import { errorMessage } from "@/lib/validation";
import type { Page, Server, ServerDraft, ServerReport, Workspace } from "@/lib/types";
import { Overview, ServerGuide, ServerTile } from "@/components/overview";
import { ModelSettings, SetupWizard } from "@/components/setup-wizard";
import { HermesManagement } from "@/components/hermes-management";
import { AppUpdater } from "@/components/app-updater";
import type { DeploymentStatus } from "@/lib/types";
import { BrandMark, Busy, ExternalLink, Notice, PageTitle } from "@/components/shared";

const navigation = [
  { id: "overview" as const, label: "Overview", icon: LayoutGrid },
  { id: "servers" as const, label: "My servers", icon: ServerIcon },
  { id: "settings" as const, label: "Hermes settings", icon: Settings2 },
  { id: "activity" as const, label: "Activity log", icon: FileClock },
];

export default function App() {
  const { t, formatDate } = useLocale();
  const [page, setPage] = useState<Page>("overview");
  const [workspace, setWorkspace] = useState<Workspace>({ servers: [], activity: [] });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [connectedIds, setConnectedIds] = useState<string[]>([]);
  const [rebootingIds, setRebootingIds] = useState<string[]>([]);
  const rebooting = useRef(new Set<string>());
  const [deployments, setDeployments] = useState<Record<string, DeploymentStatus>>({});
  const [step, setStep] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [guide, setGuide] = useState(false);
  const [mobileNav, setMobileNav] = useState(false);
  const [removing, setRemoving] = useState<Server | null>(null);
  const [busy, setBusy] = useState(false);
  const selected = workspace.servers.find((server) => server.id === selectedId);
  const refresh = useCallback(async () => {
    const next = await api.load();
    setWorkspace(next);
    return next;
  }, []);
  useEffect(() => {
    let active = true;
    api
      .load()
      .then((next) => {
        if (active) setWorkspace(next);
      })
      .catch((error) => {
        if (active) setError(error);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    if (!desktop) return;
    let active = true;
    const check = () => {
      void api
        .connections()
        .then((ids) => {
          if (active) {
            const connected = ids.filter((id) => !rebooting.current.has(id));
            setConnectedIds(connected);
            for (const id of connected)
              void api
                .deployment(id)
                .then((status) => {
                  if (active) setDeployments((previous) => ({ ...previous, [id]: status }));
                })
                .catch(() => {});
          }
        })
        .catch(() => {
          if (active) setConnectedIds([]);
        });
    };
    check();
    const timer = window.setInterval(check, 5000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  function navigate(next: Page) {
    setPage(next);
    setMobileNav(false);
    setError("");
  }
  function start() {
    setSelectedId(null);
    setStep(0);
    navigate("setup");
  }
  function select(server: Server) {
    setSelectedId(server.id);
    const status = deployments[server.id];
    if (connectedIds.includes(server.id) && status?.managed && status.installedVersion) {
      navigate("settings");
      return;
    }
    if (
      connectedIds.includes(server.id) &&
      (status?.state === "running" || status?.state === "starting")
    ) {
      setStep(3);
      navigate("setup");
      return;
    }
    setStep(2);
    navigate("setup");
  }
  function connectionPage(server: Server) {
    setSelectedId(server.id);
    setStep(2);
    navigate("setup");
  }
  function installationPage(server: Server) {
    setSelectedId(server.id);
    const status = deployments[server.id];
    setStep(status?.state === "running" || status?.state === "starting" ? 3 : 2);
    navigate("setup");
  }
  function startWithServer() {
    setGuide(false);
    start();
    setStep(1);
  }
  async function add(draft: ServerDraft) {
    const server = await api.add(draft);
    await refresh();
    setSelectedId(server.id);
    setStep(2);
  }
  async function connected(_report: ServerReport) {
    if (selectedId) {
      rebooting.current.delete(selectedId);
      setRebootingIds((ids) => ids.filter((id) => id !== selectedId));
    }
    if (selectedId) setConnectedIds((ids) => [...new Set([...ids, selectedId])]);
    await refresh();
    if (selectedId && desktop) {
      const status = await api.deployment(selectedId);
      setDeployments((previous) => ({ ...previous, [selectedId]: status }));
      if (status.managed && status.installedVersion) navigate("settings");
      else if (status.state === "running" || status.state === "starting") setStep(3);
    }
  }

  function rebootRequested(serverId: string) {
    rebooting.current.add(serverId);
    setRebootingIds((ids) => [...new Set([...ids, serverId])]);
    setConnectedIds((ids) => ids.filter((id) => id !== serverId));
  }

  return (
    <div className="app-shell">
      <a href="#main-content" className="skip-link">
        {t("Skip to content")}
      </a>
      {mobileNav && (
        <button
          className="mobile-scrim"
          aria-label={t("Close menu")}
          onClick={() => setMobileNav(false)}
        />
      )}
      <aside
        className={mobileNav ? "sidebar is-open" : "sidebar"}
        aria-label={t("Main navigation")}
      >
        <button
          className="brand"
          onClick={() => navigate("overview")}
          aria-label={t("Hermes, go to overview")}
        >
          <BrandMark />
          <span>
            <strong>Hermes</strong>
            <small>{t("Server management")}</small>
          </span>
        </button>
        <div className="workspace-label">
          <span className="workspace-avatar">
            <FolderClosed />
          </span>
          <span>{t("Personal workspace")}</span>
          <ChevronRight />
        </div>
        <nav>
          {navigation.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => navigate(id)}
              className={
                page === id || (page === "setup" && id === "servers")
                  ? "nav-item active"
                  : "nav-item"
              }
              aria-current={page === id ? "page" : undefined}
            >
              <Icon />
              <span>{t(label)}</span>
              {id === "servers" && workspace.servers.length > 0 && (
                <span className="nav-count">{workspace.servers.length}</span>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-guide">
          <h3>
            <Cloud />
            {t("VPS preparation")}
          </h3>
          <p>{t("System requirements and connection details.")}</p>
          <button onClick={() => setGuide(true)}>
            {t("Requirements")}
            <ArrowRight />
          </button>
        </div>
        <div className="sidebar-bottom">
          <button className="help-button" onClick={() => setGuide(true)}>
            <CircleHelp />
            {t("Help and documentation")}
            <ArrowRight />
          </button>
          <Separator />
          <div className="sidebar-footnote">
            <span className="local-device">
              <Laptop />
            </span>
            <div>
              <strong>{t("On this device")}</strong>
              <span>
                Hermes Companion <span className="version">{appVersion}</span>
              </span>
            </div>
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="topbar-left">
            <Button
              variant="ghost"
              size="icon"
              className="menu-button"
              aria-label={t("Open menu")}
              onClick={() => setMobileNav(true)}
            >
              <Menu />
            </Button>
            <span className="breadcrumb-root">{t("Workspace")}</span>
            <ChevronRight />
            <span>
              {t(
                page === "setup"
                  ? "New setup"
                  : (navigation.find((item) => item.id === page)?.label ?? "Workspace"),
              )}
            </span>
          </div>
          <div className="topbar-right">
            <AppUpdater />
            <LanguageSwitcher />
            <span className="privacy-label">
              <ShieldCheck />
              {t("Local application")}
            </span>
            <Badge variant="outline">{t("Early version")}</Badge>
          </div>
        </header>
        <main id="main-content" tabIndex={-1} className="main-content">
          {!desktop && (
            <div className="preview-banner">
              <Laptop />
              <span>
                {t("Interface preview. SSH connections are available in the desktop app.")}
              </span>
              <Badge variant="secondary">Preview</Badge>
            </div>
          )}
          {!!error && (
            <div className="global-error">
              <Notice title="Action failed" error>
                {errorMessage(error, t)}
              </Notice>
              <Button
                variant="ghost"
                size="icon"
                aria-label={t("Dismiss message")}
                onClick={() => setError("")}
              >
                <X />
              </Button>
            </div>
          )}
          {workspace.servers
            .filter((server) => rebootingIds.includes(server.id))
            .map((server) => (
              <Notice key={server.id} title="Server reboot requested">
                <p>
                  {server.name}:{" "}
                  {t(
                    "SSH was disconnected after the reboot request. Wait for the server to start, then reconnect.",
                  )}
                </p>
                <Button size="sm" variant="outline" onClick={() => connectionPage(server)}>
                  {t("Reconnect to server")}
                </Button>
              </Notice>
            ))}
          {loading ? (
            <div className="app-loading" role="status">
              <Busy>{t("Loading workspace\u2026")}</Busy>
            </div>
          ) : (
            <>
              {page === "overview" && (
                <Overview
                  servers={workspace.servers}
                  connectedIds={connectedIds}
                  deployments={deployments}
                  start={start}
                  select={select}
                  navigate={navigate}
                  showGuide={() => setGuide(true)}
                />
              )}
              {page === "setup" && (
                <SetupWizard
                  server={selected}
                  step={step}
                  connected={!!selected && connectedIds.includes(selected.id)}
                  setStep={setStep}
                  onAdd={add}
                  onConnected={connected}
                  status={selectedId ? deployments[selectedId] : undefined}
                  onConfigure={() => {
                    void refresh();
                    navigate("settings");
                  }}
                  onReboot={() => {
                    if (selected) rebootRequested(selected.id);
                  }}
                  onBack={() => navigate("overview")}
                />
              )}
              {page === "servers" && (
                <div className="page-enter">
                  <PageTitle
                    title="My servers"
                    description="Saved connections to your Hermes servers."
                    action={
                      <Button onClick={start}>
                        <Plus data-icon="inline-start" />
                        {t("Add server")}
                      </Button>
                    }
                  />
                  {workspace.servers.length ? (
                    <div className="server-grid">
                      {workspace.servers.map((server) => (
                        <div key={server.id} className="server-with-actions">
                          <ServerTile
                            server={server}
                            connected={connectedIds.includes(server.id)}
                            deployment={deployments[server.id]}
                            onSelect={() => select(server)}
                          />
                          <div className="server-actions">
                            {connectedIds.includes(server.id) && (
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={async () => {
                                  try {
                                    await api.disconnect(server.id);
                                    setConnectedIds((ids) => ids.filter((id) => id !== server.id));
                                  } catch (error) {
                                    setError(error);
                                  }
                                }}
                              >
                                {t("Disconnect SSH")}
                              </Button>
                            )}
                            <Button size="sm" variant="ghost" onClick={() => setRemoving(server)}>
                              <Trash2 data-icon="inline-start" />
                              {t("Remove profile")}
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <EmptyPanel
                      icon={ServerIcon}
                      title="Your servers will appear here"
                      description="Add your first server. The app will save its address and guide you through connecting."
                      action={start}
                    />
                  )}
                </div>
              )}
              {page === "settings" && (
                <div className="page-enter">
                  <PageTitle
                    title="Hermes settings"
                    description="Manage the model, channels, services and tools on your server."
                  />
                  {workspace.servers.length ? (
                    <>
                      <div className="settings-server-picker">
                        <label htmlFor="settings-server">{t("Server")}</label>
                        <select
                          id="settings-server"
                          className="native-select"
                          value={selected?.id ?? workspace.servers[0].id}
                          onChange={(event) => setSelectedId(event.target.value)}
                        >
                          {workspace.servers.map((server) => (
                            <option value={server.id} key={server.id}>
                              {server.name} — {server.host}
                            </option>
                          ))}
                        </select>
                        <Badge variant="secondary">{t("Configuration")}</Badge>
                      </div>
                      <section className="settings-panel">
                        {desktop ? (
                          <HermesManagement
                            key={(selected ?? workspace.servers[0]).id}
                            server={selected ?? workspace.servers[0]}
                            connected={connectedIds.includes((selected ?? workspace.servers[0]).id)}
                            status={deployments[(selected ?? workspace.servers[0]).id]}
                            onConnect={() => connectionPage(selected ?? workspace.servers[0])}
                            onSetup={() => installationPage(selected ?? workspace.servers[0])}
                            onStatus={(status) =>
                              setDeployments((previous) => ({
                                ...previous,
                                [(selected ?? workspace.servers[0]).id]: status,
                              }))
                            }
                            onReboot={() => rebootRequested((selected ?? workspace.servers[0]).id)}
                          />
                        ) : (
                          <ModelSettings
                            key={(selected ?? workspace.servers[0]).id}
                            server={selected ?? workspace.servers[0]}
                            onSaved={async () => {
                              await refresh();
                            }}
                          />
                        )}
                      </section>
                    </>
                  ) : (
                    <EmptyPanel
                      icon={Settings2}
                      title="Add a server first"
                      description="After you add a server, its model and integration settings will appear here."
                      action={start}
                    />
                  )}
                </div>
              )}
              {page === "activity" && (
                <div className="page-enter">
                  <PageTitle
                    title="Activity log"
                    description="Application activity. Passwords and SSH keys are never recorded here."
                    action={
                      <Button
                        variant="outline"
                        onClick={async () => {
                          try {
                            await refresh();
                          } catch (error) {
                            setError(error);
                          }
                        }}
                      >
                        {t("Refresh")}
                      </Button>
                    }
                  />
                  {workspace.activity.length ? (
                    <section className="activity-list" aria-label={t("Application events")}>
                      {workspace.activity.map((event) => (
                        <article key={event.id}>
                          <div
                            className={
                              event.level === "success" ? "activity-icon success" : "activity-icon"
                            }
                          >
                            {event.level === "success" ? <Check /> : <ActivityIcon />}
                          </div>
                          <div className="activity-detail">
                            <h3 lang="en" translate="no">
                              {englishMessage(event.title)}
                            </h3>
                            <p lang="en" translate="no">
                              {englishMessage(event.detail)}
                            </p>
                            {workspace.servers.find((server) => server.id === event.serverId) && (
                              <small>
                                {
                                  workspace.servers.find((server) => server.id === event.serverId)
                                    ?.name
                                }
                              </small>
                            )}
                          </div>
                          <time dateTime={new Date(event.createdAt * 1000).toISOString()}>
                            {formatDate(event.createdAt)}
                          </time>
                        </article>
                      ))}
                    </section>
                  ) : (
                    <EmptyPanel
                      icon={FileClock}
                      title="Start with your first server"
                      description="Server additions and connection checks will appear here."
                      action={start}
                    />
                  )}
                </div>
              )}
            </>
          )}
        </main>
        <footer className="main-footer">
          <span>Hermes Companion</span>
          <ExternalLink url={AUTHOR_URL} className="author-link">
            {t("Author: @buldozercode")}
          </ExternalLink>
          <ExternalLink url="https://hermes-agent.nousresearch.com/docs">
            {t("Hermes documentation")}
          </ExternalLink>
        </footer>
      </div>
      <Dialog open={guide} onOpenChange={setGuide}>
        <DialogContent className="guide-dialog">
          <DialogHeader>
            <DialogTitle>{t("Start with your own server")}</DialogTitle>
            <DialogDescription>
              {t("Hermes runs on your VPS around the clock, even when this app is closed.")}
            </DialogDescription>
          </DialogHeader>
          <ServerGuide />
          <DialogFooter>
            <Button variant="outline" onClick={startWithServer}>
              {t("I already have a server")}
            </Button>
            <Button onClick={startWithServer}>
              {t("I bought a server")}
              <ArrowRight data-icon="inline-end" />
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!removing}
        onOpenChange={(open) => {
          if (!open && !busy) setRemoving(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {t("Remove profile “{name}”?", { name: removing?.name ?? "" })}
            </DialogTitle>
            <DialogDescription>
              {t(
                "The connection profile will be removed from this app. Your server and its Hermes installation will keep running.",
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRemoving(null)} disabled={busy}>
              {t("Cancel")}
            </Button>
            <Button
              variant="destructive"
              disabled={busy}
              onClick={async () => {
                if (!removing) return;
                setBusy(true);
                try {
                  await api.remove(removing.id);
                  setConnectedIds((ids) => ids.filter((id) => id !== removing.id));
                  if (selectedId === removing.id) setSelectedId(null);
                  setRemoving(null);
                  await refresh();
                } catch (error) {
                  setError(error);
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy ? <Busy>{t("Removing\u2026")}</Busy> : t("Remove profile")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function EmptyPanel({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: typeof ServerIcon;
  title: string;
  description: string;
  action: () => void;
}) {
  const { t } = useLocale();
  return (
    <Empty className="empty-panel">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Icon />
        </EmptyMedia>
        <EmptyTitle>
          <h2>{t(title)}</h2>
        </EmptyTitle>
        <EmptyDescription>{t(description)}</EmptyDescription>
      </EmptyHeader>
      <Button onClick={action}>
        <Plus data-icon="inline-start" />
        {t("Add server")}
      </Button>
    </Empty>
  );
}
