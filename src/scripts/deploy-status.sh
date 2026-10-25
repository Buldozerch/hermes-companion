#!/bin/sh
set -eu
ROOT=/var/lib/hermes-companion
printf 'managed=%s\n' "$(test -f "$ROOT/managed" && echo yes || echo no)"
printf 'service_active=%s\n' "$(systemctl is-active --quiet hermes-companion-agent.service && echo yes || echo no)"
printf 'service_installed=%s\n' "$(test -f /etc/systemd/system/hermes-companion-agent.service && echo yes || echo no)"
printf 'model_configured=%s\n' "$(test -f "$ROOT/model-configured" && echo yes || echo no)"
printf 'reboot_required=%s\n' "$(test -f /var/run/reboot-required && echo yes || echo no)"
JOB_ID=$(cat "$ROOT/latest-job" 2>/dev/null || true)
case "$JOB_ID" in
    ''|*[!0-9a-f-]*) printf 'state=none\n'; exit 0 ;;
esac
JOB="$ROOT/jobs/$JOB_ID"
printf 'job_id=%s\n' "$JOB_ID"
if [ -r "$JOB/state" ]; then cat "$JOB/state"; else printf 'state=starting\n'; fi
printf 'checked_at=%s\n' "$(date +%s)"
if [ -f "$JOB/installer.log" ]; then
    printf 'output_updated_at=%s\n' "$(stat -c %Y "$JOB/installer.log")"
fi
if [ -r "$JOB/state" ] && grep -Eq '^state=(running|starting)$' "$JOB/state" && \
    ! systemctl is-active --quiet hermes-companion-install.service; then
    printf 'state=interrupted\n'
fi
if [ -f "$ROOT/version" ]; then printf 'installed_version=%s\n' "$(head -n 1 "$ROOT/version")"; fi
printf 'api_healthy=%s\n' "$(check_api >/dev/null 2>&1 && echo yes || echo no)"
printf '__EVENTS__\n'
tail -n 80 "$JOB/events.log" 2>/dev/null || true
