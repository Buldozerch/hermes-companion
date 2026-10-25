set -eu
if [ ! -r /etc/os-release ]; then exit 10; fi
. /etc/os-release
printf 'hostname=%s\n' "$(hostname)"
printf 'os_name=%s\n' "${PRETTY_NAME:-Linux}"
printf 'os_id=%s\n' "${ID:-unknown}"
printf 'os_version=%s\n' "${VERSION_ID:-unknown}"
printf 'architecture=%s\n' "$(uname -m)"
printf 'memory_mb=%s\n' "$(awk '/MemTotal/ {printf "%.0f", $2/1024}' /proc/meminfo)"
printf 'disk_available_mb=%s\n' "$(df -Pm / | awk 'NR==2 {print $4}')"
printf 'cpu_count=%s\n' "$(getconf _NPROCESSORS_ONLN)"
if [ -d /run/systemd/system ]; then printf 'systemd=yes\n'; else printf 'systemd=no\n'; fi
if [ "$(id -u)" = 0 ] || sudo -n true 2>/dev/null; then printf 'admin=yes\n'; else printf 'admin=no\n'; fi
if command -v hermes >/dev/null 2>&1; then
    printf 'hermes_version=%s\n' "$(hermes --version 2>/dev/null | head -n 1)"
elif [ -d /home/hermes/.hermes/hermes-agent ]; then
    printf 'hermes_version=Installation detected\n'
else
    printf 'hermes_version=\n'
fi
