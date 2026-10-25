import { useLocale } from "./locale-provider";
import { Field, FieldGroup, FieldLabel, FieldDescription, FieldSet, FieldLegend } from "./ui/field";
import { Checkbox } from "./ui/checkbox";
import { Badge } from "./ui/badge";
import { CredentialInput, secretField } from "./setup-fields";
import { ExternalLink } from "./shared";
import { setupCatalog } from "@/lib/setup-catalog";
import { serviceKeys } from "@/lib/setup-services";
import type { SetupOptions } from "@/lib/types";

export function ManagedTools({
  setup,
  change,
  serverId,
}: {
  setup: SetupOptions;
  change: (patch: Partial<SetupOptions>) => void;
  serverId: string;
}) {
  const { t } = useLocale();
  return (
    <FieldSet>
      <FieldLegend>
        {t("Agent tools")}{" "}
        <Badge variant="outline">
          {setup.tools.length}/{setupCatalog.tools.length}
        </Badge>
      </FieldLegend>
      <FieldDescription>
        {t(
          "Control what your agent can do. Voice and image services can also be configured in Services.",
        )}
      </FieldDescription>
      <FieldGroup className="setup-tools-checklist">
        {setupCatalog.tools.map((tool) => (
          <Field orientation="horizontal" key={tool.id}>
            <Checkbox
              id={`manage-tool-${tool.id}`}
              checked={setup.tools.includes(tool.id)}
              onCheckedChange={(checked) =>
                change({
                  tools: checked
                    ? [...setup.tools, tool.id]
                    : setup.tools.filter((id) => id !== tool.id),
                })
              }
            />
            <FieldLabel htmlFor={`manage-tool-${tool.id}`}>{t(tool.name)}</FieldLabel>
          </Field>
        ))}
      </FieldGroup>
      {setup.tools.includes("x_search") && (
        <CredentialInput
          serverId={serverId}
          field={secretField("XAI_API_KEY", "xAI API key")}
          action={
            <ExternalLink url={serviceKeys.XAI_API_KEY.url}>
              {t("Get {service} key", { service: "xAI" })}
            </ExternalLink>
          }
        />
      )}
      <FieldDescription>
        {t(
          "Computer use requires a desktop session on the VPS. Provider-dependent tools need the corresponding account.",
        )}
      </FieldDescription>
    </FieldSet>
  );
}
