import type { ReactNode } from "react";
import { Check, Image, Mic, Search, Volume2, FileText } from "lucide-react";
import { useLocale } from "@/components/locale-provider";
import { CredentialInput, secretField } from "@/components/setup-fields";
import { ExternalLink } from "@/components/shared";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field";
import { baseTools, setupCatalog } from "@/lib/setup-catalog";
import { serviceKeys } from "@/lib/setup-services";
import type { SetupOptions } from "@/lib/types";

interface Option {
  id: string;
  name: string;
  badge: string;
  description?: string;
  recommended?: boolean;
}
function ServiceOptions({
  name,
  options,
  value,
  onChange,
}: {
  name: string;
  options: Option[];
  value: string;
  onChange: (value: string) => void;
}) {
  const { t } = useLocale();
  return (
    <RadioGroup
      value={value}
      onValueChange={onChange}
      aria-label={t(name)}
      className="service-options"
    >
      {options.map((option) => (
        <Field
          orientation="horizontal"
          key={option.id}
          className="service-option"
          data-selected={value === option.id}
        >
          <RadioGroupItem id={`${name}-${option.id}`} value={option.id} />
          <FieldContent>
            <FieldLabel htmlFor={`${name}-${option.id}`}>
              <span>{t(option.name)}</span>
              {option.recommended && (
                <span className="service-recommended">{t("Recommended")}</span>
              )}
            </FieldLabel>
            {option.description && <FieldDescription>{t(option.description)}</FieldDescription>}
          </FieldContent>
          <Badge variant="outline">{t(option.badge)}</Badge>
        </Field>
      ))}
    </RadioGroup>
  );
}

function Service({
  title,
  description,
  icon,
  enabled,
  onToggle,
  children,
}: {
  title: string;
  description: string;
  icon: ReactNode;
  enabled?: boolean;
  onToggle?: (enabled: boolean) => void;
  children: ReactNode;
}) {
  const { t } = useLocale();
  return (
    <FieldSet className="setup-service" aria-label={t(title)}>
      <FieldLegend className="setup-service-heading">
        {icon}
        <span>{t(title)}</span>
        {onToggle && (
          <Switch
            id={`enable-${title}`}
            aria-label={t(title)}
            checked={enabled}
            onCheckedChange={onToggle}
          />
        )}
      </FieldLegend>
      <FieldDescription>{t(description)}</FieldDescription>
      {enabled !== false && children}
    </FieldSet>
  );
}

export function SetupServices({
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
  function toggle(id: string, enabled: boolean) {
    change({ tools: enabled ? [...setup.tools, id] : setup.tools.filter((tool) => tool !== id) });
  }
  function keyInput(key: string) {
    if (!key) return null;
    const service = serviceKeys[key];
    return (
      <CredentialInput
        field={secretField(key, "API key", true)}
        serverId={serverId}
        error={errors[`credential-${key}`]}
        fieldPlaceholder={installed ? "Leave empty to keep the saved value" : undefined}
        action={
          service && (
            <ExternalLink url={service.url}>
              {t("Get {service} key", { service: service.name })}
            </ExternalLink>
          )
        }
      />
    );
  }
  const tts = setupCatalog.ttsProviders.find((item) => item.id === setup.ttsProvider);
  const stt = setupCatalog.sttProviders.find((item) => item.id === setup.sttProvider);
  const coreEnabled = baseTools.every((id) => setup.tools.includes(id));
  const selectedTtsExtra =
    tts && !["edge", "elevenlabs"].includes(tts.id)
      ? [{ id: tts.id, name: tts.name, badge: tts.keyVar ? "API key required" : "No API key" }]
      : [];
  const selectedSttExtra =
    stt && !["groq", "openai"].includes(stt.id)
      ? [{ id: stt.id, name: stt.name, badge: stt.keyVar ? "API key required" : "Local" }]
      : [];
  return (
    <section aria-label={t("Services and voice")}>
      <div className="setup-section-intro">
        <h3>{t("Give Hermes the services it needs")}</h3>
        <p>{t("Start with the free options. Connect paid services only when you need them.")}</p>
      </div>
      {!management && (
        <>
          <div className="setup-tools-status">
            <Check />
            <div>
              <strong>
                {t(coreEnabled ? "All core tools are enabled by default" : "Custom tool selection")}
              </strong>
              <p>
                {t(
                  coreEnabled
                    ? "Terminal, code execution, files, memory and web browsing stay available to your agent."
                    : "Only checked tools are enabled for your agent.",
                )}
              </p>
            </div>
            <Badge variant="outline">
              {setup.tools.length}/{setupCatalog.tools.length}
            </Badge>
          </div>
          <Accordion type="single" collapsible className="setup-advanced">
            <AccordionItem value="tools">
              <AccordionTrigger>{t("Fine-tune agent tools")}</AccordionTrigger>
              <AccordionContent>
                <FieldGroup className="setup-tools-checklist">
                  {setupCatalog.tools.map((tool) => (
                    <Field orientation="horizontal" key={tool.id}>
                      <Checkbox
                        id={`use-tool-${tool.id}`}
                        checked={setup.tools.includes(tool.id)}
                        onCheckedChange={(value) => toggle(tool.id, !!value)}
                      />
                      <FieldLabel htmlFor={`use-tool-${tool.id}`}>{t(tool.name)}</FieldLabel>
                    </Field>
                  ))}
                </FieldGroup>
                <p className="setup-secondary">
                  {t(
                    "Computer use requires a desktop session on the VPS. Provider-dependent tools need the corresponding account.",
                  )}
                </p>
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </>
      )}
      <Service
        title="Text-to-speech"
        description="Let Hermes send spoken replies."
        icon={<Volume2 />}
        enabled={setup.tools.includes("tts")}
        onToggle={(enabled) => toggle("tts", enabled)}
      >
        <ServiceOptions
          name="Voice provider"
          value={setup.ttsProvider}
          onChange={(value) => change({ ttsProvider: value, ttsVoice: "" })}
          options={[
            { id: "edge", name: "Edge TTS", badge: "Free, no key", recommended: true },
            { id: "elevenlabs", name: "ElevenLabs", badge: "API key required" },
            ...selectedTtsExtra,
          ]}
        />
        {tts?.keyVar &&
          (tts.keyVar === "XAI_API_KEY" &&
          !setup.deferModelSetup &&
          setup.provider === "xai-oauth" ? (
            <p className="setup-secondary">
              {t("Uses your xAI account once authorized. No separate API key is required.")}
            </p>
          ) : (
            keyInput(tts.keyVar)
          ))}
        <Accordion type="single" collapsible>
          <AccordionItem value="more-tts">
            <AccordionTrigger>{t("More voice providers and voice settings")}</AccordionTrigger>
            <AccordionContent>
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="tts-provider">{t("All voice providers")}</FieldLabel>
                  <select
                    id="tts-provider"
                    className="native-select"
                    value={setup.ttsProvider}
                    onChange={(event) => change({ ttsProvider: event.target.value, ttsVoice: "" })}
                  >
                    {setupCatalog.ttsProviders.map((item) => (
                      <option key={item.id} value={item.id} disabled={item.id === "neutts"}>
                        {item.name}
                        {item.id === "neutts" ? " (Python < 3.14)" : ""}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field>
                  <FieldLabel htmlFor="tts-voice">{t("Voice name or ID (optional)")}</FieldLabel>
                  <Input
                    id="tts-voice"
                    value={setup.ttsVoice}
                    onChange={(event) => change({ ttsVoice: event.target.value })}
                    placeholder={t("Use the provider default")}
                  />
                </Field>
              </FieldGroup>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </Service>
      <Service
        title="Speech-to-text"
        description="Let Hermes understand your voice messages."
        icon={<Mic />}
        enabled={setup.tools.includes("stt")}
        onToggle={(enabled) => toggle("stt", enabled)}
      >
        <ServiceOptions
          name="Transcription provider"
          value={setup.sttProvider}
          onChange={(value) => change({ sttProvider: value })}
          options={[
            { id: "groq", name: "Groq Whisper", badge: "Free tier", recommended: true },
            { id: "openai", name: "OpenAI Whisper", badge: "Paid" },
            ...selectedSttExtra,
          ]}
        />
        {stt?.keyVar &&
          (stt.keyVar === "XAI_API_KEY" &&
          !setup.deferModelSetup &&
          setup.provider === "xai-oauth" ? (
            <p className="setup-secondary">
              {t("Uses your xAI account once authorized. No separate API key is required.")}
            </p>
          ) : (
            keyInput(stt.keyVar)
          ))}
        <Accordion type="single" collapsible>
          <AccordionItem value="more-stt">
            <AccordionTrigger>{t("More transcription providers")}</AccordionTrigger>
            <AccordionContent>
              <Field>
                <FieldLabel htmlFor="stt-provider">{t("All transcription providers")}</FieldLabel>
                <select
                  id="stt-provider"
                  className="native-select"
                  value={setup.sttProvider}
                  onChange={(event) => change({ sttProvider: event.target.value })}
                >
                  {setupCatalog.sttProviders.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </Field>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </Service>
      <Service
        title="Web search"
        description="Find information and links on the web."
        icon={<Search />}
        enabled={management ? setup.tools.includes("web") : undefined}
        onToggle={management ? (enabled) => toggle("web", enabled) : undefined}
      >
        <ServiceOptions
          name="Search provider"
          value={setup.searchBackend}
          onChange={(value) => change({ searchBackend: value })}
          options={[
            { id: "ddgs", name: "DuckDuckGo", badge: "Free, no key", recommended: true },
            { id: "brave-free", name: "Brave Search", badge: "API key required" },
          ]}
        />
        {setup.searchBackend === "brave-free" && keyInput("BRAVE_SEARCH_API_KEY")}
      </Service>
      <Service
        title="Read web pages"
        description="Extract readable content from links."
        icon={<FileText />}
        enabled={management ? setup.tools.includes("web") : undefined}
      >
        <ServiceOptions
          name="Page reader"
          value={setup.extractBackend}
          onChange={(value) => change({ extractBackend: value })}
          options={[
            {
              id: "builtin",
              name: "Built-in parser",
              badge: "Free, no key",
              recommended: true,
              description: "Reads static HTML and text pages on your VPS.",
            },
            { id: "firecrawl", name: "Firecrawl", badge: "API key required" },
          ]}
        />
        {setup.extractBackend === "firecrawl" && keyInput("FIRECRAWL_API_KEY")}
      </Service>
      <Service
        title="Image generation"
        description="Optional. Image services may charge per generated image."
        icon={<Image />}
        enabled={setup.tools.includes("image_gen")}
        onToggle={(enabled) => toggle("image_gen", enabled)}
      >
        <ServiceOptions
          name="Image provider"
          value={setup.imageProvider}
          onChange={(value) => change({ imageProvider: value })}
          options={[
            { id: "fal", name: "fal.ai", badge: "API key required" },
            { id: "replicate", name: "Replicate", badge: "API key required" },
            { id: "openai", name: "OpenAI Images", badge: "Paid" },
          ]}
        />
        {keyInput(
          { fal: "FAL_KEY", replicate: "REPLICATE_API_TOKEN", openai: "OPENAI_API_KEY" }[
            setup.imageProvider
          ] ?? "",
        )}
      </Service>
      {!management && (
        <Accordion type="single" collapsible className="setup-advanced">
          <AccordionItem value="advanced">
            <AccordionTrigger>{t("Additional settings")}</AccordionTrigger>
            <AccordionContent>
              <FieldGroup>
                {keyInput("XAI_API_KEY")}
                <Field orientation="horizontal">
                  <Switch
                    id="update-system"
                    checked={setup.updateSystem}
                    onCheckedChange={(value) => change({ updateSystem: value })}
                  />
                  <FieldContent>
                    <FieldLabel htmlFor="update-system">{t("Update Ubuntu packages")}</FieldLabel>
                    <FieldDescription>
                      {t("Install available updates for the current OS release.")}
                    </FieldDescription>
                  </FieldContent>
                </Field>
              </FieldGroup>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      )}
    </section>
  );
}
