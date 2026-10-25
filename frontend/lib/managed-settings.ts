import type { DeploymentStatus, SettingsSection, SetupOptions } from "./types";
import { activeCredentialNames, validateSetup } from "./setup-services";
import { usesBrowserAuth } from "./setup-catalog";

export const settingsSections: { id: SettingsSection; label: string }[] = [
  { id: "model", label: "Model and provider" },
  { id: "channels", label: "Channels" },
  { id: "services", label: "Services" },
  { id: "tools", label: "Agent tools" },
];
const fields: Record<SettingsSection, (keyof SetupOptions)[]> = {
  model: [
    "deferModelSetup",
    "provider",
    "authMethod",
    "providerPreset",
    "model",
    "baseUrl",
    "apiMode",
    "credentialEnv",
    "allowUnauthenticatedModel",
    "moaConfig",
  ],
  channels: ["channels"],
  services: [
    "ttsProvider",
    "ttsVoice",
    "sttProvider",
    "searchBackend",
    "extractBackend",
    "imageProvider",
  ],
  tools: ["tools"],
};
function equal(a: unknown, b: unknown) {
  return (
    JSON.stringify(Array.isArray(a) ? [...a].sort() : a) ===
    JSON.stringify(Array.isArray(b) ? [...b].sort() : b)
  );
}
export function settingsChanges(
  setup: SetupOptions,
  baseline: SetupOptions,
  values: Record<string, string>,
) {
  const changed = new Set<SettingsSection>();
  let count = 0;
  for (const { id } of settingsSections)
    for (const field of fields[id])
      if (!equal(setup[field], baseline[field])) {
        changed.add(id);
        count++;
      }
  const active = activeCredentialNames(setup);
  const model = activeCredentialNames({ ...setup, channels: [], tools: [] });
  const channels = activeCredentialNames({ ...setup, tools: [] });
  for (const [name, value] of Object.entries(values))
    if (value.trim() && active.has(name)) {
      changed.add(model.has(name) ? "model" : channels.has(name) ? "channels" : "services");
      count++;
    }
  return { sections: [...changed], count };
}

export function availableCredentials(
  setup: SetupOptions,
  snapshot: { setup: SetupOptions; configuredCredentials: string[] },
) {
  const available = new Set(snapshot.configuredCredentials);
  if (available.has("OPENAI_API_KEY")) available.add("VOICE_TOOLS_OPENAI_KEY");
  if (setup.baseUrl !== snapshot.setup.baseUrl) available.delete("COMPANION_CUSTOM_API_KEY");
  return available;
}

export function validateManagedSettings(
  setup: SetupOptions,
  baseline: SetupOptions,
  values: Record<string, string>,
  available: Set<string>,
  sections: SettingsSection[],
  authorized: string[] = [],
) {
  let errors: Record<string, string> = {};
  if (sections.includes("model") && usesBrowserAuth(setup) && !authorized.includes(setup.provider))
    errors["model-auth"] = "Authorize this provider in your browser before applying changes.";
  for (const section of ["model", "channels"] as const)
    if (sections.includes(section))
      errors = { ...errors, ...validateSetup(setup, values, false, section, available) };
  // Unchanged services need no new credentials when editing unrelated settings.
  const serviceTools = setup.tools.filter(
    (tool) =>
      !baseline.tools.includes(tool) ||
      (tool === "tts" && setup.ttsProvider !== baseline.ttsProvider) ||
      (tool === "stt" && setup.sttProvider !== baseline.sttProvider) ||
      (tool === "web" &&
        (setup.searchBackend !== baseline.searchBackend ||
          setup.extractBackend !== baseline.extractBackend)) ||
      (tool === "image_gen" && setup.imageProvider !== baseline.imageProvider),
  );
  return {
    ...errors,
    ...validateSetup({ ...setup, tools: serviceTools }, values, false, "services", available),
  };
}

export function serverAction(connected: boolean, status?: DeploymentStatus) {
  if (!connected) return "Connect to server";
  if (status?.state === "starting" || status?.state === "running") return "Show progress";
  if (status?.managed && status.installedVersion) return "Manage Hermes";
  if (!status) return "Checking server…";
  return "Continue installation";
}
