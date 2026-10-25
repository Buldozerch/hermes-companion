import { invoke, isTauri } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { normalizeSetup } from "./setup-catalog";
import type {
  Activity,
  Credentials,
  DeploymentPlan,
  DeploymentSecrets,
  DeploymentStatus,
  HostKey,
  Server,
  ServerDraft,
  ServerReport,
  SetupOptions,
  Workspace,
  SettingsSnapshot,
  SettingsUpdate,
  ProviderAuthReply,
  ProviderModels,
} from "./types";

export const desktop = isTauri();
const previewKey = "hermes-companion.preview.v1";
export const defaultSetup: SetupOptions = normalizeSetup({
  provider: "openrouter",
  model: "anthropic/claude-sonnet-4.6",
  channels: ["telegram"],
  updateSystem: true,
});

function readPreview(): Workspace {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(previewKey) ?? "null");
    if (
      value &&
      typeof value === "object" &&
      "servers" in value &&
      "activity" in value &&
      Array.isArray(value.servers) &&
      Array.isArray(value.activity)
    )
      return value as Workspace;
  } catch {
    /* An invalid preview cache must not prevent the app from opening. */
  }
  return { servers: [], activity: [] };
}
function writePreview(workspace: Workspace) {
  localStorage.setItem(previewKey, JSON.stringify(workspace));
}
function previewActivity(serverId: string, title: string, detail: string): Activity {
  return {
    id: crypto.randomUUID(),
    serverId,
    title,
    detail,
    level: "info",
    createdAt: Math.floor(Date.now() / 1000),
  };
}
function desktopRequiredError() {
  return {
    code: "desktopRequired",
    message:
      "For SSH connections, start the desktop app with npm run desktop. The browser preview supports exploring the interface and saving drafts.",
  };
}

export const api = {
  load: async (): Promise<Workspace> => {
    const workspace: Workspace = desktop ? await invoke("load_workspace") : readPreview();
    return {
      ...workspace,
      servers: workspace.servers.map((server) => ({
        ...server,
        setup: normalizeSetup(server.setup),
      })),
    };
  },
  async add(draft: ServerDraft): Promise<Server> {
    if (desktop) return invoke("add_server", { draft });
    const server = { ...draft, id: crypto.randomUUID(), report: null, setup: { ...defaultSetup } };
    const workspace = readPreview();
    workspace.servers.unshift(server);
    workspace.activity.unshift(
      previewActivity(
        server.id,
        "Server draft added",
        "The profile was saved in the browser preview. No SSH connection has been made.",
      ),
    );
    writePreview(workspace);
    return server;
  },
  async remove(serverId: string): Promise<void> {
    if (desktop) return invoke("remove_server", { serverId });
    const workspace = readPreview();
    workspace.servers = workspace.servers.filter((s) => s.id !== serverId);
    writePreview(workspace);
  },
  probe: (serverId: string): Promise<HostKey> =>
    desktop ? invoke("probe_host", { serverId }) : Promise.reject(desktopRequiredError()),
  trust: (serverId: string, fingerprint: string): Promise<void> =>
    desktop
      ? invoke("trust_host", { serverId, fingerprint })
      : Promise.reject(desktopRequiredError()),
  connect: (serverId: string, credentials: Credentials): Promise<ServerReport> =>
    desktop
      ? invoke("connect_server", { serverId, credentials })
      : Promise.reject(desktopRequiredError()),
  disconnect: (serverId: string): Promise<void> =>
    desktop ? invoke("disconnect_server", { serverId }) : Promise.resolve(),
  connections: (): Promise<string[]> =>
    desktop ? invoke("connected_servers") : Promise.resolve([]),
  async saveSetup(serverId: string, setup: SetupOptions): Promise<void> {
    if (desktop) return invoke("save_setup", { serverId, setup });
    const workspace = readPreview();
    const server = workspace.servers.find((s) => s.id === serverId);
    if (server) server.setup = setup;
    writePreview(workspace);
  },
  async plan(serverId: string): Promise<DeploymentPlan> {
    if (desktop) return invoke("get_plan", { serverId });
    return {
      ready: false,
      warnings: [],
      blockers: ["Connect to the server in the desktop app to check compatibility."],
      steps: [
        {
          id: "system",
          title: "System preparation",
          description: "Check Ubuntu and install the required dependencies.",
        },
        {
          id: "user",
          title: "Dedicated user",
          description: "Hermes will run without administrator privileges.",
        },
        {
          id: "install",
          title: "Install Hermes Agent",
          description: "Use the official installer and stable release channel.",
        },
        {
          id: "configure",
          title: "Your settings",
          description: "Model provider and selected integrations.",
        },
        {
          id: "service",
          title: "Continuous operation",
          description: "Automatic startup and service health checks.",
        },
      ],
    };
  },
  deployment: (serverId: string): Promise<DeploymentStatus> =>
    desktop ? invoke("get_deployment", { serverId }) : Promise.reject(desktopRequiredError()),
  install: (serverId: string, secrets: DeploymentSecrets): Promise<DeploymentStatus> =>
    desktop
      ? invoke("start_deployment", { serverId, secrets })
      : Promise.reject(desktopRequiredError()),
  applySetup: (serverId: string, secrets: DeploymentSecrets): Promise<DeploymentStatus> =>
    desktop ? invoke("apply_setup", { serverId, secrets }) : Promise.reject(desktopRequiredError()),
  readSettings: (serverId: string): Promise<SettingsSnapshot> =>
    desktop ? invoke("read_server_settings", { serverId }) : Promise.reject(desktopRequiredError()),
  applySettings: (
    serverId: string,
    update: SettingsUpdate,
    secrets: DeploymentSecrets,
  ): Promise<DeploymentStatus> =>
    desktop
      ? invoke("apply_server_settings", { serverId, update, secrets })
      : Promise.reject(desktopRequiredError()),
  service: (serverId: string, action: "start" | "stop" | "restart"): Promise<DeploymentStatus> =>
    desktop
      ? invoke("manage_service", { serverId, action })
      : Promise.reject(desktopRequiredError()),
  remoteLogs: (serverId: string): Promise<string> =>
    desktop ? invoke("get_remote_logs", { serverId }) : Promise.reject(desktopRequiredError()),
  discoverModels: (
    serverId: string,
    setup: SetupOptions,
    secrets: DeploymentSecrets,
  ): Promise<ProviderModels> =>
    desktop
      ? invoke("discover_provider_models", { serverId, setup, secrets })
      : Promise.reject(desktopRequiredError()),
  prepareProvider: (serverId: string, provider: string): Promise<DeploymentStatus> =>
    desktop
      ? invoke("prepare_provider", { serverId, provider })
      : Promise.reject(desktopRequiredError()),
  providerAuth: (
    serverId: string,
    provider: string,
    action: "start" | "poll" | "cancel" | "submit",
    sessionId?: string,
    code?: string,
  ): Promise<ProviderAuthReply> =>
    desktop
      ? invoke("provider_auth", { serverId, provider, action, sessionId, code })
      : Promise.reject(desktopRequiredError()),
};

export async function openExternal(url: string): Promise<void> {
  if (new URL(url).protocol !== "https:") throw new Error("Only HTTPS links can be opened.");
  if (desktop) await openUrl(url);
  else window.open(url, "_blank", "noopener,noreferrer");
}
