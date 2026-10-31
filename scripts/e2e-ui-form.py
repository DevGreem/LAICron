#!/usr/bin/env python3
"""End-to-end check of the assisted job form (improve-job-form-usability).

It drives the real GTK3 + WebKit2 window against temporary daemons and checks:

* 2.1 / 5.1 - the opencode catalog fills the model, variant and agent selects and
  the saved job keeps ``modelo#variante``, the agent, ``UTC`` and ``0 9 * * 1-5``.
* 4.2 - an existing cron is loaded into the five fields and an expression that
  cannot be split opens the advanced mode with its warning.
* 3.1 / 3.2 - the time zone hint follows the chosen IANA zone.
* 2.2 - a daemon started with an empty ``PATH`` degrades to manual fields and
  still saves the job.

The script starts its own Xvfb display and its own daemons, all with temporary
directories and free ports. It can also target an already running daemon:

    python3 scripts/e2e-ui-form.py
    python3 scripts/e2e-ui-form.py --base-url http://127.0.0.1:7317 --token <token> --db-path <db>
    LAICRON_BASE_URL=... LAICRON_TOKEN=... python3 scripts/e2e-ui-form.py

It exits 0 when every case passes and 1 otherwise. No repository path is
assumed: the UI root and the daemon entry point are resolved from this file.
"""

from __future__ import annotations

import argparse
import json
import os
import re
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
CATALOG_VARIANT = "high"
CATALOG_AGENT = "build"
EXPECTED_CRON = "0 9 * * 1-5"


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
        self.window = Gtk.Window(title="LAICron e2e form")
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
        empty_path: bool,
        port: int | None,
        token: str | None,
        timeout: float,
        keep_temp: bool,
    ) -> None:
        self.repo_root = repo_root
        self.main_js = os.path.join(repo_root, "packages", "daemon", "dist", "main.js")
        self.ui_root = os.environ.get("LAICRON_UI_ROOT") or os.path.join(
            repo_root, "packages", "ui", "dist"
        )
        self.empty_path = empty_path
        self.timeout = timeout
        self.keep_temp = keep_temp
        self.temp_dir = tempfile.mkdtemp(prefix="laicron-e2e-form-")
        self.db_path = os.path.join(self.temp_dir, "laicron.db")
        self.config_dir = os.path.join(self.temp_dir, "config")
        self.log_path = os.path.join(self.temp_dir, "daemon.log")
        self.port = port if port is not None else free_port()
        self.token = token
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
            }
        )
        if empty_path:
            empty_bin = os.path.join(self.temp_dir, "empty-bin")
            os.makedirs(empty_bin, exist_ok=True)
            env["PATH"] = empty_bin
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
        if self.token is not None:
            token_path = os.path.join(self.config_dir, "token")
            with open(token_path, "w", encoding="utf-8") as handle:
                handle.write(self.token)
            os.chmod(token_path, 0o600)

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

        print(f"[daemon] {self.base_url} db={self.db_path} PATH_vacío={self.empty_path}")

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


def update_schedule_in_sqlite(db_path: str, job_id: str, expr: str) -> None:
    try:
        with closing(sqlite3.connect(db_path, timeout=10)) as connection:
            with connection:
                cursor = connection.execute(
                    "UPDATE jobs SET schedule_expr = ? WHERE id = ?", (expr, job_id)
                )
    except sqlite3.Error as exc:
        raise UiError(f"no se pudo actualizar schedule_expr en SQLite: {exc}") from exc
    if cursor.rowcount != 1:
        raise UiError(f"SQLite no actualizó ninguna fila para el cron {job_id}")


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
function setSelect(id, value) {
  var element = byId(id);
  element.value = value;
  if (element.value !== value) {
    throw new Error('la opción ' + value + ' no existe en #' + id);
  }
  element.dispatchEvent(new Event('input', { bubbles: true }));
  element.dispatchEvent(new Event('change', { bubbles: true }));
  return element.value;
}
function setChecked(id, value) {
  var element = byId(id);
  element.checked = value;
  element.dispatchEvent(new Event('input', { bubbles: true }));
  element.dispatchEvent(new Event('change', { bubbles: true }));
  return element.checked;
}
function readValue(id) { return byId(id).value; }
function rendered(id) {
  var element = document.getElementById(id);
  return element !== null && !element.hidden && element.getClientRects().length > 0;
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
        " && document.querySelector('#job-cron-preview') !== null;",
        timeout,
        "formulario con los controles nuevos",
    )


def wait_for_catalog(driver: WindowDriver, timeout: float) -> dict[str, Any]:
    driver.wait_json(
        "var select = document.querySelector('#job-model');"
        "return select !== null && !select.disabled && select.options.length > 1;",
        timeout,
        "catálogo de opencode cargado en el formulario",
    )
    driver.wait_json(
        "var select = document.querySelector('#job-model');"
        "return select !== null"
        " && select.querySelector('option[value=" + json.dumps(CATALOG_MODEL) + "]') !== null;",
        timeout,
        f"modelo {CATALOG_MODEL} en el select",
    )
    state = driver.eval_json(
        JS_HELPERS
        + "var model = byId('job-model');"
        + "var variant = byId('job-model-variant');"
        + "var agent = byId('job-agent');"
        + "return {"
        + "  models: model.options.length,"
        + "  agents: agent.options.length,"
        + "  variants: Array.prototype.map.call(variant.options, function(option) {"
        + "    return option.value;"
        + "  }),"
        + "  modelCustomOption: model.querySelector('option[value=\"__custom__\"]') !== null,"
        + "  agentCustomOption: agent.querySelector('option[value=\"__custom__\"]') !== null,"
        + "  refreshRendered: rendered('job-options-refresh')"
        + "};"
    )
    if not isinstance(state, dict):
        raise UiError(f"no se pudo leer el catálogo del formulario: {state!r}")
    return state


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


def case_catalog_and_save(driver: WindowDriver, args: argparse.Namespace) -> tuple[str, dict[str, Any]]:
    """2.1 / 5.1: catalog selects, save and read the job back through the API."""
    name = args.name
    driver.js("location.hash = '#/new';")
    wait_for_form(driver, args.timeout)
    catalog = wait_for_catalog(driver, args.timeout)
    print(f"[2.1] catálogo en el formulario: {catalog.get('models')} modelos, "
          f"{catalog.get('agents')} agentes, variantes={catalog.get('variants')!r}")
    if catalog.get("modelCustomOption") is not True:
        raise UiError("el select de modelo no ofrece la opción «Personalizado»")
    if catalog.get("agentCustomOption") is not True:
        raise UiError("el select de agente no ofrece la opción «Personalizado»")
    if catalog.get("refreshRendered") is not True:
        raise UiError("el botón «Recargar catálogo» no es visible")

    options = api_json(args.active_base_url, args.active_token, "/api/opencode/options")
    if not isinstance(options, dict) or options.get("available") is not True:
        raise UiError(f"GET /api/opencode/options no está disponible: {options!r}")
    model_ids = [model.get("id") for model in options.get("models", [])]
    if CATALOG_MODEL not in model_ids:
        raise UiError(f"la API no ofrece {CATALOG_MODEL}: {len(model_ids)} modelos")
    print(f"[2.1] API: {len(model_ids)} modelos y {len(options.get('agents', []))} agentes primarios")

    filled = driver.eval_json(
        JS_HELPERS
        + "setSelect('job-model', " + json.dumps(CATALOG_MODEL) + ");"
        + "var variant = byId('job-model-variant');"
        + "if (variant.querySelector('option[value=" + json.dumps(CATALOG_VARIANT) + "]') === null) {"
        + "  throw new Error('la variante " + CATALOG_VARIANT + " no está en el select');"
        + "}"
        + "setSelect('job-model-variant', " + json.dumps(CATALOG_VARIANT) + ");"
        + "setSelect('job-agent', " + json.dumps(CATALOG_AGENT) + ");"
        + "setValue('job-name', " + json.dumps(name) + ");"
        + "setValue('job-prompt', 'hola');"
        + "setValue('job-timezone', 'UTC');"
        + "setSelect('job-cron-preset', 'weekdays-9');"
        + "return {"
        + "  model: readValue('job-model'),"
        + "  variant: readValue('job-model-variant'),"
        + "  agent: readValue('job-agent'),"
        + "  timezone: readValue('job-timezone'),"
        + "  preset: readValue('job-cron-preset'),"
        + "  cron: [readValue('job-cron-minute'), readValue('job-cron-hour'),"
        + "         readValue('job-cron-dom'), readValue('job-cron-month'),"
        + "         readValue('job-cron-dow')],"
        + "  preview: byId('job-cron-preview').textContent.trim(),"
        + "  timezoneInfo: byId('job-timezone-info').textContent.trim()"
        + "};"
    )
    if not isinstance(filled, dict):
        raise UiError(f"no se pudo leer el formulario rellenado: {filled!r}")

    assert_equal(filled.get("model"), CATALOG_MODEL, "modelo seleccionado")
    assert_equal(filled.get("variant"), CATALOG_VARIANT, "variante seleccionada")
    assert_equal(filled.get("agent"), CATALOG_AGENT, "agente seleccionado")
    assert_equal(filled.get("timezone"), "UTC", "zona seleccionada")
    assert_equal(filled.get("preset"), "weekdays-9", "preset seleccionado")
    assert_equal(filled.get("cron"), ["0", "9", "*", "*", "1-5"], "campos de cron")
    preview = str(filled.get("preview") or "")
    assert_contains(preview, "lunes", "vista previa del cron")
    assert_contains(preview, "viernes", "vista previa del cron")
    timezone_info = str(filled.get("timezoneInfo") or "")
    assert_contains(timezone_info, "UTC", "info de la zona UTC")
    print(f"[2.1] preview: {preview!r}")
    print(f"[2.1] zona UTC: {timezone_info!r}")

    driver.js(SUBMIT_JS)
    job_id = wait_for_list_row(driver, name, args.timeout)
    print(f"[2.1] guardado desde la ventana: id={job_id}")

    job = find_job(args.active_base_url, args.active_token, name, args.timeout)
    assert_equal(job.get("id"), job_id, "id de la fila y de la API")
    assert_equal(job.get("model"), f"{CATALOG_MODEL}#{CATALOG_VARIANT}", "modelo guardado")
    assert_equal(job.get("agent"), CATALOG_AGENT, "agente guardado")
    assert_equal(job.get("timezone"), "UTC", "zona guardada")
    assert_equal(job.get("scheduleExpr"), EXPECTED_CRON, "cron guardado")
    assert_equal(job.get("scheduleKind"), "cron", "tipo de programación guardado")

    if args.active_db_path is not None:
        with closing(sqlite3.connect(args.active_db_path, timeout=10)) as connection:
            row = connection.execute(
                "SELECT model, agent, timezone, schedule_expr FROM jobs WHERE id = ?", (job_id,)
            ).fetchone()
        assert_equal(
            row,
            (f"{CATALOG_MODEL}#{CATALOG_VARIANT}", CATALOG_AGENT, "UTC", EXPECTED_CRON),
            "fila guardada en SQLite",
        )
        print(f"[5.1] SQLite: model={row[0]!r} agent={row[1]!r} timezone={row[2]!r} cron={row[3]!r}")

    return job_id, filled


def case_edit_existing(
    driver: WindowDriver, args: argparse.Namespace, job_id: str
) -> dict[str, Any]:
    """4.2: the saved job is loaded back into the five cron fields and selects."""
    driver.js(f"location.hash = '#/jobs/{quote(job_id, safe='')}/edit';")
    wait_for_form(driver, args.timeout)
    wait_for_catalog(driver, args.timeout)
    driver.wait_json(
        "var model = document.querySelector('#job-model');"
        "var name = document.querySelector('#job-name');"
        "return model !== null && model.value === " + json.dumps(CATALOG_MODEL)
        + " && name !== null && name.value === " + json.dumps(args.name) + ";",
        args.timeout,
        "edición con el modelo guardado aplicado",
    )

    state = driver.eval_json(
        JS_HELPERS
        + "return {"
        + "  name: readValue('job-name'),"
        "  model: readValue('job-model'),"
        "  modelCustom: readValue('job-model-custom'),"
        "  variant: readValue('job-model-variant'),"
        "  agent: readValue('job-agent'),"
        "  agentCustom: readValue('job-agent-custom'),"
        "  timezone: readValue('job-timezone'),"
        "  preset: readValue('job-cron-preset'),"
        "  cron: [readValue('job-cron-minute'), readValue('job-cron-hour'),"
        "         readValue('job-cron-dom'), readValue('job-cron-month'),"
        "         readValue('job-cron-dow')],"
        "  advanced: byId('job-cron-advanced').checked,"
        "  raw: readValue('job-cron-raw'),"
        "  preview: byId('job-cron-preview').textContent.trim(),"
        "  timezoneInfo: byId('job-timezone-info').textContent.trim(),"
        "  modelRendered: rendered('job-model'),"
        "  customRendered: rendered('job-model-custom')"
        "};"
    )
    if not isinstance(state, dict):
        raise UiError(f"no se pudo leer el formulario de edición: {state!r}")

    assert_equal(state.get("name"), args.name, "nombre cargado")
    assert_equal(state.get("model"), CATALOG_MODEL, "modelo cargado")
    assert_equal(state.get("modelCustom"), f"{CATALOG_MODEL}#{CATALOG_VARIANT}",
                 "valor completo del modelo en el campo manual")
    assert_equal(state.get("variant"), CATALOG_VARIANT, "variante cargada")
    assert_equal(state.get("agent"), CATALOG_AGENT, "agente cargado")
    assert_equal(state.get("timezone"), "UTC", "zona cargada")
    assert_equal(state.get("preset"), "weekdays-9", "preset cargado")
    assert_equal(state.get("cron"), ["0", "9", "*", "*", "1-5"], "campos de cron cargados")
    assert_equal(state.get("advanced"), False, "modo avanzado desactivado")
    preview = str(state.get("preview") or "")
    assert_contains(preview, "lunes", "vista previa al editar")
    assert_contains(preview, "viernes", "vista previa al editar")
    print(f"[4.2] edición: modelo={state.get('model')!r} variante={state.get('variant')!r} "
          f"agente={state.get('agent')!r} zona={state.get('timezone')!r} "
          f"cron={state.get('cron')!r}")
    print(f"[4.2] preview al editar: {preview!r}")
    return state


def case_unparseable_expression(
    driver: WindowDriver, args: argparse.Namespace
) -> dict[str, Any]:
    """4.2: a non five-field expression opens advanced mode with a warning."""
    name = args.raw_name
    created = api_json(
        args.active_base_url,
        args.active_token,
        "/api/jobs",
        method="POST",
        payload={
            "name": name,
            "runner": "opencode",
            "prompt": "hola",
            "scheduleKind": "cron",
            "scheduleExpr": EXPECTED_CRON,
            "timezone": "UTC",
        },
    )
    job = created.get("job") if isinstance(created, dict) else None
    if not isinstance(job, dict) or not isinstance(job.get("id"), str):
        raise UiError(f"POST /api/jobs no devolvió un cron: {created!r}")
    job_id = str(job["id"])

    if args.active_db_path is None:
        raise UiError("el caso 4.2 necesita la ruta de la base de datos (--db-path)")
    update_schedule_in_sqlite(args.active_db_path, job_id, "@daily")
    print(f"[4.2] cron {job_id} con schedule_expr='@daily' directamente en SQLite")

    driver.js(f"location.hash = '#/jobs/{quote(job_id, safe='')}/edit';")
    wait_for_form(driver, args.timeout)
    driver.wait_json(
        "var advanced = document.querySelector('#job-cron-advanced');"
        "return advanced !== null && advanced.checked"
        " && document.querySelector('#job-cron-raw') !== null;",
        args.timeout,
        "modo avanzado abierto para una expresión no interpretable",
    )

    state = driver.eval_json(
        JS_HELPERS
        + "return {"
        + "  advanced: byId('job-cron-advanced').checked,"
        "  raw: readValue('job-cron-raw'),"
        "  rawRendered: rendered('job-cron-raw'),"
        "  preview: byId('job-cron-preview').textContent.trim(),"
        "  cron: [readValue('job-cron-minute'), readValue('job-cron-hour'),"
        "         readValue('job-cron-dom'), readValue('job-cron-month'),"
        "         readValue('job-cron-dow')],"
        "  preset: readValue('job-cron-preset')"
        "};"
    )
    if not isinstance(state, dict):
        raise UiError(f"no se pudo leer el modo avanzado: {state!r}")

    assert_equal(state.get("advanced"), True, "avanzado marcado")
    assert_equal(state.get("raw"), "@daily", "expresión cruda cargada")
    assert_equal(state.get("rawRendered"), True, "campo crudo visible")
    preview = str(state.get("preview") or "")
    assert_contains(preview, "no se pudo dividir", "aviso de expresión no interpretable")
    print(f"[4.2] avanzado={state.get('advanced')!r} raw={state.get('raw')!r} "
          f"preset={state.get('preset')!r} cron={state.get('cron')!r}")
    print(f"[4.2] aviso: {preview!r}")
    return state


def case_timezones(driver: WindowDriver, args: argparse.Namespace) -> dict[str, Any]:
    """3.1 / 3.2: the hint shows the time and offset of the chosen IANA zone."""
    driver.js("location.hash = '#/new';")
    wait_for_form(driver, args.timeout)

    madrid_info = driver.eval_json(
        JS_HELPERS
        + "setValue('job-timezone', 'Europe/Madrid');"
        + "return byId('job-timezone-info').textContent.trim();"
    )
    utc_info = driver.eval_json(
        JS_HELPERS
        + "setValue('job-timezone', 'UTC');"
        + "return byId('job-timezone-info').textContent.trim();"
    )
    madrid = str(madrid_info or "")
    utc = str(utc_info or "")

    if re.search(r"\b\d{2}:\d{2}\b", madrid) is None:
        raise UiError(f"la info de Europe/Madrid no muestra una hora HH:MM: {madrid!r}")
    if re.search(r"GMT\+[12]", madrid) is None:
        raise UiError(f"la info de Europe/Madrid no muestra GMT+1 ni GMT+2: {madrid!r}")
    if re.search(r"\b\d{2}:\d{2}\b", utc) is None:
        raise UiError(f"la info de UTC no muestra una hora HH:MM: {utc!r}")
    assert_contains(utc, "UTC", "info de UTC")
    if madrid == utc:
        raise UiError(f"el texto de la zona no cambió entre Europe/Madrid y UTC: {utc!r}")
    print(f"[3.2] Europe/Madrid: {madrid!r}")
    print(f"[3.2] UTC: {utc!r}")
    return {"madrid": madrid, "utc": utc}


def case_degraded_catalog(args: argparse.Namespace, xvfb: XvfbServer) -> dict[str, Any]:
    """2.2: without `opencode` in PATH the form degrades and still saves."""
    daemon = Daemon(
        args.repo_root,
        empty_path=True,
        port=None,
        token=None,
        timeout=args.timeout,
        keep_temp=args.keep_temp,
    )
    driver: WindowDriver | None = None
    try:
        daemon.start()
        if daemon.token is None:
            raise UiError("el daemon degradado no tiene token")
        driver = WindowDriver(daemon.base_url, daemon.token)
        driver.open(args.timeout)
        driver.wait_json(
            "return document.querySelector('.topbar') !== null;",
            args.timeout,
            "arranque de la interfaz del daemon degradado",
        )
        driver.js("location.hash = '#/new';")
        wait_for_form(driver, args.timeout)

        notice = driver.wait_json(
            "var notice = document.getElementById('job-options-notice');"
            "if (notice === null || notice.hidden || notice.getClientRects().length === 0) {"
            "  return null;"
            "}"
            "return notice.textContent.trim();",
            args.timeout,
            "aviso de catálogo no disponible",
        )
        state = driver.eval_json(
            JS_HELPERS
            + "var model = byId('job-model');"
            + "var variant = byId('job-model-variant');"
            + "var agent = byId('job-agent');"
            "return {"
            "  notice: byId('job-options-notice').textContent.trim(),"
            "  noticeRendered: rendered('job-options-notice'),"
            "  modelHidden: model.getClientRects().length === 0,"
            "  modelDisabled: model.disabled,"
            "  variantHidden: variant.getClientRects().length === 0,"
            "  variantDisabled: variant.disabled,"
            "  agentHidden: agent.getClientRects().length === 0,"
            "  agentDisabled: agent.disabled,"
            "  customRendered: rendered('job-model-custom'),"
            "  agentCustomRendered: rendered('job-agent-custom'),"
            "  refreshRendered: rendered('job-options-refresh')"
            "};"
        )
        if not isinstance(state, dict):
            raise UiError(f"no se pudo leer la degradación: {state!r}")

        if state.get("noticeRendered") is not True:
            raise UiError(f"el aviso no es visible: {state!r}")
        if state.get("customRendered") is not True:
            raise UiError(f"el campo de modelo manual no es visible: {state!r}")
        if state.get("agentCustomRendered") is not True:
            raise UiError(f"el campo de agente manual no es visible: {state!r}")
        if not (state.get("modelHidden") or state.get("modelDisabled")):
            raise UiError(f"el select de modelo sigue visible y activo: {state!r}")
        if not (state.get("variantHidden") or state.get("variantDisabled")):
            raise UiError(f"el select de variante sigue visible y activo: {state!r}")
        if not (state.get("agentHidden") or state.get("agentDisabled")):
            raise UiError(f"el select de agente sigue visible y activo: {state!r}")
        print(f"[2.2] aviso: {notice!r}")
        print(f"[2.2] modelo oculto={state.get('modelHidden')!r} "
              f"deshabilitado={state.get('modelDisabled')!r}; "
              f"manual visible={state.get('customRendered')!r}")

        filled = driver.eval_json(
            JS_HELPERS
            + "setValue('job-name', " + json.dumps(args.degraded_name) + ");"
            + "setValue('job-prompt', 'hola');"
            + "setValue('job-model-custom', 'mi/modelo#low');"
            + "setValue('job-timezone', 'UTC');"
            + "setSelect('job-cron-preset', 'daily-9');"
            + "return {"
            + "  model: readValue('job-model-custom'),"
            + "  timezone: readValue('job-timezone'),"
            + "  preview: byId('job-cron-preview').textContent.trim()"
            + "};"
        )
        if not isinstance(filled, dict):
            raise UiError(f"no se pudo rellenar el formulario degradado: {filled!r}")
        print(f"[2.2] preview degradado: {filled.get('preview')!r}")

        driver.js(SUBMIT_JS)
        wait_for_list_row(driver, args.degraded_name, args.timeout)
        job = find_job(daemon.base_url, daemon.token, args.degraded_name, args.timeout)
        assert_equal(job.get("model"), "mi/modelo#low", "modelo manual guardado")
        assert_equal(job.get("timezone"), "UTC", "zona guardada en modo degradado")
        assert_equal(job.get("scheduleExpr"), "0 9 * * *", "cron guardado en modo degradado")
        print(f"[2.2] API: model={job.get('model')!r} timezone={job.get('timezone')!r} "
              f"cron={job.get('scheduleExpr')!r}")
        return {"notice": notice, "state": state, "job": job}
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
            "Comprueba el formulario de cron nuevo en la ventana real: catálogo de opencode, "
            "edición, modo avanzado, zonas horarias y degradación sin opencode."
        )
    )
    parser.add_argument(
        "--base-url",
        default=os.environ.get("LAICRON_BASE_URL"),
        help="URL de un daemon ya arrancado (si falta, se arranca uno temporal).",
    )
    parser.add_argument(
        "--port",
        type=int,
        default=int(os.environ.get("LAICRON_PORT", "0")),
        help="Puerto del daemon temporal (0, el valor por defecto, elige uno libre).",
    )
    parser.add_argument(
        "--token",
        default=os.environ.get("LAICRON_TOKEN"),
        help="Token del daemon (o variable LAICRON_TOKEN).",
    )
    parser.add_argument(
        "--token-file",
        default=None,
        help="Archivo del que leer el token (evita pasarlo por la línea de comandos).",
    )
    parser.add_argument(
        "--db-path",
        default=os.environ.get("LAICRON_DB_PATH"),
        help="Base de datos del daemon para el caso 4.2 (obligatoria en modo --base-url).",
    )
    parser.add_argument(
        "--ui-root",
        default=os.environ.get("LAICRON_UI_ROOT"),
        help="Directorio de la interfaz compilada (por defecto packages/ui/dist).",
    )
    parser.add_argument(
        "--name",
        default="e2e-form-modelo",
        help="Nombre del cron del caso 2.1 (por defecto e2e-form-modelo).",
    )
    parser.add_argument(
        "--raw-name",
        default="e2e-form-raw",
        help="Nombre del cron del caso 4.2 (por defecto e2e-form-raw).",
    )
    parser.add_argument(
        "--degraded-name",
        default="e2e-form-degradado",
        help="Nombre del cron del caso 2.2 (por defecto e2e-form-degradado).",
    )
    parser.add_argument(
        "--screenshot-dir",
        default=os.path.join(tempfile.gettempdir(), "opencode", "laicron-e2e-form"),
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


def main(argv: list[str]) -> int:
    args = build_parser().parse_args(argv)
    args.repo_root = repo_root_from_script()

    if args.token_file is not None:
        try:
            with open(args.token_file, "r", encoding="utf-8") as handle:
                args.token = handle.read().strip()
        except OSError as exc:
            print(f"error: no se pudo leer el token de {args.token_file}: {exc}", file=sys.stderr)
            return 2
    if args.token is not None and args.token.strip() == "":
        args.token = None

    external = args.base_url is not None
    if external and (args.token is None or args.token.strip() == ""):
        print("error: en modo --base-url hace falta --token o LAICRON_TOKEN", file=sys.stderr)
        return 2
    if external and args.db_path is None:
        print(
            "error: en modo --base-url hace falta --db-path para el caso 4.2",
            file=sys.stderr,
        )
        return 2

    if args.ui_root is not None:
        # The daemon reads LAICRON_UI_ROOT from its own environment; keep the
        # override visible to Daemon by writing it back to the process env.
        os.environ["LAICRON_UI_ROOT"] = os.path.abspath(args.ui_root)

    screenshot_dir = os.path.abspath(args.screenshot_dir)
    os.makedirs(screenshot_dir, exist_ok=True)
    form_shot = os.path.join(screenshot_dir, "form-selects.png")
    advanced_shot = os.path.join(screenshot_dir, "cron-advanced.png")

    xvfb = XvfbServer()
    daemon: Daemon | None = None
    driver: WindowDriver | None = None
    failures: list[str] = []

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

        if external:
            args.active_base_url = str(args.base_url).rstrip("/")
            args.active_token = str(args.token)
            args.active_db_path = os.path.abspath(str(args.db_path))
            print(f"[e2e] daemon externo: {args.active_base_url}")
        else:
            port = None if args.port == 0 else args.port
            daemon = Daemon(
                args.repo_root,
                empty_path=False,
                port=port,
                token=args.token,
                timeout=args.timeout,
                keep_temp=args.keep_temp,
            )
            daemon.start()
            args.active_base_url = daemon.base_url
            args.active_token = daemon.token
            args.active_db_path = daemon.db_path

        if not args.active_token:
            raise UiError("no hay token para la ventana")
        driver = WindowDriver(args.active_base_url, args.active_token)
        driver.open(args.timeout)
        driver.wait_json(
            "return document.querySelector('.topbar') !== null"
            " && document.querySelector('.page-title') !== null;",
            args.timeout,
            "arranque de la interfaz (barra superior y vista de lista)",
        )

        job_id: str | None = None
        try:
            job_id, _ = case_catalog_and_save(driver, args)
            print("2.1/5.1 OK")
        except UiError as exc:
            failures.append(f"2.1/5.1 FAIL: {exc}")
            print(f"2.1/5.1 FAIL: {exc}")
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
                case_edit_existing(driver, args, job_id)
                print("4.2 (edición) OK")
                driver.scroll_to("#job-model")
                driver.screenshot(form_shot)
                print(f"[captura] formulario con selects: {form_shot}")
            except UiError as exc:
                failures.append(f"4.2 (edición) FAIL: {exc}")
                print(f"4.2 (edición) FAIL: {exc}")
                print("---- DOM (primeros 4000 caracteres) ----")
                print(driver.snippet())
                print("----------------------------------------")

        try:
            case_unparseable_expression(driver, args)
            print("4.2 (avanzado) OK")
            driver.scroll_to("#job-cron-advanced")
            driver.screenshot(advanced_shot)
            print(f"[captura] modo avanzado: {advanced_shot}")
        except UiError as exc:
            failures.append(f"4.2 (avanzado) FAIL: {exc}")
            print(f"4.2 (avanzado) FAIL: {exc}")
            print("---- DOM (primeros 4000 caracteres) ----")
            print(driver.snippet())
            print("----------------------------------------")

        try:
            case_timezones(driver, args)
            print("3.1/3.2 OK")
        except UiError as exc:
            failures.append(f"3.1/3.2 FAIL: {exc}")
            print(f"3.1/3.2 FAIL: {exc}")
            print("---- DOM (primeros 4000 caracteres) ----")
            print(driver.snippet())
            print("----------------------------------------")

        driver.close()
        driver = None

        try:
            case_degraded_catalog(args, xvfb)
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

    print("[capturas]")
    for path in (form_shot, advanced_shot):
        state = "ok" if os.path.isfile(path) else "falta"
        print(f"  {path}: {state}")

    if failures:
        print("RESULTADO: FALLO")
        for failure in failures:
            print(f"  - {failure}")
        return 1
    print("RESULTADO: OK")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
