import { useLocale } from "@/components/locale-provider";
import { ArrowRight, Cloud, Server, ShoppingCart } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { HOSTING_PROVIDERS, RECOMMENDED_VPS } from "@/lib/links";
import { ExternalLink, StepFocus } from "./shared";

export function ServerPurchaseStep({ onContinue }: { onContinue: () => void }) {
  const { t } = useLocale();
  return (
    <>
      <div className="panel-heading">
        <span className="step-counter">{t("Step {step} of {total}", { step: 1, total: 5 })}</span>
        <div className="purchase-heading-row">
          <h2>{t("Buy a server for Hermes")}</h2>
          <Button variant="outline" size="sm" onClick={onContinue}>
            <Server data-icon="inline-start" />
            {t("I already have a server")}
          </Button>
        </div>
        <p>
          {t(
            "Open one of the hosting providers, create a VPS with the recommended specifications, then return to this app. If you already have a server, continue to its details.",
          )}
        </p>
      </div>
      <StepFocus
        title="First, prepare a VPS with Ubuntu 24.04"
        description="Choose a provider below, buy the recommended configuration, then return and press I bought a server."
      />
      <HostingGuide />
      <div className="purchase-actions">
        <Button onClick={onContinue}>
          <ShoppingCart data-icon="inline-start" />
          {t("I bought a server")}
          <ArrowRight data-icon="inline-end" />
        </Button>
      </div>
    </>
  );
}

export function HostingGuide() {
  const { t } = useLocale();
  return (
    <div className="hosting-guide">
      <div className="hosting-providers" aria-label={t("Hosting providers for your server")}>
        {HOSTING_PROVIDERS.map((provider, index) => (
          <article className="hosting-provider" key={provider.name}>
            <header>
              <h3>
                <Cloud aria-hidden="true" />
                {provider.name}
              </h3>
              <Badge variant="outline">{t("Provider {number}", { number: index + 1 })}</Badge>
            </header>
            <p translate="no">{provider.domain}</p>
            <Button variant="outline" asChild>
              <ExternalLink url={provider.url}>
                {t("Visit {provider}", { provider: provider.name })}
              </ExternalLink>
            </Button>
          </article>
        ))}
      </div>
      <section
        className="purchase-recommendations"
        aria-label={t("Recommended server configuration")}
      >
        <h3>{t("Which server to choose")}</h3>
        <dl className="requirements">
          {RECOMMENDED_VPS.map((item) => (
            <div key={item.label}>
              <dt>{t(item.label)}</dt>
              <dd>{t(item.value)}</dd>
            </div>
          ))}
        </dl>
        <p className="guide-small">
          {t(
            "Choose the closest plan that meets or exceeds these specifications. Cloud models do not require a GPU. The VPS and model usage are billed separately.",
          )}
        </p>
      </section>
      <section className="purchase-instructions" aria-label={t("How to buy and prepare a VPS")}>
        <h3>{t("What to do on the hosting website")}</h3>
        <ol>
          <li>{t("Sign up and create a VPS/VDS with the specifications shown above.")}</li>
          <li>
            {t(
              "Choose the Ubuntu 24.04 LTS image. Pick a server region where your model provider is available.",
            )}
          </li>
          <li>
            {t(
              "Save the public IP address, SSH username and password, or prepare your private SSH key.",
            )}
          </li>
          <li>
            {t(
              "Wait for the server to become ready. Return here and click \u201cI bought a server\u201d to enter the connection details.",
            )}
          </li>
        </ol>
      </section>
    </div>
  );
}
