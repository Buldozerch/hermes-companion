import { useEffect, useState } from "react";
import { useLocale } from "@/components/locale-provider";
import { ExternalLink } from "@/components/shared";
import { CredentialInput, secretField } from "@/components/setup-fields";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { setupCatalog } from "@/lib/setup-catalog";
import type { SetupOptions } from "@/lib/types";

export function SetupChannel({
  setup,
  change,
  serverId,
  installed,
  errors,
  management = false,
}: {
  setup: SetupOptions;
  change: (patch: Partial<SetupOptions>) => void;
  serverId: string;
  installed: boolean;
  errors: Record<string, string>;
  management?: boolean;
}) {
  const { t } = useLocale();
  const [open, setOpen] = useState(
    management && setup.channels.some((id) => id !== "telegram") ? "channels" : "",
  );
  useEffect(() => {
    if (
      setupCatalog.channels.some(
        (channel) =>
          channel.id !== "telegram" &&
          channel.fields.some((field) => errors[`credential-${field.name}`]),
      )
    )
      setOpen("channels");
  }, [errors]);
  const telegram = setup.channels.includes("telegram");
  function toggle(id: string, enabled: boolean) {
    change({
      channels: enabled ? [...setup.channels, id] : setup.channels.filter((item) => item !== id),
    });
  }
  return (
    <section aria-label={t("Communication channel")}>
      <div className="setup-section-intro">
        <h3>{t(management ? "Channels" : "Talk to Hermes in Telegram")}</h3>
        <p>
          {t(
            management
              ? "Manage where Hermes can receive messages and who can use it."
              : "Create a bot and tell Hermes who is allowed to use it.",
          )}
        </p>
      </div>
      {management && (
        <Field orientation="horizontal" className="setup-console-choice">
          <Switch
            id="manage-telegram"
            checked={telegram}
            onCheckedChange={(value) => toggle("telegram", value)}
          />
          <FieldContent>
            <FieldLabel htmlFor="manage-telegram">Telegram</FieldLabel>
            <FieldDescription>
              {t("The console and local API remain available when Telegram is disabled.")}
            </FieldDescription>
          </FieldContent>
        </Field>
      )}
      <FieldGroup>
        <CredentialInput
          serverId={serverId}
          field={secretField("TELEGRAM_BOT_TOKEN", "Telegram bot token", true)}
          error={errors["credential-TELEGRAM_BOT_TOKEN"]}
          disabled={!telegram}
          fieldPlaceholder={installed ? "Leave empty to keep the saved value" : "123456789:AA..."}
          action={
            <ExternalLink url="https://t.me/BotFather">
              {t("Create a bot with @BotFather")}
            </ExternalLink>
          }
          help="Send /newbot → choose a name → copy the bot token."
        />
        <CredentialInput
          serverId={serverId}
          field={{
            ...secretField("TELEGRAM_ALLOWED_USERS", "Your Telegram ID", true),
            secret: false,
          }}
          error={errors["credential-TELEGRAM_ALLOWED_USERS"]}
          disabled={!telegram}
          fieldPlaceholder={installed ? "Leave empty to keep the saved value" : "123456789"}
          action={
            <ExternalLink url="https://t.me/userinfobot">{t("Find my Telegram ID")}</ExternalLink>
          }
          help="Your numeric user ID makes sure the agent replies only to you."
        />
      </FieldGroup>
      <Accordion
        type="single"
        collapsible
        value={open}
        onValueChange={setOpen}
        className="setup-advanced"
      >
        <AccordionItem value="channels">
          <AccordionTrigger>{t("Other channels")}</AccordionTrigger>
          <AccordionContent>
            <p className="setup-secondary">
              {t("Console, WhatsApp, Discord, SMS and all other Hermes channels.")}
            </p>
            {!management && (
              <Field orientation="horizontal" className="setup-console-choice">
                <Checkbox
                  id="console-only"
                  checked={!telegram}
                  onCheckedChange={(value) => toggle("telegram", !value)}
                />
                <FieldContent>
                  <FieldLabel htmlFor="console-only">
                    {t("Use Console without Telegram")}
                  </FieldLabel>
                  <FieldDescription>
                    {t(
                      "Hermes keeps its console and local API available. Other channels below are optional.",
                    )}
                  </FieldDescription>
                </FieldContent>
              </Field>
            )}
            <FieldGroup className="setup-other-channels">
              {setupCatalog.channels
                .filter((item) => item.id !== "telegram")
                .map((channel) => {
                  const enabled = setup.channels.includes(channel.id);
                  return (
                    <div className="setup-channel-option" key={channel.id} data-selected={enabled}>
                      <Field orientation="horizontal">
                        <Checkbox
                          id={`channel-${channel.id}`}
                          checked={enabled}
                          onCheckedChange={(value) => toggle(channel.id, !!value)}
                        />
                        <FieldLabel htmlFor={`channel-${channel.id}`}>{channel.name}</FieldLabel>
                      </Field>
                      {enabled && (
                        <FieldGroup className="setup-channel-fields">
                          {channel.fields.map((field) => (
                            <CredentialInput
                              key={field.name}
                              field={field}
                              serverId={serverId}
                              error={errors[`credential-${field.name}`]}
                              fieldPlaceholder={
                                installed ? "Leave empty to keep the saved value" : undefined
                              }
                            />
                          ))}
                          {channel.fields.length === 0 && (
                            <p className="setup-secondary">
                              {t(
                                "This channel requires a linked account or an external bridge on your VPS.",
                              )}
                            </p>
                          )}
                        </FieldGroup>
                      )}
                    </div>
                  );
                })}
            </FieldGroup>
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </section>
  );
}
