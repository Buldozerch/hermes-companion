export { ModelSettings } from "./hermes-settings";
import { useLocale } from "@/components/locale-provider";
import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCheck,
  Cloud,
  CircleCheck,
  Cpu,
  HardDrive,
  KeyRound,
  LockKeyhole,
  Server as ServerIcon,
  ShieldCheck,
  TriangleAlert,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { api, desktop } from "@/lib/api";
import { errorMessage, serverSchema } from "@/lib/validation";
import type {
  Credentials,
  DeploymentPlan,
  DeploymentStatus,
  HostKey,
  Server,
  ServerDraft,
  ServerReport,
} from "@/lib/types";
import { Busy, Notice, StepFocus, TrustNote } from "./shared";
import { ServerPurchaseStep } from "./server-purchase";
import { DeploymentPanel } from "./deployment-panel";

const steps = [
  { title: "Buy a VPS", description: "Choose a hosting provider and server", icon: Cloud },
  { title: "Your server", description: "Add connection details", icon: ServerIcon },
  { title: "Connection", description: "Check access and system", icon: KeyRound },
  { title: "Installation", description: "Follow progress and service health", icon: CheckCheck },
];

interface WizardProps {
  server: Server | undefined;
  step: number;
  connected: boolean;
  setStep: (step: number) => void;
  onAdd: (draft: ServerDraft) => Promise<void>;
  onConnected: (report: ServerReport) => Promise<void>;
  status?: DeploymentStatus;
  onConfigure: () => void;
  onReboot: () => void;
  onBack: () => void;
}

export function SetupWizard({
  server,
  step,
  connected,
  setStep,
  onAdd,
  onConnected,
  status,
  onConfigure,
  onReboot,
  onBack,
}: WizardProps) {
  const { t } = useLocale();
  return (
    <div className="page-enter">
      <button className="back-link" onClick={onBack}>
        <ArrowLeft />
        {t("Workspace")}
      </button>
      <div className="setup-heading">
        <h1>{t("Set up your Hermes")}</h1>
        <p>{t("Follow each step. We will explain what to do next.")}</p>
      </div>
      <div className="wizard-layout">
        <aside className="wizard-rail" aria-label={t("Installation stages")}>
          <ol>
            {steps.map(({ title, description, icon: Icon }, index) => (
              <li
                key={title}
                className={index === step ? "active" : index < step ? "complete" : ""}
              >
                <button
                  disabled={index > step || (!!server && index < 2)}
                  onClick={() => setStep(index)}
                  aria-current={index === step ? "step" : undefined}
                >
                  <span className="step-icon">{index < step ? <Check /> : <Icon />}</span>
                  <span>
                    <strong>{t(title)}</strong>
                    <small>{t(description)}</small>
                  </span>
                </button>
              </li>
            ))}
          </ol>
          <div className="rail-help">
            <ShieldCheck />
            <strong>{t("You control the process")}</strong>
            <p>{t("We check your connection and selected services before installation.")}</p>
          </div>
        </aside>
        <section className="wizard-panel" aria-label={t(steps[step].title)}>
          {step === 0 && <ServerPurchaseStep onContinue={() => setStep(1)} />}
          {step === 1 && <ServerForm onAdd={onAdd} onBack={() => setStep(0)} />}
          {step === 2 && server && (
            <ConnectionStep
              server={server}
              connected={connected}
              onConnected={onConnected}
              next={() => setStep(3)}
            />
          )}
          {step === 3 && server && (
            <ReviewStep
              server={server}
              connected={connected}
              status={status}
              onConfigure={onConfigure}
              onReboot={onReboot}
            />
          )}
        </section>
      </div>
      <TrustNote />
    </div>
  );
}

function ServerForm({
  onAdd,
  onBack,
}: {
  onAdd: (draft: ServerDraft) => Promise<void>;
  onBack: () => void;
}) {
  const { t } = useLocale();
  const [error, setError] = useState<unknown>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ServerDraft>({
    resolver: zodResolver(serverSchema),
    defaultValues: { name: "My Hermes", host: "", port: 22, username: "root" },
  });
  return (
    <>
      <div className="panel-heading">
        <span className="step-counter">{t("Step {step} of {total}", { step: 2, total: 4 })}</span>
        <h2>{t("Add your server")}</h2>
        <p>{t("Find your connection details in the email or dashboard from your VPS provider.")}</p>
      </div>
      <StepFocus
        title="Copy the access details from your hosting dashboard"
        description="You need the server IP, SSH port and username. The password is entered at the next step."
      />
      <form
        onSubmit={handleSubmit(async (draft) => {
          setError("");
          try {
            await onAdd(draft);
          } catch (error) {
            setError(error);
          }
        })}
        noValidate
      >
        <FieldGroup>
          <Field data-invalid={!!errors.name}>
            <FieldLabel htmlFor="server-name">{t("Server name")}</FieldLabel>
            <Input
              id="server-name"
              autoComplete="off"
              placeholder={t("For example, My Hermes")}
              {...register("name")}
              aria-invalid={!!errors.name}
              aria-describedby={errors.name ? "name-error" : undefined}
            />
            {errors.name && (
              <FieldError id="name-error">
                {t(errors.name.message ?? "The action failed. Please try again.")}
              </FieldError>
            )}
          </Field>
          <Field data-invalid={!!errors.host}>
            <FieldLabel htmlFor="server-host">{t("IP address or domain")}</FieldLabel>
            <Input
              id="server-host"
              autoComplete="off"
              spellCheck={false}
              placeholder="203.0.113.10"
              {...register("host")}
              aria-invalid={!!errors.host}
              aria-describedby={errors.host ? "host-error" : "host-hint"}
            />
            {errors.host ? (
              <FieldError id="host-error">
                {t(errors.host.message ?? "The action failed. Please try again.")}
              </FieldError>
            ) : (
              <FieldDescription id="host-hint">
                {t("Copy the address from your hosting dashboard.")}
              </FieldDescription>
            )}
          </Field>
          <div className="form-columns">
            <Field data-invalid={!!errors.username}>
              <FieldLabel htmlFor="server-user">{t("SSH username")}</FieldLabel>
              <Input
                id="server-user"
                autoComplete="username"
                spellCheck={false}
                {...register("username")}
                aria-invalid={!!errors.username}
                aria-describedby={errors.username ? "user-error" : undefined}
              />
              {errors.username && (
                <FieldError id="user-error">
                  {t(errors.username.message ?? "The action failed. Please try again.")}
                </FieldError>
              )}
            </Field>
            <Field data-invalid={!!errors.port}>
              <FieldLabel htmlFor="server-port">{t("Port")}</FieldLabel>
              <Input
                id="server-port"
                type="number"
                inputMode="numeric"
                min={1}
                max={65535}
                {...register("port", { valueAsNumber: true })}
                aria-invalid={!!errors.port}
                aria-describedby={errors.port ? "port-error" : undefined}
              />
              {errors.port && (
                <FieldError id="port-error">
                  {t(errors.port.message ?? "The action failed. Please try again.")}
                </FieldError>
              )}
            </Field>
          </div>
        </FieldGroup>
        {!!error && (
          <Notice error title="Could not add the server">
            {errorMessage(error, t)}
          </Notice>
        )}
        <div className="form-footer">
          <span>
            <LockKeyhole />
            {t("You will need the password in the next step")}
          </span>
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? (
              <Busy>{t("Saving\u2026")}</Busy>
            ) : (
              <>
                {t("Continue")}
                <ArrowRight data-icon="inline-end" />
              </>
            )}
          </Button>
        </div>
      </form>
      <button className="expand-guide" onClick={onBack}>
        {t("Back to hosting providers")}
        <ArrowLeft />
      </button>
    </>
  );
}

function ConnectionStep({
  server,
  connected,
  onConnected,
  next,
}: {
  server: Server;
  connected: boolean;
  onConnected: (report: ServerReport) => Promise<void>;
  next: () => void;
}) {
  const { t } = useLocale();
  const [method, setMethod] = useState("password");
  const [password, setPassword] = useState("");
  const [privateKey, setPrivateKey] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [fileName, setFileName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [hostKey, setHostKey] = useState<HostKey | null>(null);
  const [report, setReport] = useState<ServerReport | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const credentials = (): Credentials =>
    method === "password"
      ? { method: "password", password }
      : { method: "key", private_key: privateKey, passphrase };

  async function authenticate() {
    const result = await api.connect(server.id, credentials());
    setPassword("");
    setPassphrase("");
    setPrivateKey("");
    setFileName("");
    setReport(result);
    await onConnected(result);
  }
  async function check() {
    setBusy(true);
    setError("");
    try {
      const key = await api.probe(server.id);
      if (key.status === "changed")
        throw {
          message:
            "The server key has changed. Connection blocked: verify the server and its fingerprint in your hosting dashboard.",
        };
      if (key.status === "new") setHostKey(key);
      else await authenticate();
    } catch (error) {
      setError(error);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="panel-heading">
        <span className="step-counter">{t("Step {step} of {total}", { step: 3, total: 4 })}</span>
        <h2>{t("Connect to your server")}</h2>
        <p>
          {t(
            "Check access, operating system and available resources. Server settings will not be changed yet.",
          )}
        </p>
      </div>
      <div className="connection-summary">
        <ServerIcon />
        <div>
          <strong>{server.name}</strong>
          <span>
            {server.username}@{server.host}:{server.port}
          </span>
        </div>
        <Badge variant="secondary">SSH</Badge>
      </div>
      {!connected && (
        <StepFocus
          title="Check the connection before continuing"
          description="Enter your SSH password or key, verify the server fingerprint, then run the connection check."
        />
      )}
      {connected ? (
        <>
          <div className="connection-success">
            <CircleCheck />
            <div>
              <h3>{t("Connection established")}</h3>
              <p>{t("The server is reachable. You can continue to Hermes settings.")}</p>
            </div>
          </div>
          {(report || server.report) && <ServerInspection report={(report || server.report)!} />}
          <DeploymentPanel server={server} connected={connected} allowInstall />
          <div className="form-footer">
            <span>
              <ShieldCheck />
              {t("Server key verified")}
            </span>
            <Button onClick={next}>
              {t("Set up Hermes")}
              <ArrowRight data-icon="inline-end" />
            </Button>
          </div>
        </>
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void check();
          }}
        >
          <FieldGroup>
            <Field>
              <FieldLabel>{t("Sign-in method")}</FieldLabel>
              <ToggleGroup
                type="single"
                value={method}
                onValueChange={(value) => {
                  if (value) setMethod(value);
                }}
                variant="outline"
                className="auth-toggle"
                aria-label={t("SSH authentication method")}
              >
                <ToggleGroupItem value="password">
                  <LockKeyhole />
                  {t("Password")}
                </ToggleGroupItem>
                <ToggleGroupItem value="key">
                  <KeyRound />
                  {t("SSH key")}
                </ToggleGroupItem>
              </ToggleGroup>
            </Field>
            {method === "password" ? (
              <Field>
                <FieldLabel htmlFor="ssh-password">{t("Server password")}</FieldLabel>
                <Input
                  id="ssh-password"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={t("Password from your hosting dashboard")}
                  required
                  disabled={busy}
                />
                <FieldDescription>
                  {t("Used only for this connection and never saved.")}
                </FieldDescription>
              </Field>
            ) : (
              <>
                <Field>
                  <FieldLabel htmlFor="ssh-key-file">{t("Private SSH key")}</FieldLabel>
                  <Input
                    ref={fileInput}
                    id="ssh-key-file"
                    type="file"
                    className="key-file-input"
                    disabled={busy}
                    onChange={async (event) => {
                      const file = event.target.files?.[0];
                      if (!file) return;
                      if (file.size > 32768) {
                        setError("Choose an SSH key file up to 32 KB.");
                        return;
                      }
                      setPrivateKey(await file.text());
                      setFileName(file.name);
                    }}
                  />
                  <FieldDescription>
                    {fileName || t("OpenSSH or PEM format. The file stays on your device.")}
                  </FieldDescription>
                </Field>
                <Field>
                  <FieldLabel htmlFor="key-passphrase">
                    {t("Key passphrase")}
                    <span className="optional">{t("if set")}</span>
                  </FieldLabel>
                  <Input
                    id="key-passphrase"
                    type="password"
                    autoComplete="off"
                    value={passphrase}
                    onChange={(e) => setPassphrase(e.target.value)}
                    disabled={busy}
                  />
                </Field>
              </>
            )}
          </FieldGroup>
          {!desktop && (
            <Notice title="Browser preview is open">
              {t(
                "SSH is available in the desktop app. Explore the interface and prepare a server profile here.",
              )}
            </Notice>
          )}
          {!!error && (
            <Notice error title="Could not connect">
              {errorMessage(error, t)}
            </Notice>
          )}
          <div className="form-footer">
            <span>
              <ShieldCheck />
              {t("Verify the server key before signing in")}
            </span>
            <Button
              type="submit"
              disabled={busy || (method === "password" ? !password : !privateKey)}
            >
              {busy ? (
                <Busy>{t("Checking server\u2026")}</Busy>
              ) : (
                <>
                  {t("Check connection")}
                  <ArrowRight data-icon="inline-end" />
                </>
              )}
            </Button>
          </div>
        </form>
      )}
      <Dialog
        open={!!hostKey}
        onOpenChange={(open) => {
          if (!open) setHostKey(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("Is this your server?")}</DialogTitle>
            <DialogDescription>
              {t(
                "On the first connection, compare this SSH fingerprint with the one in your hosting console. This helps verify that you are connecting to the right server.",
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="fingerprint">
            <span>
              {server.host}:{server.port} · {hostKey?.algorithm}
            </span>
            <code>{hostKey?.fingerprint}</code>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setHostKey(null)} disabled={busy}>
              {t("Cancel")}
            </Button>
            <Button
              disabled={busy}
              onClick={async () => {
                if (!hostKey) return;
                setBusy(true);
                setError("");
                try {
                  await api.trust(server.id, hostKey.fingerprint);
                  setHostKey(null);
                  await authenticate();
                } catch (error) {
                  setHostKey(null);
                  setError(error);
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy ? <Busy>{t("Connecting\u2026")}</Busy> : t("Confirm and connect")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function ServerInspection({ report }: { report: ServerReport }) {
  const { t, formatNumber } = useLocale();
  return (
    <div className="inspection">
      <div>
        <Check />
        <span>{t("Operating system")}</span>
        <strong>{report.osName}</strong>
      </div>
      <div>
        <Cpu />
        <span>{t("CPU and memory")}</span>
        <strong>
          {report.cpuCount} vCPU / {formatNumber(report.memoryMb / 1024)} {t("GB")}
        </strong>
      </div>
      <div>
        <HardDrive />
        <span>{t("Available disk space")}</span>
        <strong>
          {formatNumber(report.diskAvailableMb / 1024)} {t("GB")}
        </strong>
      </div>
      <div>
        {report.canAdmin ? <Check /> : <TriangleAlert />}
        <span>{t("Installation privileges")}</span>
        <strong>{t(report.canAdmin ? "Granted" : "Root or sudo required")}</strong>
      </div>
    </div>
  );
}

function ReviewStep({
  server,
  connected,
  status,
  onConfigure,
  onReboot,
}: {
  server: Server;
  connected: boolean;
  status?: DeploymentStatus;
  onConfigure: () => void;
  onReboot: () => void;
}) {
  const { t } = useLocale();
  const [plan, setPlan] = useState<DeploymentPlan | null>(null);
  const [error, setError] = useState<unknown>(null);
  const running = status?.state === "running" || status?.state === "starting";
  const installed = !!status?.managed && !!status.installedVersion;
  useEffect(() => {
    let active = true;
    api
      .plan(server.id)
      .then((value) => {
        if (active) setPlan(value);
      })
      .catch((error) => {
        if (active) setError(error);
      });
    return () => {
      active = false;
    };
  }, [server.id]);
  return (
    <>
      <div className="panel-heading">
        <span className="step-counter">{t("Step {step} of {total}", { step: 4, total: 4 })}</span>
        <h2>{t("Install Hermes first")}</h2>
        <p>
          {t(
            "No bot tokens or model keys are needed. Connect your model, Telegram and services after installation.",
          )}
        </p>
      </div>
      {!running && !installed && (
        <>
          <StepFocus
            title="A clean installation without credentials"
            description="We prepare Ubuntu, create the Hermes user and start the service. Your connections are configured next."
          />
          {!!error && (
            <Notice error title="Could not prepare the plan">
              <span lang="en" translate="no">
                {errorMessage(error)}
              </span>
            </Notice>
          )}
          {!plan && !error && <Busy>{t("Checking plan…")}</Busy>}
          {plan && (
            <>
              <ol className="plan-list">
                {plan.steps.map((item, index) => (
                  <li key={item.id}>
                    <span>{index + 1}</span>
                    <div>
                      <h3>{t(item.title)}</h3>
                      <p>{t(item.description)}</p>
                    </div>
                  </li>
                ))}
              </ol>
              {!!plan.warnings.length && (
                <Notice title="Resource recommendations">
                  {plan.warnings.map((warning) => (
                    <p key={warning}>{t(warning)}</p>
                  ))}
                </Notice>
              )}
              {!!plan.blockers.length && (
                <Notice title="Check before installation">
                  {plan.blockers.map((blocker) => (
                    <p key={blocker}>{t(blocker)}</p>
                  ))}
                </Notice>
              )}
            </>
          )}
        </>
      )}
      <DeploymentPanel
        server={server}
        connected={connected}
        allowInstall
        blockers={plan?.blockers ?? ["Check the server connection first."]}
        showProviderSignIn={false}
        onReboot={onReboot}
      />
      {installed && !running && status?.apiHealthy && (
        <Notice title="Hermes is ready to configure">
          <p>
            {t(
              "Choose a model provider, then connect Telegram and any services you need. Everything can be changed later.",
            )}
          </p>
          <Button onClick={onConfigure}>
            {t("Continue to configuration")}
            <ArrowRight data-icon="inline-end" />
          </Button>
        </Notice>
      )}
    </>
  );
}
