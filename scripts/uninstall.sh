#!/usr/bin/env bash
# Stops and removes the LAICron systemd user service and desktop entry.
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"

fail() {
  printf 'Error: %s\n' "$*" >&2
  exit 1
}

command -v node >/dev/null 2>&1 || fail "Node.js no está instalado o no está en el PATH."
command -v systemctl >/dev/null 2>&1 || fail "systemctl no está disponible; LAICron necesita systemd."

PURGE_DATA=0
if [[ "${LAICRON_PURGE_DATA:-}" == "1" ]]; then
  PURGE_DATA=1
else
  printf '¿Borrar también la base de datos y el historial? [s/N] '
  read -r answer || answer=""
  case "${answer,,}" in
    s | si | sí) PURGE_DATA=1 ;;
  esac
fi

cd -- "${REPO_ROOT}"

INSTALLER="packages/platform/linux/dist/service-installer.js"
[[ -f "${INSTALLER}" ]] || fail "No se encuentra ${INSTALLER}. Ejecuta scripts/install.sh primero."

ARGS=(uninstall)
if [[ "${PURGE_DATA}" == "1" ]]; then
  ARGS+=(--purge-data)
fi

node "${INSTALLER}" "${ARGS[@]}"

printf 'LAICron se ha desinstalado.\n'
if [[ "${PURGE_DATA}" != "1" ]]; then
  printf 'La base de datos y el historial se conservan en %s\n' "${HOME}/.local/share/laicron"
fi
