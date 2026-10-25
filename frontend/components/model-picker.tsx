import { useEffect, useRef, useState } from "react";
import { Check, ChevronsUpDown, RefreshCw } from "lucide-react";
import { useLocale } from "./locale-provider";
import { useSavedCredentials, useSetupCredentials } from "./setup-credentials";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { Input } from "./ui/input";
import { Field, FieldLabel, FieldDescription, FieldError } from "./ui/field";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import {
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from "./ui/command";
import { Busy } from "./shared";
import { api, desktop } from "@/lib/api";
import { activeCredentialNames, modelKey } from "@/lib/setup-services";
import { selectedProvider } from "@/lib/setup-catalog";
import { errorMessage } from "@/lib/validation";
import type { ProviderModels, SetupOptions } from "@/lib/types";

export function ModelPicker({
  setup,
  change,
  serverId,
  installed,
  accountAuthorized,
  suggestions,
  error,
}: {
  setup: SetupOptions;
  change: (patch: Partial<SetupOptions>) => void;
  serverId: string;
  installed: boolean;
  accountAuthorized: boolean;
  suggestions: string[];
  error?: string;
}) {
  const { t } = useLocale();
  const credentials = useSetupCredentials(serverId);
  const saved = useSavedCredentials();
  const [catalog, setCatalog] = useState<ProviderModels | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<unknown>(null);
  const [open, setOpen] = useState(false);
  const request = useRef(0);
  const currentModel = useRef(setup.model);
  currentModel.current = setup.model;
  const provider = selectedProvider(setup.provider);
  const names = activeCredentialNames({ ...setup, tools: [], channels: [] });
  const values = Object.entries(credentials.values)
    .filter(([name, value]) => names.has(name) && value.trim())
    .map(([name, value]) => ({ name, value: value.trim() }));
  const key = modelKey(setup);
  const keyReady =
    !!credentials.values[key]?.trim() ||
    saved.has(key) ||
    provider.keyVars.some((name) => saved.has(name));
  const canDiscover =
    desktop &&
    (setup.authMethod === "oauth"
      ? installed && accountAuthorized
      : keyReady ||
        setup.allowUnauthenticatedModel ||
        setup.provider === "lmstudio" ||
        (installed && ["aws_sdk", "vertex", "external_process"].includes(provider.authType)));
  // Credentials enter only this memory-only identity; they are never cached or logged.
  const identity = JSON.stringify([
    serverId,
    setup.provider,
    setup.providerPreset,
    setup.authMethod,
    setup.credentialEnv,
    setup.baseUrl,
    setup.apiMode,
    setup.allowUnauthenticatedModel,
    values,
  ]);
  const currentIdentity = useRef(identity);
  currentIdentity.current = identity;
  const models = catalog && ["ok", "empty"].includes(catalog.status) ? catalog.models : suggestions;

  async function discover() {
    if (!canDiscover) return;
    const current = ++request.current;
    const startedIdentity = identity;
    setBusy(true);
    setFailure(null);
    try {
      const result = await api.discoverModels(serverId, setup, {
        apiKey: "",
        telegramToken: "",
        telegramAllowedUsers: "",
        values,
      });
      if (current !== request.current || startedIdentity !== currentIdentity.current) return;
      setCatalog(result);
      if (result.status === "ok" && result.models[0] && !currentModel.current.trim())
        change({ model: result.models[0] });
    } catch (error) {
      if (current === request.current && startedIdentity === currentIdentity.current)
        setFailure(error);
    } finally {
      if (current === request.current && startedIdentity === currentIdentity.current)
        setBusy(false);
    }
  }
  useEffect(() => {
    setCatalog(null);
    setFailure(null);
    setBusy(false);
    if (!canDiscover) return;
    const timer = setTimeout(() => void discover(), 900);
    return () => {
      clearTimeout(timer);
      request.current++;
    };
  }, [identity, canDiscover]);

  return (
    <Field data-invalid={!!error}>
      <div className="model-field-heading">
        <FieldLabel htmlFor="model-name">{t("Model ID")}</FieldLabel>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!canDiscover || busy}
          onClick={() => void discover()}
        >
          <RefreshCw data-icon="inline-start" />
          {t(busy ? "Loading models…" : "Refresh models")}
        </Button>
      </div>
      {models.length > 0 && (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="outline"
              role="combobox"
              aria-expanded={open}
              aria-label={t("Available models")}
              className="provider-combobox"
            >
              <span>{t("Choose from {count} models", { count: models.length })}</span>
              <ChevronsUpDown />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="model-picker-popover" align="start">
            <Command>
              <CommandInput placeholder={t("Search models…")} aria-label={t("Search models")} />
              <CommandList>
                <CommandEmpty>
                  {t("No matching models. You can still enter an exact ID below.")}
                </CommandEmpty>
                <CommandGroup>
                  {models.map((model) => (
                    <CommandItem
                      key={model}
                      value={model}
                      onSelect={() => {
                        change({ model });
                        setOpen(false);
                      }}
                    >
                      <span translate="no">{model}</span>
                      {model === setup.model && <Check />}
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
      )}
      <Input
        id="model-name"
        aria-required={installed || setup.provider !== "antigravity-oauth"}
        list="provider-models"
        value={setup.model}
        onChange={(event) => change({ model: event.target.value })}
        placeholder={t(
          setup.provider === "antigravity-oauth" && !installed
            ? "Available after Google sign-in"
            : "Enter the exact model ID",
        )}
        maxLength={200}
        spellCheck={false}
        aria-invalid={!!error}
      />
      {setup.provider === "antigravity-oauth" && !installed && (
        <FieldDescription>
          {t(
            "Install Hermes, sign in to Google, then choose a model from your account. No model ID is needed at this stage.",
          )}
        </FieldDescription>
      )}
      <datalist id="provider-models">
        {models.map((model) => (
          <option key={model} value={model} />
        ))}
      </datalist>
      {busy ? (
        <FieldDescription>
          <Busy>{t("Reading the model catalog. No generation request is sent.")}</Busy>
        </FieldDescription>
      ) : catalog?.status === "ok" ? (
        <FieldDescription className="model-discovery-result">
          <Badge variant="outline">
            {t(catalog.source === "provider" ? "Provider catalog" : "Hermes catalog")}
          </Badge>
          <span>
            {t("Models loaded. Quota and generation access are not tested by this listing.")}
          </span>
          {catalog.truncated && (
            <span>
              {t(
                "This catalog is partial or exceeds 1,000 IDs. You can enter any exact model ID below.",
              )}
            </span>
          )}
        </FieldDescription>
      ) : catalog?.status === "empty" ? (
        <FieldDescription>
          {t("The provider returned no models for this connection.")}
        </FieldDescription>
      ) : (
        <FieldDescription>
          {t("Use a suggested model or enter any model supported by this provider.")}
        </FieldDescription>
      )}
      {catalog?.message && (
        <p className="model-discovery-message" lang="en" translate="no">
          {catalog.message}
        </p>
      )}
      {!!failure && (
        <p className="model-discovery-message" lang="en" translate="no">
          {errorMessage(failure)}
        </p>
      )}
      {error && <FieldError>{t(error)}</FieldError>}
    </Field>
  );
}
