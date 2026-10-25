import { useState } from "react";
import { Check, ChevronsUpDown, Search } from "lucide-react";
import { useLocale } from "@/components/locale-provider";
import { useSetupCredentials } from "@/components/setup-credentials";
import { ExternalLink, Notice } from "@/components/shared";
import {
  CredentialFile,
  CredentialInput,
  MoaSettings,
  secretField,
} from "@/components/setup-fields";
import { ProviderSignIn } from "@/components/provider-sign-in";
import { ModelPicker } from "@/components/model-picker";
import { api } from "@/lib/api";
import { errorMessage } from "@/lib/validation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import {
  compatibleProviders,
  nativeProviderCount,
  providers,
  selectedProvider,
  usesBrowserAuth,
} from "@/lib/setup-catalog";
import { modelKey } from "@/lib/setup-services";
import type { DeploymentStatus, Server, SetupOptions } from "@/lib/types";

const quickProviders = [
  { id: "openrouter", label: "OpenRouter" },
  { id: "openai-api", label: "OpenAI" },
  { id: "anthropic", label: "Anthropic" },
  { id: "deepseek", label: "DeepSeek" },
  { id: "preset:groq", label: "Groq" },
  { id: "gemini", label: "Google" },
  { id: "custom", label: "Custom OpenAI-compatible" },
];

export function SetupModel({
  setup,
  change,
  server,
  installed,
  modelConfigured,
  errors,
  onAuthorized,
  authDisabled = false,
  authorizedProviders = [],
  preparedProviders = [],
  onPreparing,
}: {
  setup: SetupOptions;
  change: (patch: Partial<SetupOptions>) => void;
  server: Server;
  installed: boolean;
  modelConfigured: boolean;
  errors: Record<string, string>;
  onAuthorized?: () => Promise<void>;
  authDisabled?: boolean;
  authorizedProviders?: string[];
  preparedProviders?: string[];
  onPreparing?: (status: DeploymentStatus) => void;
}) {
  const { t } = useLocale();
  const [open, setOpen] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [prepareError, setPrepareError] = useState<unknown>(null);
  const provider = selectedProvider(setup.provider);
  const preset = compatibleProviders.find((item) => item.id === setup.providerPreset);
  const selected = setup.deferModelSetup ? "" : preset ? `preset:${preset.id}` : setup.provider;
  const name = setup.deferModelSetup ? "Choose a provider" : (preset?.name ?? provider.name);
  const key = modelKey(setup);
  const credentials = useSetupCredentials(server.id);
  const models = preset?.models ?? provider.models;
  const keyUrl = preset?.keyUrl ?? provider.keyUrl;
  const oauth = usesBrowserAuth(setup);
  const responsesHint =
    setup.provider === "custom" &&
    setup.apiMode === "chat_completions" &&
    /(?:^|[-/_.:])(sol|astra)(?:$|[-/_.:])/i.test(setup.model);
  const accountAuthorized =
    authorizedProviders.includes(provider.id) ||
    (!["anthropic", "openrouter", "antigravity-oauth"].includes(provider.id) &&
      modelConfigured &&
      setup.provider === server.setup.provider);
  function select(id: string) {
    if (id.startsWith("preset:")) {
      const next = compatibleProviders.find((item) => `preset:${item.id}` === id);
      if (!next) return;
      change({
        deferModelSetup: false,
        provider: "custom",
        authMethod: "api_key",
        providerPreset: next.id,
        baseUrl: next.baseUrl,
        model: next.models[0] ?? "",
        credentialEnv: "",
        apiMode: "chat_completions",
        allowUnauthenticatedModel: !next.keyVar,
      });
    } else {
      const next = selectedProvider(id);
      change({
        deferModelSetup: false,
        provider: next.id,
        authMethod: [
          "nous",
          "openai-codex",
          "minimax-oauth",
          "xai-oauth",
          "qwen-oauth",
          "antigravity-oauth",
        ].includes(next.id)
          ? "oauth"
          : "api_key",
        providerPreset: "",
        baseUrl: "",
        model: next.models[0] ?? (next.id === "moa" ? "default" : ""),
        credentialEnv: "",
        apiMode: next.apiMode || "chat_completions",
        allowUnauthenticatedModel: next.id === "lmstudio",
      });
    }
    setOpen(false);
  }
  return (
    <section aria-label={t("Agent brain")}>
      <div className="setup-section-intro">
        <h3>{t("Choose your agent's brain")}</h3>
        <p>{t("Connect a model provider or use your own OpenAI-compatible gateway.")}</p>
      </div>
      {!installed && !setup.deferModelSetup && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() =>
            change({
              deferModelSetup: true,
              provider: "openrouter",
              model: "",
              baseUrl: "",
              providerPreset: "",
              credentialEnv: "",
              moaConfig: "",
              authMethod: "api_key",
              allowUnauthenticatedModel: false,
            })
          }
        >
          {t("Set up the model after installation")}
        </Button>
      )}
      <FieldGroup>
        <Field>
          <FieldLabel>{t("Quick select")}</FieldLabel>
          <ToggleGroup
            type="single"
            variant="outline"
            value={
              selected === "openai-codex"
                ? "openai-api"
                : selected === "antigravity-oauth"
                  ? "gemini"
                  : selected
            }
            onValueChange={(value) => {
              if (value) select(value);
            }}
            className="provider-quick-select"
            aria-label={t("Quick provider selection")}
          >
            {quickProviders.map((item) => (
              <ToggleGroupItem key={item.id} value={item.id}>
                {t(item.label)}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </Field>
        <Field>
          <FieldLabel>
            {t("All Hermes providers")}
            <Badge variant="outline">
              {nativeProviderCount} + {t("plugins")}
            </Badge>
          </FieldLabel>
          <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                role="combobox"
                aria-expanded={open}
                aria-label={t("All model providers")}
                className="provider-combobox"
              >
                <Search />
                <span>{t(name)}</span>
                <ChevronsUpDown />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="provider-popover" align="start">
              <Command>
                <CommandInput
                  placeholder={t("Search all providers…")}
                  aria-label={t("Search all providers")}
                />
                <CommandList>
                  <CommandEmpty>
                    {t("No matching providers. Use Custom for any compatible API.")}
                  </CommandEmpty>
                  <CommandGroup heading={t("Hermes providers")}>
                    {providers.map((item) => (
                      <CommandItem
                        key={item.id}
                        value={`${item.name} ${item.id}`}
                        onSelect={() => select(item.id)}
                      >
                        {t(item.name)}
                        {selected === item.id && <Check />}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                  <CommandGroup heading={t("Compatible API presets")}>
                    {compatibleProviders.map((item) => (
                      <CommandItem
                        key={item.id}
                        value={`${item.name} ${item.id}`}
                        onSelect={() => select(`preset:${item.id}`)}
                      >
                        {item.name}
                        {selected === `preset:${item.id}` && <Check />}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
          <FieldDescription>
            {t(
              "Every Hermes provider is available. Compatible presets also cover Groq, Mistral, Together and local Ollama.",
            )}
          </FieldDescription>
        </Field>
        {setup.deferModelSetup ? (
          <Notice title="No model connected yet">
            <p>
              {t(
                installed
                  ? "Choose a provider above, connect your account or API key, then apply changes."
                  : "You can install Hermes without a model API key. Choose a provider above now, or connect one in Hermes settings after installation. The agent can answer once a model is connected.",
              )}
            </p>
          </Notice>
        ) : (
          <>
            {[
              "openai-api",
              "openai-codex",
              "anthropic",
              "openrouter",
              "gemini",
              "antigravity-oauth",
            ].includes(provider.id) && (
              <Field>
                <FieldLabel>{t("Connection method")}</FieldLabel>
                <ToggleGroup
                  type="single"
                  variant="outline"
                  value={oauth ? "oauth" : "api_key"}
                  className="provider-auth-method"
                  aria-label={t("Provider authentication")}
                  onValueChange={(value) => {
                    if (!value) return;
                    if (["openai-api", "openai-codex"].includes(provider.id)) {
                      select(value === "oauth" ? "openai-codex" : "openai-api");
                      if (setup.model) change({ model: setup.model });
                    } else if (["gemini", "antigravity-oauth"].includes(provider.id)) {
                      select(value === "oauth" ? "antigravity-oauth" : "gemini");
                    } else change({ authMethod: value as "api_key" | "oauth", credentialEnv: "" });
                  }}
                >
                  <ToggleGroupItem value="api_key">{t("API key")}</ToggleGroupItem>
                  <ToggleGroupItem value="oauth">
                    {t(
                      ["openai-api", "openai-codex"].includes(provider.id)
                        ? "ChatGPT subscription (OAuth)"
                        : ["gemini", "antigravity-oauth"].includes(provider.id)
                          ? "Google Antigravity (OAuth)"
                          : "Browser sign-in (OAuth)",
                    )}
                  </ToggleGroupItem>
                </ToggleGroup>
                {provider.id === "anthropic" && oauth && (
                  <FieldDescription>
                    {t(
                      "Anthropic account access requires Claude Max with extra usage credits. An API key remains available as a separate option.",
                    )}
                  </FieldDescription>
                )}
              </Field>
            )}
            {oauth && (
              <div className="setup-auth-status" id="model-auth" tabIndex={-1}>
                <Badge variant="outline">
                  {t(installed && accountAuthorized ? "Authorized" : "Authorization required")}
                </Badge>
                {provider.id === "antigravity-oauth" &&
                installed &&
                !preparedProviders.includes(provider.id) ? (
                  <div className="provider-preparation">
                    <strong>{t("Prepare Google Antigravity")}</strong>
                    <p>
                      {t(
                        "Install the official Google agy CLI and the community Hermes plugin on this server. Then sign in to Google. This briefly restarts Hermes.",
                      )}
                    </p>
                    <Button
                      type="button"
                      variant="outline"
                      disabled={authDisabled || preparing || !onPreparing}
                      onClick={async () => {
                        setPreparing(true);
                        setPrepareError(null);
                        try {
                          onPreparing?.(await api.prepareProvider(server.id, provider.id));
                        } catch (error) {
                          setPrepareError(error);
                        } finally {
                          setPreparing(false);
                        }
                      }}
                    >
                      {t(preparing ? "Preparing provider…" : "Install Antigravity support")}
                    </Button>
                    {!!prepareError && (
                      <p role="alert" lang="en" translate="no">
                        {errorMessage(prepareError)}
                      </p>
                    )}
                  </div>
                ) : installed && (onAuthorized || setup.provider === server.setup.provider) ? (
                  <ProviderSignIn
                    key={provider.id}
                    serverId={server.id}
                    provider={provider.id}
                    disabled={authDisabled}
                    onAuthorized={onAuthorized}
                    authorized={accountAuthorized}
                  />
                ) : (
                  <p>
                    {t(
                      installed
                        ? "Apply this provider, then sign in from the server panel."
                        : "Install Hermes first. Then authorize this account from the server panel.",
                    )}
                  </p>
                )}
                {errors["model-auth"] && <FieldError>{t(errors["model-auth"])}</FieldError>}
              </div>
            )}
            {!oauth && provider.keyVars.length > 1 && (
              <Field>
                <FieldLabel htmlFor="provider-credential-type">{t("Credential type")}</FieldLabel>
                <select
                  id="provider-credential-type"
                  className="native-select"
                  value={setup.credentialEnv || provider.keyVars[0]}
                  onChange={(event) => change({ credentialEnv: event.target.value })}
                >
                  {provider.keyVars.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
              </Field>
            )}
            {key && (
              <CredentialInput
                serverId={server.id}
                field={secretField(
                  key,
                  setup.provider === "custom" ? "API key" : "Model provider API key",
                  provider.authType === "api_key" &&
                    provider.id !== "lmstudio" &&
                    !setup.allowUnauthenticatedModel,
                )}
                error={errors[`credential-${key}`]}
                fieldPlaceholder={installed ? "Leave empty to keep the saved value" : undefined}
                action={
                  keyUrl ? (
                    <ExternalLink url={keyUrl}>
                      {t("Get {service} key", { service: name })}
                    </ExternalLink>
                  ) : undefined
                }
              />
            )}
            {setup.provider === "custom" && (
              <Field orientation="horizontal">
                <Checkbox
                  id="model-no-auth"
                  checked={setup.allowUnauthenticatedModel}
                  onCheckedChange={(value) => change({ allowUnauthenticatedModel: !!value })}
                />
                <FieldLabel htmlFor="model-no-auth">
                  {t("This endpoint does not require an API key")}
                </FieldLabel>
              </Field>
            )}
            {(setup.provider === "custom" ||
              setup.provider === "lmstudio" ||
              setup.provider === "azure-foundry") && (
              <>
                <Field data-invalid={!!errors["model-base-url"]}>
                  <FieldLabel htmlFor="model-base-url">Base URL</FieldLabel>
                  <Input
                    id="model-base-url"
                    aria-required={setup.provider === "custom"}
                    value={setup.baseUrl}
                    onChange={(event) =>
                      change({
                        baseUrl: event.target.value,
                        ...(setup.providerPreset ? { providerPreset: "" } : {}),
                      })
                    }
                    placeholder="http://localhost:8000/v1"
                    aria-invalid={!!errors["model-base-url"]}
                  />
                  <FieldDescription>
                    {t("Localhost means your VPS. Use the address that your VPS can reach.")}
                  </FieldDescription>
                  {errors["model-base-url"] && (
                    <FieldError>{t(errors["model-base-url"])}</FieldError>
                  )}
                </Field>
                <Field>
                  <FieldLabel htmlFor="model-api-mode">{t("Transport / API mode")}</FieldLabel>
                  <select
                    id="model-api-mode"
                    className="native-select"
                    value={setup.apiMode}
                    onChange={(event) => change({ apiMode: event.target.value })}
                  >
                    <option value="chat_completions">OpenAI Chat — /v1/chat/completions</option>
                    <option value="codex_responses">OpenAI Responses — /v1/responses</option>
                    <option value="anthropic_messages">Anthropic Messages — /v1/messages</option>
                  </select>
                  <FieldDescription>
                    {t(
                      "Choose the API supported by your gateway. The model name and model list do not determine its protocol.",
                    )}
                  </FieldDescription>
                </Field>
                {responsesHint && (
                  <Notice title="Check the model protocol">
                    <p>
                      {t(
                        "If your Sol/Astra gateway rejects Chat Completions, select OpenAI Responses. Start a new Hermes session with /new after applying the change.",
                      )}
                    </p>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => change({ apiMode: "codex_responses" })}
                    >
                      {t("Use OpenAI Responses")}
                    </Button>
                  </Notice>
                )}
              </>
            )}
            {provider.id === "bedrock" && (
              <>
                {[
                  "AWS_ACCESS_KEY_ID",
                  "AWS_SECRET_ACCESS_KEY",
                  "AWS_SESSION_TOKEN",
                  "AWS_REGION",
                ].map((key) => (
                  <CredentialInput
                    key={key}
                    field={{ ...secretField(key, key), secret: key !== "AWS_REGION" }}
                    serverId={server.id}
                  />
                ))}
                <FieldDescription>
                  {t("Leave credentials empty to use the server's existing AWS role.")}
                </FieldDescription>
              </>
            )}
            {provider.id === "vertex" && (
              <>
                <CredentialInput
                  field={{
                    ...secretField("GOOGLE_CLOUD_PROJECT", "Google Cloud project"),
                    secret: false,
                  }}
                  serverId={server.id}
                />
                <CredentialInput
                  field={{
                    ...secretField("GOOGLE_CLOUD_LOCATION", "Google Cloud location"),
                    secret: false,
                  }}
                  serverId={server.id}
                />
                <CredentialFile
                  serverId={server.id}
                  name="GOOGLE_SERVICE_ACCOUNT_JSON"
                  label="Service account JSON"
                />
              </>
            )}
            {provider.id === "qwen-oauth" && (
              <>
                <Badge variant="outline">
                  {t(
                    credentials.values.QWEN_AUTH_JSON
                      ? "Credentials loaded"
                      : "Import account credentials",
                  )}
                </Badge>
                <CredentialFile
                  serverId={server.id}
                  name="QWEN_AUTH_JSON"
                  label="Qwen account credentials JSON"
                />
              </>
            )}
            {provider.id === "copilot-acp" && (
              <CredentialInput
                serverId={server.id}
                field={secretField("COPILOT_GITHUB_TOKEN", "GitHub Copilot token")}
              />
            )}
            {provider.id === "moa" && (
              <MoaSettings
                serverId={server.id}
                value={setup.moaConfig}
                onChange={(value) => change({ moaConfig: value, model: "default" })}
              />
            )}
            <ModelPicker
              setup={setup}
              change={change}
              serverId={server.id}
              installed={installed}
              accountAuthorized={accountAuthorized}
              suggestions={models}
              error={errors["model-name"]}
            />
          </>
        )}
      </FieldGroup>
    </section>
  );
}
