import { useEffect, useRef, useState } from "react";
import { Check, LogIn } from "lucide-react";
import { useLocale } from "@/components/locale-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldLabel, FieldDescription } from "@/components/ui/field";
import { Busy, ExternalLink, Notice } from "@/components/shared";
import { api, openExternal } from "@/lib/api";
import { browserLoginProviders, selectedProvider } from "@/lib/setup-catalog";
import { errorMessage } from "@/lib/validation";
import type { ProviderAuthReply } from "@/lib/types";

export function ProviderSignIn({
  serverId,
  provider,
  disabled = false,
  authorized = false,
  onAuthorized,
}: {
  serverId: string;
  provider: string;
  disabled?: boolean;
  authorized?: boolean;
  onAuthorized?: () => Promise<void>;
}) {
  const { t } = useLocale();
  const [login, setLogin] = useState<ProviderAuthReply | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [approved, setApproved] = useState(false);
  const [code, setCode] = useState("");
  const [exchanging, setExchanging] = useState(false);
  const callback = useRef(onAuthorized);
  const currentSession = useRef<string | null>(null);
  const generation = useRef(0);
  const completed = useRef(false);
  useEffect(() => {
    callback.current = onAuthorized;
  }, [onAuthorized]);
  useEffect(() => {
    generation.current++;
    return () => {
      generation.current++;
      const session = currentSession.current;
      currentSession.current = null;
      if (session) void api.providerAuth(serverId, provider, "cancel", session).catch(() => {});
    };
  }, [provider, serverId]);

  async function authorizedAccount() {
    if (callback.current) await callback.current();
    else
      await api.applySetup(serverId, {
        apiKey: "",
        telegramToken: "",
        telegramAllowedUsers: "",
        values: [],
      });
  }
  useEffect(() => {
    if (!login?.session_id || completed.current) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const result = await api.providerAuth(serverId, provider, "poll", login?.session_id);
        if (!active) return;
        if (result.status === "approved") {
          completed.current = true;
          currentSession.current = null;
          setCode("");
          setError(null);
          setExchanging(true);
          await authorizedAccount();
          if (active) {
            setApproved(true);
            setExchanging(false);
          }
        } else if (
          result.status &&
          !["pending", "starting", "exchanging"].includes(result.status)
        ) {
          currentSession.current = null;
          setError(
            new Error(
              result.status === "expired"
                ? "Sign-in expired. Start again to get a new link."
                : "Sign-in ended without authorization. Please try again.",
            ),
          );
          setCode("");
          setLogin(null);
          setExchanging(false);
        } else timer = setTimeout(() => void poll(), Math.max(2, login?.poll_interval ?? 3) * 1000);
      } catch (error) {
        if (active) {
          setError(error);
          if (completed.current) {
            setApproved(true);
            setExchanging(false);
          }
          // A transient SSH error does not invalidate the native sign-in session.
          if (!completed.current) timer = setTimeout(() => void poll(), 5000);
        }
      }
    }
    timer = setTimeout(() => void poll(), Math.max(2, login?.poll_interval ?? 3) * 1000);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [login, provider, serverId]);

  async function start() {
    const current = generation.current;
    setBusy(true);
    setError(null);
    setApproved(false);
    setCode("");
    completed.current = false;
    setExchanging(false);
    try {
      const next = await api.providerAuth(serverId, provider, "start");
      if (current !== generation.current) {
        if (next.session_id)
          void api.providerAuth(serverId, provider, "cancel", next.session_id).catch(() => {});
        return;
      }
      if (next.status === "approved") {
        completed.current = true;
        await authorizedAccount();
        if (current === generation.current) setApproved(true);
        return;
      }
      if (!next.session_id || !next.verification_url)
        throw new Error("Hermes returned an incomplete sign-in session. Update Hermes and retry.");
      currentSession.current = next.session_id;
      setLogin(next);
      await openExternal(next.verification_url).catch(() => {});
    } catch (error) {
      if (current === generation.current) setError(error);
    } finally {
      if (current === generation.current) setBusy(false);
    }
  }
  async function submit() {
    if (!login?.session_id || !code.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await api.providerAuth(serverId, provider, "submit", login.session_id, code.trim());
      setCode("");
      setExchanging(true);
    } catch (error) {
      setError(error);
    } finally {
      setBusy(false);
    }
  }
  if (!browserLoginProviders.has(provider)) return null;
  return (
    <div className="provider-sign-in">
      <strong>
        {t("Connect {provider} account", { provider: selectedProvider(provider).name })}
      </strong>
      <p>{t("Authorize in your system browser. Hermes keeps account credentials on your VPS.")}</p>
      {approved ? (
        <p role="status" className="saved-message">
          <Check />
          {t(
            onAuthorized
              ? "Account authorized. Apply changes to use this connection."
              : "Account authorized. Applying your model settings…",
          )}
        </p>
      ) : login ? (
        <div className="provider-sign-in-code">
          <p role="status">
            {t(
              login.flow === "paste_code"
                ? "Approve access in your browser, then paste the returned URL or code below."
                : "Enter this code on the provider website. This screen updates after approval.",
            )}
          </p>
          {login.user_code && <code>{login.user_code}</code>}
          {login.verification_url && (
            <ExternalLink url={login.verification_url}>{t("Open sign-in page")}</ExternalLink>
          )}
          {login.flow === "paste_code" && (
            <Field>
              <FieldLabel htmlFor="oauth-callback">
                {t("Callback URL or authorization code")}
              </FieldLabel>
              <Input
                id="oauth-callback"
                type="password"
                autoComplete="off"
                spellCheck={false}
                value={code}
                maxLength={4096}
                disabled={busy || exchanging || disabled}
                onChange={(event) => setCode(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void submit();
                  }
                }}
              />
              <FieldDescription>
                {t(
                  provider === "anthropic"
                    ? "Paste the full code including #state, or the complete callback URL. It is sent only to your server."
                    : provider === "antigravity-oauth"
                      ? "Paste the code shown by Google promptly: the CLI link expires quickly. Google agy stores the session and runs its standard sign-in verification."
                      : "Paste the code shown by OpenRouter. It is sent only to your server.",
                )}
              </FieldDescription>
              <Button
                type="button"
                disabled={busy || exchanging || !code.trim() || disabled}
                onClick={() => void submit()}
              >
                {busy || exchanging ? (
                  <Busy>{t("Completing sign-in…")}</Busy>
                ) : (
                  t("Complete sign-in")
                )}
              </Button>
            </Field>
          )}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              const session = currentSession.current;
              currentSession.current = null;
              if (session)
                void api.providerAuth(serverId, provider, "cancel", session).catch(() => {});
              setLogin(null);
              setCode("");
              setExchanging(false);
              setError(null);
            }}
          >
            {t("Cancel")}
          </Button>
        </div>
      ) : (
        <>
          {authorized && (
            <p className="saved-message">
              <Check />
              {t("Account connected on server")}
            </p>
          )}
          <Button
            type="button"
            variant="outline"
            disabled={busy || disabled}
            onClick={() => void start()}
          >
            {busy ? (
              <Busy>{t("Preparing sign-in…")}</Busy>
            ) : (
              <>
                <LogIn data-icon="inline-start" />
                {t(
                  authorized
                    ? provider === "antigravity-oauth"
                      ? "Check connection"
                      : "Sign in again"
                    : "Sign in with browser",
                )}
              </>
            )}
          </Button>
        </>
      )}
      {!!error && (
        <Notice error title="Sign-in failed">
          <span lang="en" translate="no">
            {errorMessage(error)}
          </span>
          {approved && (
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setError(null);
                void authorizedAccount().catch(setError);
              }}
            >
              {t("Refresh authorization status")}
            </Button>
          )}
        </Notice>
      )}
    </div>
  );
}
