#!/usr/bin/env bash
set -Eeuo pipefail
export LC_ALL=C.UTF-8 LANG=C.UTF-8 DEBIAN_FRONTEND=noninteractive
umask 077
cd -- "$(dirname -- "$0")"
JOB_DIR=$PWD
ROOT=/var/lib/hermes-companion
STEP=system
STARTED=$(date +%s)
VERSION=
COMMIT=
OPERATION=$(cat operation)
case "$OPERATION" in install|configure|provider|update) ;; *) exit 1 ;; esac
TEMP_SWAP=no
UPDATE_STOPPED=no
SWAP_FILE=$ROOT/install.swap
exec 9>"$ROOT/install.lock"

state() {
    printf 'state=%s\nstep=%s\nstarted_at=%s\nupdated_at=%s\nversion=%s\ncommit=%s\noperation=%s\n' \
        "$1" "$STEP" "$STARTED" "$(date +%s)" "$VERSION" "$COMMIT" "$OPERATION" > state.tmp
    mv -f state.tmp state
}
event() { printf '%s %s\n' "$(date -u +%FT%TZ)" "$1" >> events.log; }
cleanup() {
    rm -f input.json
    if [ "$TEMP_SWAP" = yes ]; then
        if swapoff "$SWAP_FILE" >> installer.log 2>&1; then
            rm -f "$SWAP_FILE"
            event 'Temporary installation swap removed.'
        else
            event 'Temporary swap remains active because it could not be released safely.'
        fi
    fi
}
trap cleanup EXIT
failed() {
    trap - ERR TERM INT
    rm -f input.json
    state failed || true
    event "Server operation $OPERATION failed during step: $STEP. Review the diagnostic output and retry."
    if [ "$UPDATE_STOPPED" = yes ]; then
        if systemctl restart hermes-companion-agent.service >> installer.log 2>&1; then
            event 'Restarted the Hermes service after the interrupted update. Check live service health before using it.'
        else
            event 'The Hermes service could not restart. Review the updater log and private backup before retrying.'
        fi
    fi
    exit 1
}
trap failed ERR TERM INT
flock -n 9 || { event 'Another installation is already running.'; failed; }
state running

. /etc/os-release
if [ "${ID:-}" != ubuntu ] || [ "${VERSION_ID:-}" != 24.04 ] || [ ! -d /run/systemd/system ]; then
    event 'This installer requires Ubuntu 24.04 LTS with systemd.'
    failed
fi
if [ "$(df -Pm / | awk 'NR==2 {print $4}')" -lt 1024 ]; then
    event 'Free at least 1 GB on the system disk before starting installation.'
    failed
fi
if [ "$OPERATION" = update ]; then
    test -f "$ROOT/managed"
    test -x /home/hermes/.local/bin/hermes
    STEP=backup
    state running
    event 'Creating a private configuration and account backup before updating Hermes.'
    install -d -m 700 "$ROOT/backups/$STARTED"
    # Back up the profile independently of the native updater; do not archive its source/runtime.
    tar --exclude='./hermes-agent' --exclude='./cache' --exclude='./logs' --exclude='./sessions' \
        --exclude='./.venv' -C /home/hermes/.hermes -czf "$ROOT/backups/$STARTED/profile.tar.gz" .
    STEP=install
    state running
    event 'Updating Hermes through its official stable-channel updater.'
    # Stop the root-owned unit here; the unprivileged native updater cannot control it.
    UPDATE_STOPPED=yes
    systemctl stop hermes-companion-agent.service
    runuser -u hermes -- env HOME=/home/hermes HERMES_HOME=/home/hermes/.hermes \
        PATH=/home/hermes/.local/bin:/usr/local/bin:/usr/bin:/bin CI=1 \
        /home/hermes/.local/bin/hermes update --channel stable --yes --backup --no-gateway-restart >> installer.log 2>&1
    VERSION=$(runuser -u hermes -- git -C /home/hermes/.hermes/hermes-agent describe --tags --exact-match HEAD)
    COMMIT=$(runuser -u hermes -- git -C /home/hermes/.hermes/hermes-agent rev-parse HEAD)
elif [ "$OPERATION" = install ]; then
event 'Preparing Ubuntu packages.'
if [ "$(cat update-system)" = yes ]; then
    apt-get -o DPkg::Lock::Timeout=180 update >> installer.log 2>&1
    apt-get -o DPkg::Lock::Timeout=180 -o Dpkg::Options::=--force-confold upgrade -y >> installer.log 2>&1
fi
apt-get -o DPkg::Lock::Timeout=180 update >> installer.log 2>&1
apt-get -o DPkg::Lock::Timeout=180 install -y --no-install-recommends \
    ca-certificates curl git tar xz-utils python3 build-essential libatomic1 libssl-dev libffi-dev >> installer.log 2>&1
apt-get clean

# Source installs build the bundled web UI even when browser automation is disabled.
MEMORY_MB=$(awk '/MemTotal/ {printf "%.0f", $2/1024}' /proc/meminfo)
if [ "$MEMORY_MB" -lt 1800 ]; then
    export NODE_OPTIONS=--max-old-space-size=512
    if [ "$(awk '/SwapTotal/ {print $2}' /proc/meminfo)" = 0 ] && \
        [ "$(df -Pm / | awk 'NR==2 {print $4}')" -gt 2304 ]; then
        if [ -L "$SWAP_FILE" ]; then event 'Refusing a symlink at the temporary swap path.'; failed; fi
        fallocate -l 1G "$SWAP_FILE"
        chmod 600 "$SWAP_FILE"
        mkswap "$SWAP_FILE" >> installer.log 2>&1
        swapon "$SWAP_FILE"
        TEMP_SWAP=yes
        event 'Enabled 1 GB of temporary swap for the source build.'
    fi
fi

STEP=user
state running
event 'Preparing the dedicated Hermes user.'
if [ ! -f "$ROOT/managed" ]; then
    if getent passwd hermes >/dev/null || [ -e /home/hermes ]; then
        event 'The hermes account or home already exists and is not managed by this application.'
        failed
    fi
    touch "$ROOT/managed"
fi
if ! getent passwd hermes >/dev/null; then
    useradd --create-home --home-dir /home/hermes --shell /bin/bash hermes
fi
if [ "$(id -u hermes)" = 0 ] || id -nG hermes | tr ' ' '\n' | grep -Eq '^(sudo|admin|wheel)$'; then
    event 'The Hermes service account must not have administrator privileges.'
    failed
fi
install -d -o hermes -g hermes -m 700 /home/hermes/.hermes

STEP=install
state running
event 'Resolving the latest stable Hermes release.'
if [ ! -s release.json ]; then
    curl --fail --silent --show-error --location --retry 3 --connect-timeout 15 --max-time 90 \
        https://api.github.com/repos/NousResearch/hermes-agent/releases/latest -o release.json
fi
VERSION=$(python3 -c 'import json,re; v=json.load(open("release.json"))["tag_name"]; assert re.fullmatch(r"v[0-9]+\.[0-9]+\.[0-9]+",v); print(v)')
if [ ! -s commit.json ]; then
    curl --fail --silent --show-error --location --retry 3 --connect-timeout 15 --max-time 90 \
        "https://api.github.com/repos/NousResearch/hermes-agent/commits/$VERSION" -o commit.json
fi
COMMIT=$(python3 -c 'import json,re; v=json.load(open("commit.json"))["sha"]; assert re.fullmatch(r"[0-9a-f]{40}",v); print(v)')
state running
event "Installing Hermes $VERSION at commit $COMMIT."
curl --fail --silent --show-error --location --retry 3 --connect-timeout 15 --max-time 120 \
    "https://raw.githubusercontent.com/NousResearch/hermes-agent/$COMMIT/scripts/install.sh" -o official-install.sh
install -o hermes -g hermes -m 700 official-install.sh /home/hermes/.hermes/companion-install.sh
FEATURES=()
if [ "$(cat browser)" != yes ]; then FEATURES+=(--skip-browser); fi
if [ "$(cat computer-use)" != yes ]; then FEATURES+=(--skip-computer-use); fi
runuser -u hermes -- env HOME=/home/hermes HERMES_HOME=/home/hermes/.hermes \
    CI=1 UV_CONCURRENT_DOWNLOADS=2 UV_CONCURRENT_BUILDS=1 CARGO_BUILD_JOBS=1 \
    bash /home/hermes/.hermes/companion-install.sh --channel stable --commit "$COMMIT" \
    --non-interactive "${FEATURES[@]}" >> installer.log 2>&1
test "$(runuser -u hermes -- git -C /home/hermes/.hermes/hermes-agent rev-parse HEAD)" = "$COMMIT"
test -x /home/hermes/.local/bin/hermes
else
    test -f "$ROOT/managed"
    test -x /home/hermes/.local/bin/hermes
    VERSION=$(cat "$ROOT/version")
    COMMIT=$(cat "$ROOT/commit")
    event 'Applying configuration to the existing Hermes installation.'
fi

STEP=configure
state running
if [ "$OPERATION" = update ]; then
    event 'Preserving existing model, messenger, account and tool settings.'
elif [ "$OPERATION" = provider ]; then
    event 'Installing the optional Antigravity CLI and Hermes provider plugin.'
    python3 prepare-provider.py >> installer.log 2>&1
else
    event 'Writing model settings and selected integrations.'
    python3 configure.py >> installer.log 2>&1
fi
rm -f input.json

STEP=service
state running
event 'Starting the Hermes gateway as an unprivileged system service.'
if [ "$OPERATION" != update ]; then
HERMES_UID=$(id -u hermes)
loginctl enable-linger hermes
systemctl start "user@$HERMES_UID.service"
cat > /etc/systemd/system/hermes-companion-agent.service <<UNIT
[Unit]
Description=Hermes Agent managed by Hermes Companion
After=network-online.target user@$HERMES_UID.service
Wants=network-online.target user@$HERMES_UID.service
StartLimitIntervalSec=120
StartLimitBurst=5

[Service]
Type=simple
User=hermes
Group=hermes
WorkingDirectory=/home/hermes/.hermes
Environment=HOME=/home/hermes
Environment=USER=hermes
Environment=LOGNAME=hermes
Environment=HERMES_HOME=/home/hermes/.hermes
Environment=XDG_RUNTIME_DIR=/run/user/$HERMES_UID
Environment=DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/$HERMES_UID/bus
Environment=HERMES_SUPERVISED_CHILD=1
Environment=LANG=C.UTF-8
Environment=PATH=/home/hermes/.local/bin:/usr/local/bin:/usr/bin:/bin
ExecStart=/home/hermes/.local/bin/hermes gateway run
Restart=on-failure
RestartSec=5
KillMode=mixed
TimeoutStopSec=90
UMask=0077
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable hermes-companion-agent.service >> installer.log 2>&1
fi
systemctl restart hermes-companion-agent.service
UPDATE_STOPPED=no
for attempt in $(seq 1 90); do
    if python3 health.py >/dev/null 2>&1 && systemctl is-active --quiet hermes-companion-agent.service; then break; fi
    sleep 2
done
python3 health.py >> installer.log 2>&1
systemctl is-active --quiet hermes-companion-agent.service
printf '%s\n' "$VERSION" > "$ROOT/version"
printf '%s\n' "$COMMIT" > "$ROOT/commit"
STEP=complete
state succeeded
event "Server operation $OPERATION completed. The Hermes service and loopback API are healthy."
if [ ! -f "$ROOT/model-configured" ]; then
    event 'Model credentials are not configured. Add a provider API key before requesting a model response.'
fi
if [ -f /var/run/reboot-required ]; then event 'Ubuntu reports that a server reboot is required.'; fi
