import { useState, type ReactNode } from "react";
import { useLocale } from "@/components/locale-provider";
import { useSetupCredentials, useSavedCredential } from "@/components/setup-credentials";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Field,
  FieldLabel,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldSet,
  FieldLegend,
} from "@/components/ui/field";
import { ExternalLink } from "@/components/shared";
import { providers, selectedProvider, type CredentialField } from "@/lib/setup-catalog";

export function secretField(
  name: string,
  label: string,
  required = false,
  url = "",
): CredentialField {
  return { name, label, required, secret: true, description: "", url };
}

export function CredentialInput({
  field,
  serverId,
  error,
  fieldPlaceholder,
  optional = false,
  action,
  help,
  disabled = false,
}: {
  field: CredentialField;
  serverId: string;
  error?: string;
  fieldPlaceholder?: string;
  optional?: boolean;
  action?: ReactNode;
  help?: string;
  disabled?: boolean;
}) {
  const { t } = useLocale();
  const credentials = useSetupCredentials(serverId);
  const configured = useSavedCredential(field.name);
  const [replacing, setReplacing] = useState("");
  const editing = replacing === field.name || !!credentials.values[field.name];
  const id = `credential-${field.name}`;
  const descriptionId = `${id}-help`;
  const errorId = `${id}-error`;
  return (
    <Field data-invalid={!!error} data-disabled={disabled}>
      <div className="setup-field-heading">
        <FieldLabel id={`${id}-label`} htmlFor={configured && !editing ? undefined : id}>
          {t(field.label)}
          {field.required && !optional && !configured && <span aria-hidden="true">*</span>}
        </FieldLabel>
        {action || (field.url && <ExternalLink url={field.url}>{t("Get API key")}</ExternalLink>)}
      </div>
      {configured && !editing ? (
        <div className="saved-credential" aria-labelledby={`${id}-label`}>
          <span>{t("Configured on server")}</span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={disabled}
            onClick={() => setReplacing(field.name)}
          >
            {t(field.secret ? "Replace" : "Change")}
          </Button>
        </div>
      ) : (
        <Input
          id={id}
          type={field.secret ? "password" : "text"}
          value={credentials.values[field.name] ?? ""}
          onChange={(event) => credentials.update(field.name, event.target.value)}
          autoComplete="off"
          maxLength={65536}
          spellCheck={false}
          disabled={disabled}
          aria-invalid={!!error}
          aria-required={field.required && !optional && !disabled && !configured}
          aria-describedby={
            [help ? descriptionId : "", error ? errorId : ""].filter(Boolean).join(" ") || undefined
          }
          placeholder={fieldPlaceholder ? t(fieldPlaceholder) : undefined}
          inputMode={field.name === "TELEGRAM_ALLOWED_USERS" ? "numeric" : undefined}
        />
      )}
      {configured && editing && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => {
            credentials.update(field.name, "");
            setReplacing("");
          }}
        >
          {t("Keep saved value")}
        </Button>
      )}
      {help && <FieldDescription id={descriptionId}>{t(help)}</FieldDescription>}
      {error && <FieldError id={errorId}>{t(error)}</FieldError>}
    </Field>
  );
}

export function CredentialFile({
  serverId,
  name,
  label,
}: {
  serverId: string;
  name: string;
  label: string;
}) {
  const { t } = useLocale();
  const credentials = useSetupCredentials(serverId);
  const configured = useSavedCredential(name);
  const [error, setError] = useState(false);
  return (
    <Field>
      <FieldLabel htmlFor={`credential-${name}`}>{t(label)}</FieldLabel>
      {configured && (
        <FieldDescription>
          {t("Configured on server. Choose a file only to replace it.")}
        </FieldDescription>
      )}
      <Input
        id={`credential-${name}`}
        type="file"
        accept=".json,application/json"
        onChange={async (event) => {
          const file = event.target.files?.[0];
          if (!file) return;
          try {
            if (file.size > 65536) throw new Error();
            const contents = await file.text();
            JSON.parse(contents);
            credentials.update(name, contents);
            setError(false);
          } catch {
            credentials.update(name, "");
            setError(true);
          }
        }}
      />
      <FieldDescription>
        {t(
          error
            ? "Choose a valid JSON file smaller than 64 KB."
            : credentials.values[name]
              ? "Credentials loaded in memory. They will be sent only to your server."
              : "Choose an existing account credentials file. The file is not saved on this device.",
        )}
      </FieldDescription>
    </Field>
  );
}

type ModelSlot = { provider: string; model: string };
export function MoaSettings({
  value,
  onChange,
  serverId,
}: {
  value: string;
  onChange: (value: string) => void;
  serverId: string;
}) {
  const { t } = useLocale();
  let config: { aggregator: ModelSlot; reference_models: ModelSlot[] };
  try {
    config = JSON.parse(value);
  } catch {
    config = {
      aggregator: { provider: "openrouter", model: "" },
      reference_models: [{ provider: "openrouter", model: "" }],
    };
  }
  const connectedProviders = [
    ...new Set([config.aggregator, ...config.reference_models].map((slot) => slot.provider)),
  ].map(selectedProvider);
  function slotField(slot: ModelSlot, index: number) {
    const prefix = index < 0 ? "aggregator" : `reference-${index}`;
    function update(next: ModelSlot) {
      onChange(
        JSON.stringify(
          index < 0
            ? { ...config, aggregator: next }
            : {
                ...config,
                reference_models: config.reference_models.map((slot, i) =>
                  i === index ? next : slot,
                ),
              },
        ),
      );
    }
    return (
      <FieldGroup key={prefix}>
        <Field>
          <FieldLabel htmlFor={`moa-${prefix}-provider`}>
            {t(index < 0 ? "Aggregator provider" : "Reference provider {number}", {
              number: index + 1,
            })}
          </FieldLabel>
          <select
            id={`moa-${prefix}-provider`}
            className="native-select"
            value={slot.provider}
            onChange={(event) => update({ ...slot, provider: event.target.value })}
          >
            {providers
              .filter((item) => item.id !== "moa" && item.id !== "custom")
              .map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
          </select>
        </Field>
        <Field>
          <FieldLabel htmlFor={`moa-${prefix}-model`}>{t("Model name")}</FieldLabel>
          <Input
            id={`moa-${prefix}-model`}
            value={slot.model}
            onChange={(event) => update({ ...slot, model: event.target.value })}
            required
            maxLength={200}
          />
        </Field>
      </FieldGroup>
    );
  }
  return (
    <FieldSet className="settings-voice">
      <FieldLegend>{t("Mixture of Agents")}</FieldLegend>
      <FieldDescription>
        {t(
          "Reference models work in parallel. The aggregator combines their answers. Each provider needs its own credentials.",
        )}
      </FieldDescription>
      {slotField(config.aggregator, -1)}
      {config.reference_models.map(slotField)}
      <div className="settings-footer-actions">
        <Button
          type="button"
          variant="outline"
          disabled={config.reference_models.length >= 6}
          onClick={() =>
            onChange(
              JSON.stringify({
                ...config,
                reference_models: [
                  ...config.reference_models,
                  { provider: "openrouter", model: "" },
                ],
              }),
            )
          }
        >
          {t("Add reference model")}
        </Button>
        {config.reference_models.length > 1 && (
          <Button
            type="button"
            variant="ghost"
            onClick={() =>
              onChange(
                JSON.stringify({
                  ...config,
                  reference_models: config.reference_models.slice(0, -1),
                }),
              )
            }
          >
            {t("Remove last reference")}
          </Button>
        )}
      </div>
      {connectedProviders
        .filter((provider) => provider.keyVars[0])
        .map((provider) => (
          <CredentialInput
            key={provider.id}
            serverId={serverId}
            field={secretField(provider.keyVars[0], `${provider.name} API key`)}
          />
        ))}
    </FieldSet>
  );
}
