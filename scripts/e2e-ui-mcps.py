#!/usr/bin/env python3
"""End-to-end check of the per-cron MCP selection (add-mcp-selection).

It drives the real GTK3 + WebKit2 window against temporary daemons and checks:

* 4.1 / 4.2 - the MCP table lists the global and project servers for the chosen
  ``cwd``, shows the catalog default, pins the chosen states and saves
  ``mcpOverrides`` through the API.
* 5.1 - "Ejecutar ahora" sends ``OPENCODE_CONFIG_CONTENT`` with only the pinned
  servers, leaves the global opencode configuration untouched and sends nothing
  for inherited servers.
* 3.1 - a cron with an empty ``mcpOverrides`` runs without the variable.
* 2.2 / 4.2 - a daemon without ``opencode`` shows the MCP notice, keeps the saved
  states and still saves the cron.

The script starts its own Xvfb display, its own fake ``opencode`` executable and
its own daemons, all with temporary directories and free ports:

    python3 scripts/e2e-ui-mcps.py

It exits 0 when every case passes and 1 otherwise. No repository path is
assumed: the UI root and the daemon entry point are resolved from this file.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import signal
import socket
import sqlite3
import subprocess
import sys
import tempfile
import time
from contextlib import closing
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, urlopen

# GDK picks its backend when `gi.repository.Gtk` is imported, so the modules are
# loaded by `load_gtk()` after Xvfb is ready and DISPLAY/GDK_BACKEND are set.
GLib: Any = None
Gtk: Any = None
WebKit2: Any = None

SCREEN_SIZE = "1440x1000x24"
CATALOG_MODEL = "opencode/deepseek-v4.1-flash"
PROJECT_DIR_NAME = "proyecto-mcp"

# Servers printed by the fake `opencode mcp list` in the project directory.
GLOBAL_MCPS = ["github", "xerj", "roto", "super-productivity"]
PROJECT_MCPS = GLOBAL_MCPS + ["proyecto"]

# Default label and whether the fake reports the server as enabled.
EXPECTED_DEFAULTS: dict[str, tuple[str, bool]] = {
    "github": ("Encendido", True),
    "xerj": ("Apagado", False),
    # A failed connection is still a configured (enabled) server.
    "roto": ("Encendido", True),
    "super-productivity": ("Encendido", True),
    "proyecto": ("Encendido", True),
}

EXPECTED_OVERRIDES = {"github": "on", "xerj": "off"}
EXPECTED_OVERLAY = '{"mcp":{"servers":{"github":{"disabled":false},"xerj":{"disabled":true}}}}'
GLOBAL_CONFIG_PATH = os.path.expanduser("~/.config/opencode/opencode.jsonc")

FAKE_OPENCODE = """#!/bin/sh
case "$1" in
  models) echo "opencode/deepseek-v4.1-flash" ;;
  debug)  [ "$2" = "agents" ] && printf '[{"id":"build","name":"build","description":"","mode":"all","system":"no-debe-salir"}]\\n' ;;
  mcp)
    if [ "$2" = "list" ]; then
      echo "✓ github              connected"
      echo "○ xerj                disabled"
      echo "✗ roto                failed: boom"
      echo "✓ super-productivity  connected"
      if [ "$(basename "$PWD")" = "proyecto-mcp" ]; then
        echo "✓ proyecto            connected"
      fi
    fi
    ;;
  run)
    if [ -n "$CAPTURE" ]; then printf '%s' "$OPENCODE_CONFIG_CONTENT" > "$CAPTURE"; fi
    printf '{"type":"text","part":{"text":"ok-mcp"}}\\n'
    ;;
esac
exit 0
"""


class UiError(RuntimeError):
    """A check failed or the window could not be driven."""


def load_gtk() -> None:
    """Imports GTK/WebKit2 once DISPLAY and GDK_BACKEND are set."""
    global GLib, Gtk, WebKit2

    try:
        import gi

        gi.require_version("Gtk", "3.0")
        gi.require_version("WebKit2", "4.1")
        from gi.repository import GLib as GLibModule
        from gi.repository import Gtk as GtkModule
        from gi.repository import WebKit2 as WebKit2Module
    except (ImportError, ValueError) as exc:
        raise UiError(f"no se pudo cargar GTK3/WebKit2: {exc}") from exc

    GLib = GLibModule
    Gtk = GtkModule
    WebKit2 = WebKit2Module


# ---------------------------------------------------------------------------
# GLib / WebKit2 driver
# ---------------------------------------------------------------------------


def pump(seconds: float) -> None:
    """Keep the GLib main context alive while waiting."""
    context = GLib.MainContext.default()
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        while context.pending():
            context.iteration(False)
        time.sleep(0.02)


class WindowDriver:
    """Thin synchronous wrapper around a GTK window with a WebKit2 view."""

    def __init__(self, base_url: str, token: str) -> None:
        self.base_url = base_url.rstrip("/")
        self.token = token
        self.window = Gtk.Window(title="LAICron e2e MCPs")
        self.window.set_default_size(1280, 900)
        self.webview = WebKit2.WebView()
        settings = self.webview.get_settings()
        settings.set_property("enable-developer-extras", True)
        self.window.add(self.webview)
        self.window.show_all()
        self.window.present()

        self._load_state: dict[str, Any] = {"done": False, "error": None}
        self._load_loop: GLib.MainLoop | None = None
        self.webview.connect("load-changed", self._on_load_changed)
        self.webview.connect("load-failed", self._on_load_failed)

    # -- loading ---------------------------------------------------------

    def _on_load_changed(self, _view: WebKit2.WebView, event: WebKit2.LoadEvent) -> None:
        if event == WebKit2.LoadEvent.FINISHED:
            self._load_state["done"] = True
            if self._load_loop is not None:
                self._load_loop.quit()

    def _on_load_failed(
        self,
        _view: WebKit2.WebView,
        _event: WebKit2.LoadEvent,
        failing_uri: str,
        error: GLib.Error,
    ) -> bool:
        self._load_state["error"] = f"{failing_uri}: {error.message}"
        if self._load_loop is not None:
            self._load_loop.quit()
        return False

    def open(self, timeout: float) -> None:
        url = f"{self.base_url}/#token={quote(self.token, safe='')}"
        loop = GLib.MainLoop()
        self._load_loop = loop

        def on_timeout() -> bool:
            self._load_state["error"] = "timeout cargando la página"
            loop.quit()
            return False

        timer = GLib.timeout_add(int(timeout * 1000), on_timeout)
        self.webview.load_uri(url)
        loop.run()
        if GLib.MainContext.default().find_source_by_id(timer) is not None:
            GLib.source_remove(timer)
        self._load_loop = None
        if self._load_state["error"] is not None:
            raise UiError(f"no se pudo cargar {url}: {self._load_state['error']}")

    # -- JavaScript ------------------------------------------------------

    def js(self, script: str, timeout: float = 30.0) -> str:
        """Runs `script` and returns the raw string form of its last value."""
        box: dict[str, Any] = {"raw": None, "error": None}
        loop = GLib.MainLoop()
        modern = hasattr(self.webview, "evaluate_javascript")

        def on_done(view: WebKit2.WebView, result: Any, _data: Any) -> None:
            try:
                if modern:
                    value = view.evaluate_javascript_finish(result)
                else:  # pragma: no cover - old WebKit2GTK fallback
                    js_result = view.run_javascript_finish(result)
                    value = js_result.get_js_value() if js_result is not None else None
                try:
                    box["raw"] = value.to_string() if value is not None else ""
                except Exception:  # pragma: no cover - defensive
                    box["raw"] = ""
            except GLib.Error as exc:
                box["error"] = exc.message
            except Exception as exc:  # pragma: no cover - defensive
                box["error"] = f"fallo leyendo el resultado de JS: {exc}"
            finally:
                loop.quit()

        def on_timeout() -> bool:
            box["error"] = "timeout ejecutando JavaScript"
            loop.quit()
            return False

        timer = GLib.timeout_add(int(timeout * 1000), on_timeout)
        if modern:
            self.webview.evaluate_javascript(script, -1, None, None, None, on_done, None)
        else:  # pragma: no cover - old WebKit2GTK fallback
            self.webview.run_javascript(script, None, on_done, None)
        loop.run()
        if GLib.MainContext.default().find_source_by_id(timer) is not None:
            GLib.source_remove(timer)
        if box["error"] is not None:
            raise UiError(str(box["error"]))
        return str(box["raw"])

    def eval_json(self, body: str, timeout: float = 30.0) -> Any:
        """Evaluates a JS function body and decodes its JSON result."""
        script = f"JSON.stringify((function(){{{body}}})())"
        raw = self.js(script, timeout=timeout)
        if raw in ("", "undefined"):
            return None
        try:
            return json.loads(raw)
        except json.JSONDecodeError as exc:
            raise UiError(f"respuesta JS no es JSON ({exc}): {raw[:500]}") from exc

    def wait_json(
        self,
        body: str,
        timeout: float,
        description: str,
        interval: float = 0.2,
    ) -> Any:
        """Polls a JS function body until it returns a truthy value."""
        deadline = time.monotonic() + timeout
        last: Any = None
        while time.monotonic() < deadline:
            value = self.eval_json(body)
            if isinstance(value, str) and value.startswith("ERR:"):
                raise UiError(f"{description}: error de JS: {value[4:]}")
            if value:
                return value
            last = value
            pump(interval)
        raise UiError(f"{description}: tiempo agotado (último valor: {last!r})")

    def snippet(self) -> str:
        """Best-effort dump of the rendered DOM, for failure reports."""
        try:
            html = self.eval_json(
                "var main = document.querySelector('.main') || document.body;"
                "return main.innerHTML.slice(0, 4000);"
            )
        except UiError:
            return "<no se pudo leer el DOM>"
        return str(html)

    def screenshot(self, path: str) -> None:
        pump(0.6)
        targets = ["root"]
        gdk_window = self.window.get_window()
        if gdk_window is not None and hasattr(gdk_window, "get_xid"):
            # Capturing the window itself avoids the black Xvfb background.
            targets.insert(0, hex(gdk_window.get_xid()))

        errors: list[str] = []
        for target in targets:
            try:
                subprocess.run(
                    ["import", "-window", target, path],
                    check=True,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    timeout=30,
                )
                return
            except (OSError, subprocess.SubprocessError) as exc:
                errors.append(f"{target}: {exc}")
        raise UiError(f"no se pudo capturar la ventana en {path}: {'; '.join(errors)}")

    def scroll_to(self, selector: str) -> None:
        self.js(
            "var target = document.querySelector("
            + json.dumps(selector)
            + ");"
            + "if (target !== null) { target.scrollIntoView({ block: 'center' }); }"
        )
        pump(0.3)

    def close(self) -> None:
        self.window.destroy()
        pump(0.2)


# ---------------------------------------------------------------------------
# Xvfb and temporary daemons
# ---------------------------------------------------------------------------


class XvfbServer:
    """Own Xvfb display, so the check does not depend on a desktop session."""

    def __init__(self) -> None:
        self.process: subprocess.Popen[bytes] | None = None
        self.display: str | None = None

    def start(self) -> str:
        for number in range(90, 130):
            socket_path = f"/tmp/.X11-unix/X{number}"
            if os.path.exists(socket_path):
                continue
            try:
                process = subprocess.Popen(
                    ["Xvfb", f":{number}", "-screen", "0", SCREEN_SIZE, "-nolisten", "tcp"],
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                )
            except OSError as exc:
                raise UiError(f"no se pudo arrancar Xvfb: {exc}") from exc
            deadline = time.monotonic() + 5
            while time.monotonic() < deadline:
                if process.poll() is not None:
                    break
                if os.path.exists(socket_path):
                    self.process = process
                    self.display = f":{number}"
                    return self.display
                time.sleep(0.05)
            if process.poll() is None:
                process.terminate()
                try:
                    process.wait(timeout=3)
                except subprocess.TimeoutExpired:
                    process.kill()
        raise UiError("no se pudo arrancar Xvfb en ningún display libre")

    def stop(self) -> None:
        if self.process is None:
            return
        if self.process.poll() is None:
            self.process.terminate()
            try:
                self.process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self.process.kill()
        self.process = None


def free_port() -> int:
    """Returns a port that is free right now on the loopback interface."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
        probe.bind(("127.0.0.1", 0))
        return int(probe.getsockname()[1])


def repo_root_from_script() -> str:
    return os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


class Daemon:
    """A daemon process bound to its own temporary database, config and port."""

    def __init__(
        self,
        repo_root: str,
        *,
        path_prefix: str | None,
        extra_env: dict[str, str],
        timeout: float,
        keep_temp: bool,
        label: str,
    ) -> None:
        self.repo_root = repo_root
        self.main_js = os.path.join(repo_root, "packages", "daemon", "dist", "main.js")
        self.ui_root = os.environ.get("LAICRON_UI_ROOT") or os.path.join(
            repo_root, "packages", "ui", "dist"
        )
        self.path_prefix = path_prefix
        self.extra_env = extra_env
        self.timeout = timeout
        self.keep_temp = keep_temp
        self.label = label
        self.temp_dir = tempfile.mkdtemp(prefix=f"laicron-e2e-mcps-{label}-")
        self.db_path = os.path.join(self.temp_dir, "laicron.db")
        self.config_dir = os.path.join(self.temp_dir, "config")
        self.cache_dir = os.path.join(self.temp_dir, "cache")
        self.log_path = os.path.join(self.temp_dir, "daemon.log")
        self.port = free_port()
        self.token: str | None = None
        self.process: subprocess.Popen[bytes] | None = None
        self._log_handle: Any = None

        self.node = shutil.which("node")
        if self.node is None:
            raise UiError("no se encontró node en el PATH para lanzar el daemon")
        if not os.path.isfile(self.main_js):
            raise UiError(f"falta el daemon compilado: {self.main_js} (ejecuta pnpm build)")
        if not os.path.isfile(os.path.join(self.ui_root, "index.html")):
            raise UiError(f"falta la interfaz compilada: {self.ui_root} (ejecuta pnpm build)")

        env = os.environ.copy()
        env.update(
            {
                "LAICRON_DB_PATH": self.db_path,
                "LAICRON_CONFIG_DIR": self.config_dir,
                "LAICRON_UI_ROOT": self.ui_root,
                "LAICRON_PORT": str(self.port),
                "LAICRON_HOST": "127.0.0.1",
                "XDG_CACHE_HOME": self.cache_dir,
            }
        )
        if path_prefix is None:
            empty_bin = os.path.join(self.temp_dir, "empty-bin")
            os.makedirs(empty_bin, exist_ok=True)
            env["PATH"] = empty_bin
        else:
            env["PATH"] = path_prefix + os.pathsep + env.get("PATH", "")
        env.update(extra_env)
        self.env = env

    @property
    def base_url(self) -> str:
        return f"http://127.0.0.1:{self.port}"

    def log_tail(self, lines: int = 40) -> str:
        try:
            with open(self.log_path, "r", encoding="utf-8", errors="replace") as handle:
                content = handle.read().splitlines()
        except OSError:
            return "<sin log>"
        return "\n".join(content[-lines:])

    def start(self) -> None:
        os.makedirs(self.config_dir, exist_ok=True)
        os.makedirs(self.cache_dir, exist_ok=True)

        self._log_handle = open(self.log_path, "w", encoding="utf-8")
        self.process = subprocess.Popen(
            [self.node, self.main_js],
            cwd=self.repo_root,
            env=self.env,
            stdout=self._log_handle,
            stderr=subprocess.STDOUT,
            start_new_session=True,
        )

        health_url = f"{self.base_url}/api/health"
        deadline = time.monotonic() + self.timeout
        while time.monotonic() < deadline:
            if self.process.poll() is not None:
                raise UiError(
                    f"el daemon terminó con código {self.process.returncode}:\n{self.log_tail()}"
                )
            try:
                with urlopen(health_url, timeout=2) as response:  # noqa: S310 - loopback only
                    if response.status == 200:
                        break
            except (URLError, OSError):
                pass
            time.sleep(0.1)
        else:
            raise UiError(f"el daemon no respondió en {self.timeout:.0f}s:\n{self.log_tail()}")

        token_path = os.path.join(self.config_dir, "token")
        try:
            with open(token_path, "r", encoding="utf-8") as handle:
                self.token = handle.read().strip()
        except OSError as exc:
            raise UiError(f"no se pudo leer el token temporal: {exc}") from exc
        if not self.token:
            raise UiError("el daemon arrancó sin token")

        print(f"[daemon:{self.label}] {self.base_url} db={self.db_path} PATH={self.env['PATH']}")

    def stop(self) -> None:
        if self.process is not None and self.process.poll() is None:
            try:
                os.killpg(os.getpgid(self.process.pid), signal.SIGTERM)
            except ProcessLookupError:
                pass
            try:
                self.process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                try:
                    os.killpg(os.getpgid(self.process.pid), signal.SIGKILL)
                except ProcessLookupError:
                    pass
                self.process.wait(timeout=5)
        self.process = None
        if self._log_handle is not None:
            self._log_handle.close()
            self._log_handle = None
        if not self.keep_temp:
            shutil.rmtree(self.temp_dir, ignore_errors=True)


# ---------------------------------------------------------------------------
# API and SQLite helpers
# ---------------------------------------------------------------------------


def api_json(
    base_url: str,
    token: str,
    path: str,
    *,
    method: str = "GET",
    payload: Any = None,
    timeout: float = 30.0,
) -> Any:
    data = None
    headers = {"authorization": f"Bearer {token}"}
    if payload is not None:
        data = json.dumps(payload).encode("utf-8")
        headers["content-type"] = "application/json"
    request = Request(f"{base_url}{path}", data=data, method=method, headers=headers)
    try:
        with urlopen(request, timeout=timeout) as response:  # noqa: S310 - loopback only
            body = response.read()
    except HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise UiError(f"{method} {path} devolvió {exc.code}: {detail}") from exc
    except URLError as exc:
        raise UiError(f"{method} {path} no respondió: {exc}") from exc
    if not body:
        return None
    try:
        return json.loads(body.decode("utf-8"))
    except json.JSONDecodeError as exc:
        raise UiError(f"{method} {path} no devolvió JSON: {body[:300]!r}") from exc


def find_job(base_url: str, token: str, name: str, timeout: float) -> dict[str, Any]:
    deadline = time.monotonic() + timeout
    last: list[str] = []
    while time.monotonic() < deadline:
        response = api_json(base_url, token, "/api/jobs")
        jobs = response.get("jobs", []) if isinstance(response, dict) else []
        last = [str(job.get("name")) for job in jobs]
        for job in jobs:
            if job.get("name") == name:
                return job
        time.sleep(0.2)
    raise UiError(f"el cron «{name}» no aparece en la API (nombres: {last!r})")


def wait_for_run(
    base_url: str, token: str, job_id: str, timeout: float
) -> dict[str, Any]:
    deadline = time.monotonic() + timeout
    last: Any = None
    while time.monotonic() < deadline:
        response = api_json(
            base_url,
            token,
            f"/api/jobs/{quote(job_id, safe='')}/runs?limit=5",
        )
        runs = response.get("runs", []) if isinstance(response, dict) else []
        if runs:
            last = max(runs, key=lambda run: run.get("startedAt") or 0)
            if last.get("status") not in ("queued", "running"):
                return last
        time.sleep(0.2)
    raise UiError(f"la ejecución de {job_id} no terminó a tiempo (último: {last!r})")


def file_sha256(path: str) -> str:
    try:
        with open(path, "rb") as handle:
            return hashlib.sha256(handle.read()).hexdigest()
    except OSError as exc:
        raise UiError(f"no se pudo leer {path} para calcular su hash: {exc}") from exc


def assert_equal(actual: Any, expected: Any, label: str) -> None:
    if actual != expected:
        raise UiError(f"{label}: {actual!r} (esperado {expected!r})")


def assert_contains(text: str, needle: str, label: str) -> None:
    if needle not in text:
        raise UiError(f"{label}: {text!r} no contiene {needle!r}")


# ---------------------------------------------------------------------------
# JavaScript snippets
# ---------------------------------------------------------------------------


JS_HELPERS = """
function byId(id) {
  var element = document.getElementById(id);
  if (element === null) { throw new Error('no existe #' + id); }
  return element;
}
function setValue(id, value) {
  var element = byId(id);
  element.value = value;
  element.dispatchEvent(new Event('input', { bubbles: true }));
  element.dispatchEvent(new Event('change', { bubbles: true }));
  return element.value;
}
function rendered(id) {
  var element = document.getElementById(id);
  return element !== null && !element.hidden && element.getClientRects().length > 0;
}
function mcpRow(name) {
  var row = document.querySelector('#job-mcps tr[data-mcp="' + name + '"]');
  if (row === null) { throw new Error('no existe la fila MCP ' + name); }
  return row;
}
function setMcpState(name, value) {
  var select = mcpRow(name).querySelector('select.mcp-state');
  if (select === null) { throw new Error('no existe el selector de ' + name); }
  select.value = value;
  if (select.value !== value) { throw new Error('la opción ' + value + ' no existe para ' + name); }
  select.dispatchEvent(new Event('input', { bubbles: true }));
  select.dispatchEvent(new Event('change', { bubbles: true }));
  return select.value;
}
function readMcpTable() {
  var rows = [];
  document.querySelectorAll('#job-mcps tr[data-mcp]').forEach(function(tr) {
    var select = tr.querySelector('select.mcp-state');
    var effective = tr.querySelector('.mcp-effective');
    var pin = tr.querySelector('.mcp-pin');
    var cells = tr.querySelectorAll('td');
    rows.push({
      name: tr.getAttribute('data-mcp'),
      defaultLabel: cells.length > 1 ? cells[1].textContent.trim() : null,
      state: select === null ? null : select.value,
      effective: effective === null ? null : effective.textContent.trim(),
      effectiveVisible: effective !== null && !effective.hidden,
      pinVisible: pin !== null && !pin.hidden
    });
  });
  var notice = document.getElementById('job-mcps-notice');
  return {
    count: rows.length,
    rows: rows,
    notice: notice === null ? null : notice.textContent.trim(),
    noticeVisible: notice !== null && !notice.hidden && notice.getClientRects().length > 0
  };
}
"""

SUBMIT_JS = """
(function() {
  var form = document.querySelector('form.form');
  if (form === null) { throw new Error('no se encontró form.form'); }
  var submit = form.querySelector('button[type="submit"]');
  if (submit === null) { throw new Error('no se encontró el botón Guardar'); }
  submit.click();
  return 'clicked';
})()
"""


def wait_for_form(driver: WindowDriver, timeout: float) -> None:
    driver.wait_json(
        "return document.querySelector('form.form') !== null"
        " && document.querySelector('#job-name') !== null"
        " && document.querySelector('#job-mcps-section') !== null"
        " && document.querySelector('#job-cwd') !== null;",
        timeout,
        "formulario con la sección de MCPs",
    )


def wait_for_mcp_rows(
    driver: WindowDriver, names: list[str], timeout: float, description: str
) -> dict[str, Any]:
    expected = json.dumps(names, separators=(",", ":"))
    try:
        driver.wait_json(
            JS_HELPERS
            + "var table = readMcpTable();"
            + "var names = table.rows.map(function(row) { return row.name; });"
            + f"return table.count === {len(names)}"
            + f" && JSON.stringify(names) === {json.dumps(expected)} ? table : null;",
            timeout,
            description,
        )
    except UiError as exc:
        current = driver.eval_json(JS_HELPERS + "return readMcpTable();")
        raise UiError(
            f"{exc}; tabla actual: {json.dumps(current, ensure_ascii=False)}"
        ) from exc
    table = driver.eval_json(JS_HELPERS + "return readMcpTable();")
    if not isinstance(table, dict):
        raise UiError(f"no se pudo leer la tabla de MCPs: {table!r}")
    return table


def wait_for_list_row(driver: WindowDriver, name: str, timeout: float) -> str:
    href = driver.wait_json(
        "if (location.hash !== '#/') { return null; }"
        "var link = null;"
        "document.querySelectorAll('a.job-name').forEach(function(anchor) {"
        "  if (anchor.textContent.trim() === " + json.dumps(name) + ") { link = anchor; }"
        "});"
        "if (link === null) { return null; }"
        "return link.getAttribute('href');",
        timeout,
        f"fila «{name}» en la lista tras guardar",
    )
    if not isinstance(href, str) or "/" not in href:
        raise UiError(f"href inesperado en la fila: {href!r}")
    return href.rsplit("/", 1)[-1]


# ---------------------------------------------------------------------------
# Cases
# ---------------------------------------------------------------------------


def case_ui_and_save(
    driver: WindowDriver, args: argparse.Namespace, project_dir: str
) -> str:
    """4.1 / 4.2: table, defaults, pins and saved mcpOverrides."""
    name = args.name
    driver.js("location.hash = '#/new';")
    wait_for_form(driver, args.timeout)

    # The initial catalog is read with the default cwd, so the project server
    # must only appear after the cwd change triggers a reload.
    initial = wait_for_mcp_rows(
        driver, GLOBAL_MCPS, args.timeout, "MCPs globales antes de cambiar el cwd"
    )
    print(f"[4.2] cwd por defecto: {initial.get('count')} MCPs globales")

    filled = driver.eval_json(
        JS_HELPERS
        + "setValue('job-name', " + json.dumps(name) + ");"
        + "setValue('job-prompt', 'hola');"
        + "setValue('job-cwd', " + json.dumps(project_dir) + ");"
        + "return { name: byId('job-name').value, cwd: byId('job-cwd').value };"
    )
    if not isinstance(filled, dict):
        raise UiError(f"no se pudo rellenar el formulario: {filled!r}")
    assert_equal(filled.get("cwd"), project_dir, "cwd del formulario")

    table = wait_for_mcp_rows(
        driver, PROJECT_MCPS, args.timeout, "MCPs globales y de proyecto tras cambiar el cwd"
    )
    rows = {row["name"]: row for row in table.get("rows", [])}
    if len(rows) != len(PROJECT_MCPS):
        raise UiError(f"la tabla no tiene una fila por MCP: {table!r}")

    for server, (label, enabled) in EXPECTED_DEFAULTS.items():
        row = rows[server]
        assert_equal(row.get("defaultLabel"), label, f"por defecto de {server}")
        assert_equal(row.get("state"), "inherit", f"estado inicial de {server}")
        assert_equal(row.get("pinVisible"), False, f"pin inicial de {server}")
        assert_equal(row.get("effectiveVisible"), True, f"efectivo visible de {server}")
        assert_equal(row.get("effective"), label, f"efectivo de {server}")
        assert_equal(enabled, label == "Encendido", f"coherencia del falso para {server}")

    print("[4.1] por defecto: " + ", ".join(
        f"{server}={rows[server]['defaultLabel']}" for server in PROJECT_MCPS
    ))

    driver.eval_json(
        JS_HELPERS
        + "setMcpState('github', 'on');"
        + "setMcpState('xerj', 'off');"
        + "return true;"
    )

    pinned = driver.eval_json(JS_HELPERS + "return readMcpTable();")
    if not isinstance(pinned, dict):
        raise UiError(f"no se pudo leer la tabla tras fijar estados: {pinned!r}")
    pinned_rows = {row["name"]: row for row in pinned.get("rows", [])}

    for server, state in EXPECTED_OVERRIDES.items():
        row = pinned_rows[server]
        assert_equal(row.get("state"), state, f"estado fijado de {server}")
        assert_equal(row.get("pinVisible"), True, f"pin de {server}")
        assert_equal(row.get("effectiveVisible"), False, f"efectivo oculto de {server}")

    for server in PROJECT_MCPS:
        if server in EXPECTED_OVERRIDES:
            continue
        row = pinned_rows[server]
        assert_equal(row.get("state"), "inherit", f"estado heredado de {server}")
        assert_equal(row.get("pinVisible"), False, f"pin heredado de {server}")
        assert_equal(row.get("effectiveVisible"), True, f"efectivo visible de {server}")
        assert_equal(
            row.get("effective"),
            EXPECTED_DEFAULTS[server][0],
            f"efectivo heredado de {server}",
        )

    print("[4.1] fijados: github=on, xerj=off; resto heredado")
    print("[4.1] pines y efectivos coherentes")

    driver.scroll_to("#job-mcps-section")
    driver.screenshot(args.section_shot)
    print(f"[captura] sección MCPs: {args.section_shot}")

    driver.js(SUBMIT_JS)
    job_id = wait_for_list_row(driver, name, args.timeout)
    print(f"[4.1] guardado desde la ventana: id={job_id}")

    job = find_job(args.active_base_url, args.active_token, name, args.timeout)
    assert_equal(job.get("id"), job_id, "id de la fila y de la API")
    assert_equal(job.get("mcpOverrides"), EXPECTED_OVERRIDES, "mcpOverrides en la API")
    assert_equal(job.get("cwd"), project_dir, "cwd guardado")
    print(f"[4.1] API: mcpOverrides={json.dumps(job.get('mcpOverrides'))}")

    with closing(sqlite3.connect(args.active_db_path, timeout=10)) as connection:
        row = connection.execute(
            "SELECT mcp_overrides FROM jobs WHERE id = ?", (job_id,)
        ).fetchone()
    if row is None:
        raise UiError(f"no hay fila en SQLite para el cron {job_id}")
    stored = json.loads(row[0])
    assert_equal(stored, EXPECTED_OVERRIDES, "mcp_overrides en SQLite")
    print(f"[4.1] SQLite: mcp_overrides={row[0]}")

    return job_id


def case_overlay(
    driver: WindowDriver, args: argparse.Namespace, job_id: str, capture_path: str
) -> str:
    """5.1: "Ejecutar ahora" sends only the pinned servers and nothing else."""
    if os.path.exists(capture_path):
        os.remove(capture_path)

    hash_before = file_sha256(GLOBAL_CONFIG_PATH)
    clicked = driver.eval_json(
        "var link = null;"
        "document.querySelectorAll('a.job-name').forEach(function(anchor) {"
        "  if (anchor.textContent.trim() === " + json.dumps(args.name) + ") { link = anchor; }"
        "});"
        "if (link === null) { throw new Error('no se encontró la fila del cron'); }"
        "var row = link.closest('tr');"
        "var target = null;"
        "row.querySelectorAll('button').forEach(function(item) {"
        "  if (item.textContent.trim() === 'Ejecutar ahora') { target = item; }"
        "});"
        "if (target === null) { throw new Error('no se encontró «Ejecutar ahora»'); }"
        "target.click();"
        "return 'clicked';"
    )
    assert_equal(clicked, "clicked", "clic en «Ejecutar ahora»")

    run = wait_for_run(args.active_base_url, args.active_token, job_id, args.timeout)
    assert_equal(run.get("status"), "success", "estado del run manual")
    assert_equal(run.get("trigger"), "manual", "disparador del run")
    assert_contains(str(run.get("output") or ""), "ok-mcp", "salida del run")
    print(f"[5.1] run {run.get('id')}: status={run.get('status')} output={run.get('output')!r}")

    if not os.path.isfile(capture_path):
        raise UiError(f"el falso opencode no escribió {capture_path}")
    with open(capture_path, "r", encoding="utf-8") as handle:
        captured = handle.read()

    assert_equal(captured, EXPECTED_OVERLAY, "OPENCODE_CONFIG_CONTENT capturado")
    for absent in ("super-productivity", "roto", PROJECT_DIR_NAME):
        if absent in captured:
            raise UiError(f"el overlay no debe contener {absent!r}: {captured!r}")
    print(f"[5.1] CAPTURE exacto: {captured}")

    hash_after = file_sha256(GLOBAL_CONFIG_PATH)
    assert_equal(hash_after, hash_before, "hash de la configuración global")
    print(f"[5.1] sha256 config global sin cambios: {hash_after}")
    return captured


def case_all_inherited(
    args: argparse.Namespace, project_dir: str, capture_path: str
) -> None:
    """3.1: a cron with no overrides runs without OPENCODE_CONFIG_CONTENT."""
    created = api_json(
        args.active_base_url,
        args.active_token,
        "/api/jobs",
        method="POST",
        payload={
            "name": args.inherited_name,
            "runner": "opencode",
            "prompt": "hola",
            "cwd": project_dir,
            "scheduleKind": "cron",
            "scheduleExpr": "0 9 * * *",
            "timezone": "UTC",
            "mcpOverrides": {},
        },
    )
    job = created.get("job") if isinstance(created, dict) else None
    if not isinstance(job, dict) or not isinstance(job.get("id"), str):
        raise UiError(f"POST /api/jobs no devolvió un cron: {created!r}")
    job_id = str(job["id"])
    assert_equal(job.get("mcpOverrides"), {}, "mcpOverrides vacío en la API")

    if os.path.exists(capture_path):
        os.remove(capture_path)

    run = api_json(
        args.active_base_url,
        args.active_token,
        f"/api/jobs/{quote(job_id, safe='')}/run",
        method="POST",
    )
    run_body = run.get("run") if isinstance(run, dict) else None
    if not isinstance(run_body, dict):
        raise UiError(f"POST /run no devolvió una ejecución: {run!r}")
    if run_body.get("status") in ("queued", "running"):
        run_body = wait_for_run(args.active_base_url, args.active_token, job_id, args.timeout)
    assert_equal(run_body.get("status"), "success", "estado del run heredado")
    print(f"[3.1] run {run_body.get('id')}: status={run_body.get('status')}")

    if os.path.exists(capture_path):
        size = os.path.getsize(capture_path)
        assert_equal(size, 0, "tamaño del CAPTURE sin overrides")
        with open(capture_path, "r", encoding="utf-8") as handle:
            content = handle.read()
        assert_equal(content, "", "contenido del CAPTURE sin overrides")
        print("[3.1] CAPTURE vacío: OPENCODE_CONFIG_CONTENT no se definió")
    else:
        print("[3.1] CAPTURE no se creó: el proceso no recibió la variable")


def case_degraded(args: argparse.Namespace, project_dir: str) -> dict[str, Any]:
    """2.2 / 4.2: without `opencode` the notice shows and saved states survive."""
    daemon = Daemon(
        args.repo_root,
        path_prefix=None,
        extra_env={},
        timeout=args.timeout,
        keep_temp=args.keep_temp,
        label="degradado",
    )
    driver: WindowDriver | None = None
    try:
        daemon.start()
        if daemon.token is None:
            raise UiError("el daemon degradado no tiene token")

        created = api_json(
            daemon.base_url,
            daemon.token,
            "/api/jobs",
            method="POST",
            payload={
                "name": args.degraded_name,
                "runner": "opencode",
                "prompt": "hola",
                "cwd": project_dir,
                "scheduleKind": "cron",
                "scheduleExpr": "0 9 * * *",
                "timezone": "UTC",
                "mcpOverrides": EXPECTED_OVERRIDES,
            },
        )
        job = created.get("job") if isinstance(created, dict) else None
        if not isinstance(job, dict) or not isinstance(job.get("id"), str):
            raise UiError(f"POST /api/jobs no devolvió un cron: {created!r}")
        job_id = str(job["id"])

        driver = WindowDriver(daemon.base_url, daemon.token)
        driver.open(args.timeout)
        driver.wait_json(
            "return document.querySelector('.topbar') !== null;",
            args.timeout,
            "arranque de la interfaz del daemon degradado",
        )
        driver.js(f"location.hash = '#/jobs/{quote(job_id, safe='')}/edit';")
        wait_for_form(driver, args.timeout)

        table = wait_for_mcp_rows(
            driver,
            list(EXPECTED_OVERRIDES),
            args.timeout,
            "estados guardados en el daemon degradado",
        )
        if table.get("noticeVisible") is not True:
            raise UiError(f"el aviso de MCPs no es visible: {table!r}")
        notice = str(table.get("notice") or "")
        assert_contains(notice, "opencode", "aviso de catálogo no disponible")
        print(f"[2.2] aviso: {notice!r}")

        rows = {row["name"]: row for row in table.get("rows", [])}
        for server, state in EXPECTED_OVERRIDES.items():
            row = rows[server]
            assert_equal(row.get("defaultLabel"), "—", f"por defecto desconocido de {server}")
            assert_equal(row.get("state"), state, f"estado guardado de {server}")
            assert_equal(row.get("pinVisible"), True, f"pin guardado de {server}")
            assert_equal(row.get("effectiveVisible"), False, f"efectivo oculto de {server}")

        # The saved pin can be released and set again while the catalog is down.
        driver.eval_json(JS_HELPERS + "setMcpState('github', 'inherit'); return true;")
        released = driver.eval_json(JS_HELPERS + "return readMcpTable();")
        released_rows = {row["name"]: row for row in released.get("rows", [])}
        assert_equal(released_rows["github"].get("pinVisible"), False, "pin liberado")
        driver.eval_json(JS_HELPERS + "setMcpState('github', 'on'); return true;")

        driver.scroll_to("#job-mcps-section")
        driver.screenshot(args.degraded_shot)
        print(f"[captura] MCPs degradados: {args.degraded_shot}")

        driver.js(SUBMIT_JS)
        wait_for_list_row(driver, args.degraded_name, args.timeout)

        saved = find_job(daemon.base_url, daemon.token, args.degraded_name, args.timeout)
        assert_equal(saved.get("mcpOverrides"), EXPECTED_OVERRIDES, "mcpOverrides tras guardar")
        print(f"[2.2] guardado: mcpOverrides={json.dumps(saved.get('mcpOverrides'))}")
        return {"notice": notice, "job": saved}
    finally:
        if driver is not None:
            driver.close()
        daemon.stop()


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description=(
            "Comprueba en la ventana real la selección de MCPs por cron: tabla, guardado, "
            "overlay de ejecución y degradación sin opencode."
        )
    )
    parser.add_argument(
        "--name",
        default="e2e-mcp-overlay",
        help="Nombre del cron del caso 4.1/5.1 (por defecto e2e-mcp-overlay).",
    )
    parser.add_argument(
        "--inherited-name",
        default="e2e-mcp-heredado",
        help="Nombre del cron con todo heredado (por defecto e2e-mcp-heredado).",
    )
    parser.add_argument(
        "--degraded-name",
        default="e2e-mcp-degradado",
        help="Nombre del cron del caso degradado (por defecto e2e-mcp-degradado).",
    )
    parser.add_argument(
        "--screenshot-dir",
        default=os.path.join(tempfile.gettempdir(), "opencode", "laicron-e2e-mcps"),
        help="Directorio donde guardar las capturas PNG.",
    )
    parser.add_argument(
        "--timeout",
        type=float,
        default=60.0,
        help="Segundos de espera por paso (por defecto 60).",
    )
    parser.add_argument(
        "--no-build",
        action="store_true",
        help="No ejecutar pnpm build antes de arrancar los daemons.",
    )
    parser.add_argument(
        "--keep-temp",
        action="store_true",
        help="Conservar los directorios temporales de los daemons.",
    )
    parser.add_argument(
        "--display",
        default=None,
        help="Usar un DISPLAY ya existente en vez de arrancar Xvfb.",
    )
    return parser


def run_build(repo_root: str) -> None:
    print("[build] pnpm build")
    try:
        completed = subprocess.run(
            ["pnpm", "build"],
            cwd=repo_root,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            timeout=600,
        )
    except (OSError, subprocess.SubprocessError) as exc:
        raise UiError(f"no se pudo ejecutar pnpm build: {exc}") from exc
    if completed.returncode != 0:
        print(completed.stdout[-4000:], file=sys.stderr)
        raise UiError(f"pnpm build falló con código {completed.returncode}")
    print("[build] OK")


def prepare_fake_bin(shared_root: str) -> tuple[str, str]:
    """Creates the fake `opencode` and `notify-send` used by the daemons."""
    fake_bin = os.path.join(shared_root, "fake-bin")
    os.makedirs(fake_bin, exist_ok=True)

    opencode_path = os.path.join(fake_bin, "opencode")
    with open(opencode_path, "w", encoding="utf-8") as handle:
        handle.write(FAKE_OPENCODE)
    os.chmod(opencode_path, 0o755)

    # Keep the real desktop free of notifications during the check.
    notify_path = os.path.join(fake_bin, "notify-send")
    with open(notify_path, "w", encoding="utf-8") as handle:
        handle.write("#!/bin/sh\nexit 0\n")
    os.chmod(notify_path, 0o755)

    return fake_bin, os.path.join(shared_root, "capture.txt")


def prepare_project(shared_root: str) -> str:
    """Creates the project directory whose name makes the fake list `proyecto`."""
    project_dir = os.path.join(shared_root, PROJECT_DIR_NAME)
    config_dir = os.path.join(project_dir, ".opencode")
    os.makedirs(config_dir, exist_ok=True)
    with open(os.path.join(config_dir, "opencode.jsonc"), "w", encoding="utf-8") as handle:
        handle.write('{\n  // Project-local opencode config used by the end-to-end check.\n  "mcp": {}\n}\n')
    return project_dir


def main(argv: list[str]) -> int:
    args = build_parser().parse_args(argv)
    args.repo_root = repo_root_from_script()

    screenshot_dir = os.path.abspath(args.screenshot_dir)
    os.makedirs(screenshot_dir, exist_ok=True)
    args.section_shot = os.path.join(screenshot_dir, "mcps-section.png")
    args.degraded_shot = os.path.join(screenshot_dir, "mcps-degraded.png")

    shared_root = tempfile.mkdtemp(prefix="laicron-e2e-mcps-shared-")
    xvfb = XvfbServer()
    daemon: Daemon | None = None
    driver: WindowDriver | None = None
    failures: list[str] = []
    captured_overlay: str | None = None

    try:
        if args.display is not None:
            os.environ["DISPLAY"] = args.display
        else:
            os.environ["DISPLAY"] = xvfb.start()
        os.environ["GDK_BACKEND"] = "x11"
        print(f"[e2e] DISPLAY={os.environ['DISPLAY']} GDK_BACKEND=x11")

        if not args.no_build:
            run_build(args.repo_root)

        load_gtk()
        Gtk.init([])

        if not os.path.isfile(GLOBAL_CONFIG_PATH):
            raise UiError(f"falta la configuración global de opencode: {GLOBAL_CONFIG_PATH}")
        print(f"[e2e] sha256 config global inicial: {file_sha256(GLOBAL_CONFIG_PATH)}")

        fake_bin, capture_path = prepare_fake_bin(shared_root)
        project_dir = prepare_project(shared_root)
        print(f"[e2e] falso opencode: {fake_bin}")
        print(f"[e2e] proyecto: {project_dir}")
        print(f"[e2e] CAPTURE: {capture_path}")

        daemon = Daemon(
            args.repo_root,
            path_prefix=fake_bin,
            extra_env={"CAPTURE": capture_path},
            timeout=args.timeout,
            keep_temp=args.keep_temp,
            label="principal",
        )
        daemon.start()
        args.active_base_url = daemon.base_url
        args.active_token = daemon.token
        args.active_db_path = daemon.db_path

        driver = WindowDriver(args.active_base_url, str(args.active_token))
        driver.open(args.timeout)
        driver.wait_json(
            "return document.querySelector('.topbar') !== null"
            " && document.querySelector('.page-title') !== null;",
            args.timeout,
            "arranque de la interfaz (barra superior y vista de lista)",
        )

        job_id: str | None = None
        try:
            job_id = case_ui_and_save(driver, args, project_dir)
            print("4.1/4.2 OK")
        except UiError as exc:
            failures.append(f"4.1/4.2 FAIL: {exc}")
            print(f"4.1/4.2 FAIL: {exc}")
            print("---- DOM (primeros 4000 caracteres) ----")
            print(driver.snippet())
            print("----------------------------------------")
            try:
                job = find_job(
                    args.active_base_url, args.active_token, args.name, min(args.timeout, 5)
                )
                job_id = str(job.get("id"))
            except UiError:
                job_id = None

        if job_id is not None:
            try:
                captured_overlay = case_overlay(driver, args, job_id, capture_path)
                print("5.1 OK")
            except UiError as exc:
                failures.append(f"5.1 FAIL: {exc}")
                print(f"5.1 FAIL: {exc}")
                print("---- DOM (primeros 4000 caracteres) ----")
                print(driver.snippet())
                print("----------------------------------------")
        else:
            failures.append("5.1 FAIL: no hay cron del caso 4.1 para ejecutar")

        try:
            case_all_inherited(args, project_dir, capture_path)
            print("3.1 OK")
        except UiError as exc:
            failures.append(f"3.1 FAIL: {exc}")
            print(f"3.1 FAIL: {exc}")

        driver.close()
        driver = None
        daemon.stop()
        daemon = None

        try:
            case_degraded(args, project_dir)
            print("2.2 OK")
        except UiError as exc:
            failures.append(f"2.2 FAIL: {exc}")
            print(f"2.2 FAIL: {exc}")
    except UiError as exc:
        failures.append(f"error: {exc}")
        print(f"error: {exc}", file=sys.stderr)
    finally:
        if driver is not None:
            driver.close()
        if daemon is not None:
            daemon.stop()
        xvfb.stop()
        if not args.keep_temp:
            shutil.rmtree(shared_root, ignore_errors=True)

    print("[capturas]")
    for path in (args.section_shot, args.degraded_shot):
        state = "ok" if os.path.isfile(path) else "falta"
        print(f"  {path}: {state}")
    if captured_overlay is not None:
        print(f"[overlay] {captured_overlay}")

    if failures:
        print("RESULTADO: FALLO")
        for failure in failures:
            print(f"  - {failure}")
        return 1
    print("RESULTADO: OK")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
