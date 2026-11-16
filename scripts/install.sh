#!/usr/bin/env bash
# Installs LAICron as a systemd user service and adds its desktop entry.
set -euo pipefail

# Resolve the message language once: LAICRON_LANG wins, then the POSIX vars.
LANG_TAG="$(
  printf '%s' "${LAICRON_LANG:-${LC_ALL:-${LC_MESSAGES:-${LANG:-}}}}" |
    tr '[:upper:]' '[:lower:]' | tr '_' '-' | cut -d. -f1
)"
case "${LANG_TAG}" in
  en | en-*) LAICRON_ENGLISH=1 ;;
  *) LAICRON_ENGLISH=0 ;;
esac

say() {
  # say "<spanish>" "<english>"
  if [[ "${LAICRON_ENGLISH}" == "1" ]]; then
    printf '%s\n' "$2"
  else
    printf '%s\n' "$1"
  fi
}

fail() {
  # fail "<spanish>" "<english>"
  if [[ "${LAICRON_ENGLISH}" == "1" ]]; then
    printf 'Error: %s\n' "$2" >&2
  else
    printf 'Error: %s\n' "$1" >&2
  fi
  exit 1
}

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"

command -v node >/dev/null 2>&1 ||
  fail "Node.js no está instalado o no está en el PATH." "Node.js is not installed or not in PATH."
command -v pnpm >/dev/null 2>&1 ||
  fail "pnpm no está instalado o no está en el PATH." "pnpm is not installed or not in PATH."
command -v systemctl >/dev/null 2>&1 ||
  fail "systemctl no está disponible; LAICron necesita systemd." "systemctl is not available; LAICron needs systemd."

cd -- "${REPO_ROOT}"

say 'Instalando dependencias...' 'Installing dependencies...'
pnpm install --frozen-lockfile

say 'Compilando el proyecto...' 'Building the project...'
pnpm build

say 'Instalando el servicio de usuario y la entrada de escritorio...' \
  'Installing the user service and the desktop entry...'
node packages/platform/linux/dist/service-installer.js install

if ! systemctl --user is-active --quiet laicron; then
  say 'Error: el servicio laicron no está activo.' 'Error: the laicron service is not active.' >&2
  say 'Últimas líneas del registro:' 'Last log lines:' >&2
  journalctl --user -u laicron -n 20 --no-pager || true
  exit 1
fi

say '' ''
say 'LAICron está instalado y activo.' 'LAICron is installed and active.'
say "Binario: ${HOME}/.local/bin/laicron" "Binary: ${HOME}/.local/bin/laicron"
say "Interfaz web: http://${LAICRON_HOST:-127.0.0.1}:${LAICRON_PORT:-7317}/" \
  "Web interface: http://${LAICRON_HOST:-127.0.0.1}:${LAICRON_PORT:-7317}/"
