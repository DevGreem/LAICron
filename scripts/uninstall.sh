#!/usr/bin/env bash
# Stops and removes the LAICron systemd user service and desktop entry.
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
command -v systemctl >/dev/null 2>&1 ||
  fail "systemctl no está disponible; LAICron necesita systemd." "systemctl is not available; LAICron needs systemd."

PURGE_DATA=0
if [[ "${LAICRON_PURGE_DATA:-}" == "1" ]]; then
  PURGE_DATA=1
else
  if [[ "${LAICRON_ENGLISH}" == "1" ]]; then
    printf 'Also delete the database and history? [y/N] '
  else
    printf '¿Borrar también la base de datos y el historial? [s/N] '
  fi
  read -r answer || answer=""
  case "${answer,,}" in
    s | si | sí | y | yes) PURGE_DATA=1 ;;
  esac
fi

cd -- "${REPO_ROOT}"

INSTALLER="packages/platform/linux/dist/service-installer.js"
[[ -f "${INSTALLER}" ]] ||
  fail "No se encuentra ${INSTALLER}. Ejecuta scripts/install.sh primero." "${INSTALLER} not found. Run scripts/install.sh first."

ARGS=(uninstall)
if [[ "${PURGE_DATA}" == "1" ]]; then
  ARGS+=(--purge-data)
fi

node "${INSTALLER}" "${ARGS[@]}"

say 'LAICron se ha desinstalado.' 'LAICron has been uninstalled.'
if [[ "${PURGE_DATA}" != "1" ]]; then
  say "La base de datos y el historial se conservan en ${HOME}/.local/share/laicron" \
    "The database and history are kept in ${HOME}/.local/share/laicron"
fi
