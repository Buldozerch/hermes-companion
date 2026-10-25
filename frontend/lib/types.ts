export interface ServerDraft {
  name: string;
  host: string;
  port: number;
  username: string;
}

export interface HermesUpdate {
  currentVersion: string;
  latestVersion: string;
  available: boolean;
}
export interface CompanionUpdate extends HermesUpdate {
  canInstall: boolean;
  notes: string;
}
export interface UpdateProgress {
  stage: "downloading" | "installing" | "restarting";
  downloaded: number;
  total: number | null;
}
export interface SetupOptions {
  authMethod: "api_key" | "oauth";
  provider: string;
  deferModelSetup: boolean;
  providerPreset: string;
  allowUnauthenticatedModel: boolean;
  model: string;
  baseUrl: string;
  apiMode: string;
  credentialEnv: string;
  moaConfig: string;
  channels: string[];
  tools: string[];
  ttsProvider: string;
  ttsVoice: string;
  sttProvider: string;
  searchBackend: string;
  extractBackend: string;
  imageProvider: string;
  telegram: boolean;
  browser: boolean;
  updateSystem: boolean;
}
export interface ServerReport {
  hostname: string;
  osName: string;
  osId: string;
  osVersion: string;
  architecture: string;
  memoryMb: number;
  diskAvailableMb: number;
  cpuCount: number;
  hasSystemd: boolean;
  canAdmin: boolean;
  hermesVersion: string | null;
  checkedAt: number;
}
export interface Server extends ServerDraft {
  id: string;
  report: ServerReport | null;
  setup: SetupOptions;
}
export interface Activity {
  id: string;
  serverId: string | null;
  title: string;
  detail: string;
  level: string;
  createdAt: number;
}
export interface Workspace {
  servers: Server[];
  activity: Activity[];
}
export interface HostKey {
  fingerprint: string;
  algorithm: string;
  status: "new" | "trusted" | "changed";
  previousFingerprint: string | null;
}
export type Credentials =
  | { method: "password"; password: string }
  | { method: "key"; private_key: string; passphrase: string };
export interface DeploymentPlan {
  ready: boolean;
  blockers: string[];
  warnings: string[];
  steps: { id: string; title: string; description: string }[];
}
export interface DeploymentSecrets {
  apiKey: string;
  telegramToken: string;
  telegramAllowedUsers: string;
  values?: { name: string; value: string }[];
}
export interface DeploymentStatus {
  jobId: string | null;
  state: "none" | "starting" | "running" | "succeeded" | "failed" | "interrupted";
  operation: "install" | "configure" | "provider" | "update";
  step: string;
  version: string | null;
  installedVersion: string | null;
  managed: boolean;
  serviceActive: boolean;
  serviceInstalled: boolean;
  apiHealthy: boolean;
  modelConfigured: boolean;
  rebootRequired: boolean;
  startedAt?: number | null;
  updatedAt?: number | null;
  checkedAt?: number | null;
  outputUpdatedAt?: number | null;
  events: string[];
}
export type Page = "overview" | "servers" | "settings" | "activity" | "setup";
export type SettingsSection = "model" | "channels" | "services" | "tools";
export interface SettingsSnapshot {
  setup: SetupOptions;
  configuredCredentials: string[];
  modelConfigured: boolean;
  modelTransportNeedsUpdate?: boolean;
  authorizedProviders: string[];
  preparedProviders?: string[];
  revision: string;
  warnings: string[];
}
export interface ProviderAuthReply {
  session_id?: string;
  flow?: "device_code" | "paste_code";
  user_code?: string;
  verification_url?: string;
  expires_in?: number;
  poll_interval?: number;
  status?: string;
}
export interface ProviderModels {
  models: string[];
  source: "provider" | "hermes";
  status: "ok" | "empty" | "unavailable" | "unauthorized";
  message: string;
  truncated: boolean;
}
export interface SettingsUpdate {
  setup: SetupOptions;
  sections: SettingsSection[];
  revision: string;
}
