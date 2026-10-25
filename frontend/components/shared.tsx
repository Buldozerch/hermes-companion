import { useLocale } from "@/components/locale-provider";
import type { ComponentProps, ReactNode } from "react";
import { ArrowUpRight, Info, LoaderCircle, ShieldCheck, TriangleAlert } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { openExternal } from "@/lib/api";

export function BrandMark({ small = false }: { small?: boolean }) {
  return (
    <img
      src="/hermes.svg"
      alt=""
      width={small ? 24 : 32}
      height={small ? 24 : 32}
      className={small ? "brand-mark small" : "brand-mark"}
    />
  );
}

export function Busy({ children }: { children: ReactNode }) {
  return (
    <>
      <LoaderCircle data-icon="inline-start" className="spin" />
      {children}
    </>
  );
}

export function Notice({
  title,
  children,
  error = false,
}: {
  title: string;
  children?: ReactNode;
  error?: boolean;
}) {
  const { t } = useLocale();
  return (
    <Alert variant={error ? "destructive" : "default"} className="notice">
      {error ? <TriangleAlert /> : <Info />}
      <AlertTitle>{t(title)}</AlertTitle>
      {children && <AlertDescription>{children}</AlertDescription>}
    </Alert>
  );
}

export function ExternalLink({
  url,
  children,
  className = "",
  ...props
}: Omit<ComponentProps<"a">, "href"> & {
  url: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <a
      {...props}
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className={className}
      onClick={(event) => {
        event.preventDefault();
        void openExternal(url);
      }}
    >
      {children}
      <ArrowUpRight aria-hidden="true" />
    </a>
  );
}

export function ConnectionBadge({ connected }: { connected: boolean }) {
  const { t } = useLocale();
  return (
    <Badge variant="secondary" className={connected ? "status-badge connected" : "status-badge"}>
      <span className="status-dot" />
      {t(connected ? "SSH connected" : "Not connected")}
    </Badge>
  );
}

export function TrustNote() {
  const { t } = useLocale();
  return (
    <p className="trust-note">
      <ShieldCheck aria-hidden="true" />
      {t("Connect directly to your server. Your data stays with you.")}
    </p>
  );
}

export function PageTitle({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  const { t } = useLocale();
  return (
    <header className="page-title">
      <div>
        <h1>{t(title)}</h1>
        <p>{t(description)}</p>
      </div>
      {action}
    </header>
  );
}

export function EmptyAction({ onStart }: { onStart: () => void }) {
  const { t } = useLocale();
  return <Button onClick={onStart}>{t("Add server")}</Button>;
}

export function StepFocus({ title, description }: { title: string; description: string }) {
  const { t } = useLocale();
  return (
    <Alert role="note" className="step-focus">
      <Info />
      <AlertTitle>{t(title)}</AlertTitle>
      <AlertDescription>{t(description)}</AlertDescription>
    </Alert>
  );
}
