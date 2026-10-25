#!/bin/sh
set -eu
umask 077
ROOT=/var/lib/hermes-companion
install -d -m 700 "$ROOT"
exec 8>"$ROOT/launch.lock"
if ! flock -n 8; then printf 'busy\n'; exit 0; fi
exec 9>"$ROOT/install.lock"
if ! flock -n 9; then printf 'busy\n'; exit 0; fi
if systemctl is-active --quiet hermes-companion-install.service; then
    printf 'busy\n'
    exit 0
fi
if systemctl is-active --quiet hermes-companion-reboot.timer; then
    printf 'reboot_scheduled\n'
    exit 0
fi
# A transient timer lets SSH acknowledge the request before the server shuts down.
if systemd-run --quiet --unit=hermes-companion-reboot --on-active=5s \
    --timer-property=AccuracySec=1s --collect /usr/sbin/reboot; then
    printf 'reboot_scheduled\n'
else
    printf 'failed\n'
fi
