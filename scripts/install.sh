#!/usr/bin/env bash
# Installs LAICron as a systemd user service and adds its desktop entry.
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"

fail() {
  printf 'Error: %s\n' "$*" >&2
  exit 1
}

command -v node >/dev/null 2>&1 || fail "Node.js no está instalado o no está en el PATH."
command -v pnpm >/dev/null 2>&1 || fail "pnpm no está instalado o no está en el PATH."
command -v systemctl >/dev/null 2>&1 || fail "systemctl no está disponible; LAICron necesita systemd."

cd -- "${REPO_ROOT}"

printf 'Instalando dependencias...\n'
pnpm install --frozen-lockfile

printf 'Compilando el proyecto...\n'
pnpm build

printf 'Instalando el servicio de usuario y la entrada de escritorio...\n'
node packages/platform/linux/dist/service-installer.js install

if ! systemctl --user is-active --quiet laicron; then
  printf 'Error: el servicio laicron no está activo.\n' >&2
  printf 'Últimas líneas del registro:\n' >&2
  journalctl --user -u laicron -n 20 --no-pager || true
  exit 1
fi

printf '\nLAICron está instalado y activo.\n'
printf 'Binario: %s\n' "${HOME}/.local/bin/laicron"
printf 'Interfaz web: http://%s:%s/\n' "${LAICRON_HOST:-127.0.0.1}" "${LAICRON_PORT:-7317}"
