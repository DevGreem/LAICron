#!/usr/bin/env python3
"""End-to-end check of the cron context and consumption (add-cron-context-and-usage).

It starts its own Xvfb display, its own temporary daemon and a real ``opencode``
behind a capture wrapper, then checks:

* 4.1 - the ``run`` call carries ``--standalone``, the overlay of that call has
  the MCP states and the instructions file, the file exists with the fixed
  instruction, the run stores tokens/cost and ``/usage`` returns the same
  totals, and the chat does not contain the hidden instruction.
* 4.1 - a job with every MCP inherited sends ``instructions`` but no ``mcp``.
* 3.1 - the detail view renders the usage card, the breakdown line and the
  Tokens/Coste columns of the run history, including ``—`` for an old run
  inserted without consumption data.

The wrapper is the only process in front of ``opencode``: it appends the
arguments and ``OPENCODE_CONFIG_CONTENT`` to a log and then ``exec``s the real
binary, so the checks observe what opencode receives *and* the run is real.

    python3 scripts/e2e-usage.py
    python3 scripts/e2e-usage.py --keep-temp --timeout 180

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
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
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
MODEL = "opencode/flint-40b-free"
PROMPT = "Di solo: ok"
INSTRUCTION_SNIPPET = "Estás ejecutando una tarea programada"
MAX_RUN_SECONDS = 120.0
DEFAULT_OPENCODE = "/home/ian/.opencode/bin/opencode"


class E2eError(RuntimeError):
    """A check failed or the window/daemon could not be driven."""


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
        raise E2eError(f"no se pudo cargar GTK3/WebKit2: {exc}") from exc

    GLib = GLibModule
    Gtk = GtkModule
    WebKit2 = WebKit2Module


# ---------------------------------------------------------------------------
# GLib / WebKit2 driver (shared shape with e2e-ui-form.py)
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
        self.window = Gtk.Window(title="LAICron e2e usage")
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
            raise E2eError(f"no se pudo cargar {url}: {self._load_state['error']}")

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
            raise E2eError(str(box["error"]))
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
            raise E2eError(f"respuesta JS no es JSON ({exc}): {raw[:500]}") from exc

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
                raise E2eError(f"{description}: error de JS: {value[4:]}")
            if value:
                return value
            last = value
            pump(interval)
        raise E2eError(f"{description}: tiempo agotado (último valor: {last!r})")

    def snippet(self) -> str:
        """Best-effort dump of the rendered DOM, for failure reports."""
        try:
            html = self.eval_json(
                "var main = document.querySelector('.main') || document.body;"
                "return main.innerHTML.slice(0, 4000);"
            )
        except E2eError:
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
        raise E2eError(f"no se pudo capturar la ventana en {path}: {'; '.join(errors)}")

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
# Xvfb, wrapper and temporary daemon
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
                raise E2eError(f"no se pudo arrancar Xvfb: {exc}") from exc
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
        raise E2eError("no se pudo arrancar Xvfb en ningún display libre")

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


WRAPPER_TEMPLATE = """#!/bin/sh
{{
  printf '=== ARGS ===\\n%s\\n' "$*"
  printf '=== OVERLAY ===\\n%s\\n' "${{OPENCODE_CONFIG_CONTENT:-}}"
}} >> "$CAPTURE/log.txt"
exec {opencode} "$@"
"""


class Daemon:
    """A daemon process bound to its own temporary database, config and port.

    ``PATH`` starts with a wrapper that captures every opencode invocation and
    then delegates to the real binary. ``XDG_DATA_HOME`` is temporary too, so
    the instruction file and opencode's sessions stay inside the test.
    """

    def __init__(
        self,
        repo_root: str,
        *,
        opencode_bin: str,
        port: int | None,
        timeout: float,
        keep_temp: bool,
    ) -> None:
        self.repo_root = repo_root
        self.main_js = os.path.join(repo_root, "packages", "daemon", "dist", "main.js")
        self.ui_root = os.environ.get("LAICRON_UI_ROOT") or os.path.join(
            repo_root, "packages", "ui", "dist"
        )
        self.timeout = timeout
        self.keep_temp = keep_temp
        self.temp_dir = tempfile.mkdtemp(prefix="laicron-e2e-usage-")
        self.db_path = os.path.join(self.temp_dir, "laicron.db")
        self.config_dir = os.path.join(self.temp_dir, "config")
        self.log_path = os.path.join(self.temp_dir, "daemon.log")
        self.wrapper_dir = os.path.join(self.temp_dir, "bin")
        self.capture_dir = os.path.join(self.temp_dir, "capture")
        self.data_home = os.path.join(self.temp_dir, "data")
        self.job_cwd = os.path.join(self.temp_dir, "cwd")
        self.capture_log = os.path.join(self.capture_dir, "log.txt")
        self.port = port if port is not None else free_port()
        self.token: str | None = None
        self.process: subprocess.Popen[bytes] | None = None
        self._log_handle: Any = None

        self.node = shutil.which("node")
        if self.node is None:
            raise E2eError("no se encontró node en el PATH para lanzar el daemon")
        if not os.path.isfile(self.main_js):
            raise E2eError(f"falta el daemon compilado: {self.main_js} (ejecuta pnpm build)")
        if not os.path.isfile(os.path.join(self.ui_root, "index.html")):
            raise E2eError(f"falta la interfaz compilada: {self.ui_root} (ejecuta pnpm build)")
        if not os.access(opencode_bin, os.X_OK):
            raise E2eError(f"opencode real no es ejecutable: {opencode_bin}")

        for directory in (
            self.wrapper_dir,
            self.capture_dir,
            self.data_home,
            self.job_cwd,
        ):
            os.makedirs(directory, exist_ok=True)

        wrapper_path = os.path.join(self.wrapper_dir, "opencode")
        with open(wrapper_path, "w", encoding="utf-8") as handle:
            handle.write(WRAPPER_TEMPLATE.format(opencode=opencode_bin))
        os.chmod(wrapper_path, 0o755)
        open(self.capture_log, "w", encoding="utf-8").close()

        env = os.environ.copy()
        env.update(
            {
                "LAICRON_DB_PATH": self.db_path,
                "LAICRON_CONFIG_DIR": self.config_dir,
                "LAICRON_UI_ROOT": self.ui_root,
                "LAICRON_PORT": str(self.port),
                "LAICRON_HOST": "127.0.0.1",
                "XDG_DATA_HOME": self.data_home,
                "CAPTURE": self.capture_dir,
            }
        )
        env["PATH"] = f"{self.wrapper_dir}:{env.get('PATH', '')}"
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
                raise E2eError(
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
            raise E2eError(f"el daemon no respondió en {self.timeout:.0f}s:\n{self.log_tail()}")

        token_path = os.path.join(self.config_dir, "token")
        try:
            with open(token_path, "r", encoding="utf-8") as handle:
                self.token = handle.read().strip()
        except OSError as exc:
            raise E2eError(f"no se pudo leer el token temporal: {exc}") from exc
        if not self.token:
            raise E2eError("el daemon arrancó sin token")

        print(f"[daemon] {self.base_url} db={self.db_path}")
        print(f"[daemon] PATH empieza por {self.wrapper_dir}")
        print(f"[daemon] XDG_DATA_HOME={self.data_home}")

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
# API helpers
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
        raise E2eError(f"{method} {path} devolvió {exc.code}: {detail}") from exc
    except URLError as exc:
        raise E2eError(f"{method} {path} no respondió: {exc}") from exc
    if not body:
        return None
    try:
        return json.loads(body.decode("utf-8"))
    except json.JSONDecodeError as exc:
        raise E2eError(f"{method} {path} no devolvió JSON: {body[:300]!r}") from exc


def assert_equal(actual: Any, expected: Any, label: str) -> None:
    if actual != expected:
        raise E2eError(f"{label}: {actual!r} (esperado {expected!r})")


def assert_true(value: Any, label: str) -> None:
    if not value:
        raise E2eError(label)


def read_text(path: str) -> str:
    with open(path, "r", encoding="utf-8", errors="replace") as handle:
        return handle.read()


def read_from(path: str, offset: int) -> str:
    try:
        with open(path, "r", encoding="utf-8", errors="replace") as handle:
            handle.seek(offset)
            return handle.read()
    except OSError:
        return ""


def file_size(path: str) -> int:
    try:
        return os.path.getsize(path)
    except OSError:
        return 0


# ---------------------------------------------------------------------------
# Wrapper capture parsing
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class CaptureEntry:
    """One wrapper invocation: its arguments and the overlay it received."""

    args: str
    overlay: str


def parse_captures(text: str) -> list[CaptureEntry]:
    """Parses the wrapper log into invocations.

    The wrapper writes three lines per call (``=== ARGS ===``, the arguments,
    ``=== OVERLAY ===``) plus one line with the overlay (empty when unset).
    """
    entries: list[CaptureEntry] = []
    lines = text.splitlines()
    index = 0
    while index < len(lines):
        if lines[index] != "=== ARGS ===":
            index += 1
            continue
        args = lines[index + 1] if index + 1 < len(lines) else ""
        overlay = ""
        if index + 2 < len(lines) and lines[index + 2] == "=== OVERLAY ===":
            overlay = lines[index + 3] if index + 3 < len(lines) else ""
            index += 4
        else:
            index += 2
        entries.append(CaptureEntry(args=args, overlay=overlay))
    return entries


def last_entry(entries: list[CaptureEntry], predicate: Any, label: str) -> CaptureEntry:
    for entry in reversed(entries):
        if predicate(entry.args.split()):
            return entry
    raise E2eError(f"no se encontró ninguna llamada {label} en el log del wrapper")


def is_run(args: list[str]) -> bool:
    return len(args) > 0 and args[0] == "run"


def is_export(args: list[str]) -> bool:
    return len(args) >= 2 and args[0] == "session" and args[1] == "export"


def parse_overlay(entry: CaptureEntry) -> dict[str, Any]:
    if entry.overlay.strip() == "":
        return {}
    try:
        value = json.loads(entry.overlay)
    except json.JSONDecodeError as exc:
        raise E2eError(f"el overlay no es JSON válido: {entry.overlay!r}") from exc
    if not isinstance(value, dict):
        raise E2eError(f"el overlay no es un objeto JSON: {entry.overlay!r}")
    return value


# ---------------------------------------------------------------------------
# Cases
# ---------------------------------------------------------------------------


def future_instant() -> str:
    instant = datetime.now(timezone.utc) + timedelta(days=1)
    return instant.replace(microsecond=0).isoformat().replace("+00:00", "Z")


def read_cron_instructions(repo_root: str) -> str:
    """Reads the fixed instruction from the built core package."""
    node = shutil.which("node")
    if node is None:
        raise E2eError("no se encontró node para leer CRON_INSTRUCTIONS")
    module = os.path.join(repo_root, "packages", "core", "dist", "runners", "cron-instructions.js")
    if not os.path.isfile(module):
        raise E2eError(f"falta el módulo compilado: {module} (ejecuta pnpm build)")
    script = (
        "import { CRON_INSTRUCTIONS } from "
        + json.dumps(module)
        + ";process.stdout.write(JSON.stringify(CRON_INSTRUCTIONS));"
    )
    completed = subprocess.run(
        [node, "--input-type=module", "-e", script],
        cwd=repo_root,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        timeout=30,
    )
    if completed.returncode != 0:
        raise E2eError(f"no se pudo leer CRON_INSTRUCTIONS: {completed.stderr.strip()}")
    try:
        value = json.loads(completed.stdout)
    except json.JSONDecodeError as exc:
        raise E2eError(f"CRON_INSTRUCTIONS no devolvió JSON: {completed.stdout!r}") from exc
    if not isinstance(value, str):
        raise E2eError("CRON_INSTRUCTIONS no es texto")
    return value


def warm_up_mcp_listing(args: argparse.Namespace) -> None:
    """Starts opencode's background service and waits for the real MCP catalog.

    With a fresh ``XDG_DATA_HOME`` the first ``mcp list`` can answer "No MCP
    servers configured" while the service starts, and the daemon's 5 s lister
    budget would then see an empty catalog and skip the overlay. Warming the
    service here keeps the run focused on the overlay, not on startup latency.
    """
    wrapper = os.path.join(args.daemon.wrapper_dir, "opencode")
    last = ""
    for _attempt in range(8):
        try:
            completed = subprocess.run(
                [wrapper, "mcp", "list"],
                cwd=args.daemon.job_cwd,
                env=args.daemon.env,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                timeout=30,
            )
        except (OSError, subprocess.SubprocessError) as exc:
            last = str(exc)
            time.sleep(1.0)
            continue
        last = completed.stdout
        if completed.returncode == 0 and "github" in last and "xerj" in last:
            print("[mcp] servicio caliente: github y xerj visibles")
            return
        time.sleep(1.0)
    raise E2eError(f"opencode mcp list no devolvió el catálogo esperado: {last[-500:]!r}")


def create_job(args: argparse.Namespace, name: str, mcp_overrides: dict[str, str]) -> dict[str, Any]:
    payload = {
        "name": name,
        "runner": "opencode",
        "prompt": PROMPT,
        "model": MODEL,
        "cwd": args.daemon.job_cwd,
        "scheduleKind": "once",
        "scheduleExpr": future_instant(),
        "timezone": "UTC",
        "notify": False,
        "mcpOverrides": mcp_overrides,
    }
    response = api_json(
        args.base_url,
        args.token,
        "/api/jobs",
        method="POST",
        payload=payload,
        timeout=30,
    )
    job = response.get("job") if isinstance(response, dict) else None
    if not isinstance(job, dict) or not isinstance(job.get("id"), str):
        raise E2eError(f"POST /api/jobs no devolvió un cron: {response!r}")
    return job


def find_job(args: argparse.Namespace, name: str) -> dict[str, Any]:
    response = api_json(args.base_url, args.token, "/api/jobs")
    jobs = response.get("jobs") if isinstance(response, dict) else None
    if isinstance(jobs, list):
        for job in jobs:
            if isinstance(job, dict) and job.get("name") == name:
                return job
    raise E2eError(f"no se encontró el cron «{name}» en la API")


def fetch_usage(args: argparse.Namespace, job_id: str) -> dict[str, Any]:
    response = api_json(
        args.base_url, args.token, f"/api/jobs/{quote(job_id, safe='')}/usage"
    )
    usage = response.get("usage") if isinstance(response, dict) else None
    if not isinstance(usage, dict):
        raise E2eError(f"GET /usage no devolvió usage: {response!r}")
    return usage


def execute_job(
    args: argparse.Namespace, job_id: str
) -> tuple[dict[str, Any], list[CaptureEntry]]:
    """Runs the job now and returns the run and the wrapper captures of that run."""
    capture_offset = file_size(args.daemon.capture_log)
    started = time.monotonic()
    response = api_json(
        args.base_url,
        args.token,
        f"/api/jobs/{quote(job_id, safe='')}/run",
        method="POST",
        timeout=MAX_RUN_SECONDS + 20,
    )
    elapsed = time.monotonic() - started
    run = response.get("run") if isinstance(response, dict) else None
    if not isinstance(run, dict):
        raise E2eError(f"POST /run no devolvió una ejecución: {response!r}")
    if elapsed > MAX_RUN_SECONDS:
        raise E2eError(f"la ejecución tardó {elapsed:.1f}s (máximo {MAX_RUN_SECONDS:.0f}s)")
    captures = parse_captures(read_from(args.daemon.capture_log, capture_offset))
    return run, captures


def check_run_overlay(
    entries: list[CaptureEntry],
    *,
    expect_mcp: bool,
    instructions_path: str,
    label: str,
) -> dict[str, Any]:
    entry = last_entry(entries, is_run, "run")
    tokens = entry.args.split()
    if "--standalone" not in tokens:
        raise E2eError(f"{label}: la llamada run no lleva --standalone: {entry.args!r}")
    overlay = parse_overlay(entry)

    instructions = overlay.get("instructions")
    if not isinstance(instructions, list) or instructions_path not in instructions:
        raise E2eError(
            f"{label}: el overlay no incluye {instructions_path!r} en instructions: {overlay!r}"
        )

    if expect_mcp:
        mcp = overlay.get("mcp")
        servers = mcp.get("servers") if isinstance(mcp, dict) else None
        if not isinstance(servers, dict):
            raise E2eError(f"{label}: el overlay no lleva mcp.servers: {overlay!r}")
        xerj = servers.get("xerj")
        github = servers.get("github")
        assert_equal(
            xerj.get("disabled") if isinstance(xerj, dict) else None,
            True,
            f"{label}: mcp.servers.xerj.disabled",
        )
        assert_equal(
            github.get("disabled") if isinstance(github, dict) else None,
            False,
            f"{label}: mcp.servers.github.disabled",
        )
    elif "mcp" in overlay:
        raise E2eError(f"{label}: un cron todo heredado no debe enviar mcp: {overlay!r}")

    return overlay


def check_export_standalone(entries: list[CaptureEntry], label: str) -> None:
    entry = last_entry(entries, is_export, "session export")
    tokens = entry.args.split()
    if "--standalone" not in tokens:
        raise E2eError(
            f"{label}: session export no lleva --standalone y no verá la sesión privada: "
            f"{entry.args!r}"
        )


def check_usage(
    args: argparse.Namespace, job_id: str, run: dict[str, Any], label: str
) -> dict[str, Any]:
    assert_equal(run.get("status"), "success", f"{label}: estado del run")
    input_tokens = run.get("inputTokens")
    if not isinstance(input_tokens, int) or input_tokens <= 0:
        raise E2eError(f"{label}: inputTokens debe ser > 0, es {input_tokens!r}")
    cost = run.get("costUsd")
    if not isinstance(cost, (int, float)) or cost < 0:
        raise E2eError(f"{label}: costUsd debe ser >= 0, es {cost!r}")

    runs_response = api_json(args.base_url, args.token, f"/api/jobs/{quote(job_id, safe='')}/runs")
    runs = runs_response.get("runs") if isinstance(runs_response, dict) else None
    if not isinstance(runs, list) or len(runs) != 1:
        raise E2eError(f"{label}: GET /runs debía devolver una ejecución: {runs_response!r}")
    stored = runs[0]
    assert_equal(stored.get("inputTokens"), input_tokens, f"{label}: inputTokens en /runs")
    assert_equal(stored.get("costUsd"), cost, f"{label}: costUsd en /runs")

    usage_response = api_json(
        args.base_url, args.token, f"/api/jobs/{quote(job_id, safe='')}/usage"
    )
    usage = usage_response.get("usage") if isinstance(usage_response, dict) else None
    if not isinstance(usage, dict):
        raise E2eError(f"{label}: GET /usage no devolvió usage: {usage_response!r}")
    assert_equal(usage.get("inputTokens"), input_tokens, f"{label}: total inputTokens")
    assert_equal(usage.get("costUsd"), cost, f"{label}: total costUsd")
    assert_equal(usage.get("runs"), 1, f"{label}: runs")
    assert_equal(usage.get("runsWithUsage"), 1, f"{label}: runsWithUsage")
    for field in ("outputTokens", "reasoningTokens", "cacheReadTokens", "cacheWriteTokens"):
        assert_equal(usage.get(field), run.get(field), f"{label}: total {field}")
    print(
        f"[{label}] usage: input={usage.get('inputTokens')} output={usage.get('outputTokens')} "
        f"cost={usage.get('costUsd')} runsWithUsage={usage.get('runsWithUsage')}"
    )
    return usage


def check_chat(args: argparse.Namespace, job_id: str, label: str) -> list[dict[str, Any]]:
    response = api_json(
        args.base_url, args.token, f"/api/jobs/{quote(job_id, safe='')}/messages"
    )
    messages = response.get("messages") if isinstance(response, dict) else None
    if not isinstance(messages, list) or len(messages) < 2:
        raise E2eError(f"{label}: el chat no tiene el prompt y la respuesta: {response!r}")
    for message in messages:
        content = message.get("content") if isinstance(message, dict) else None
        if isinstance(content, str) and INSTRUCTION_SNIPPET in content:
            raise E2eError(f"{label}: la instrucción oculta aparece en el chat: {content!r}")
    users = [message for message in messages if message.get("role") == "user"]
    assistants = [message for message in messages if message.get("role") == "assistant"]
    if len(users) != 1 or users[0].get("content") != PROMPT:
        raise E2eError(f"{label}: el mensaje de usuario no es el prompt: {users!r}")
    if not assistants or not str(assistants[-1].get("content", "")).strip():
        raise E2eError(f"{label}: falta la respuesta del asistente: {assistants!r}")
    print(f"[{label}] chat: {len(messages)} mensajes, sin la instrucción oculta")
    return messages


def case_real_run(
    args: argparse.Namespace, instructions: str
) -> tuple[dict[str, Any], dict[str, Any]]:
    """4.1: real run with fixed MCPs, usage and hidden instruction."""
    job = create_job(args, "e2e-usage-overlay", {"xerj": "off", "github": "on"})
    job_id = str(job["id"])
    print(f"[4.1] cron {job_id} creado con xerj=off, github=on")

    run, captures = execute_job(args, job_id)
    print(f"[4.1] run {run.get('id')} estado={run.get('status')} duración={run.get('durationMs')}ms")

    instructions_path = os.path.join(
        args.daemon.data_home, "laicron", "prompts", "cron-system.md"
    )
    overlay = check_run_overlay(
        captures,
        expect_mcp=True,
        instructions_path=instructions_path,
        label="4.1",
    )
    print(f"[4.1] overlay literal: {json.dumps(overlay, ensure_ascii=False)}")

    if not os.path.isfile(instructions_path):
        raise E2eError(f"4.1: no existe el fichero de instrucciones {instructions_path}")
    content = read_text(instructions_path)
    assert_equal(content, instructions, "4.1: contenido del fichero de instrucciones")
    print(f"[4.1] instrucciones: {instructions_path} ({len(content)} bytes)")

    check_export_standalone(captures, "4.1")
    usage = check_usage(args, job_id, run, "4.1")
    check_chat(args, job_id, "4.1")

    return job, usage


def case_inherited(args: argparse.Namespace) -> None:
    """4.1: every MCP inherited sends instructions but no mcp key."""
    job = create_job(args, "e2e-usage-heredado", {})
    job_id = str(job["id"])
    print(f"[4.1 herencia] cron {job_id} creado con mcpOverrides={{}}")

    run, captures = execute_job(args, job_id)
    instructions_path = os.path.join(
        args.daemon.data_home, "laicron", "prompts", "cron-system.md"
    )
    overlay = check_run_overlay(
        captures,
        expect_mcp=False,
        instructions_path=instructions_path,
        label="4.1 herencia",
    )
    print(f"[4.1 herencia] overlay literal: {json.dumps(overlay, ensure_ascii=False)}")
    check_export_standalone(captures, "4.1 herencia")
    check_usage(args, job_id, run, "4.1 herencia")


def format_expected_tokens(value: int) -> str:
    return f"{value:,}".replace(",", ".")


def insert_legacy_run(db_path: str, job_id: str) -> str:
    """Inserts a run from before the usage columns existed (all usage NULL).

    Only the fields a normal run always has are set; ``input_tokens``,
    ``output_tokens``, ``reasoning_tokens``, ``cache_*`` and ``cost_usd`` stay
    NULL so the UI must show «—» in both consumption columns.
    """
    run_id = "e2e-legacy-run-without-usage"
    started_at = 1_577_836_800_000  # 2020-01-01T00:00:00Z, older than any real run
    try:
        with closing(sqlite3.connect(db_path, timeout=10)) as connection:
            with connection:
                connection.execute(
                    'INSERT INTO runs (id, job_id, "trigger", status, started_at, '
                    "finished_at, duration_ms, output) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                    (
                        run_id,
                        job_id,
                        "scheduled",
                        "success",
                        started_at,
                        started_at + 1_000,
                        1_000,
                        "ejecución antigua sin consumo",
                    ),
                )
    except sqlite3.Error as exc:
        raise E2eError(f"no se pudo insertar el run antiguo en SQLite: {exc}") from exc
    return run_id


def case_ui(
    driver: WindowDriver,
    args: argparse.Namespace,
    job_id: str,
    usage: dict[str, Any],
    screenshot_dir: str,
) -> None:
    """3.1: usage card, breakdown and history columns in the real window."""
    driver.js(f"location.hash = '#/jobs/{quote(job_id, safe='')}';")
    driver.wait_json(
        "var card = document.getElementById('job-usage');"
        "return card !== null && card.querySelector('.usage-cost') !== null"
        " && card.querySelector('.usage-tokens') !== null"
        " && card.querySelector('.usage-runs') !== null"
        " && document.querySelectorAll('table.table tbody tr').length >= 2"
        " && document.querySelectorAll('table.table thead th').length > 0;",
        args.timeout,
        "detalle con tarjeta de consumo e historial de dos runs",
    )
    state = driver.eval_json(
        "var card = document.getElementById('job-usage');"
        "if (card === null) { throw new Error('no existe #job-usage'); }"
        "var cost = card.querySelector('.usage-cost');"
        "var tokens = card.querySelector('.usage-tokens');"
        "var breakdown = card.querySelector('.usage-breakdown');"
        "var runs = card.querySelector('.usage-runs');"
        "if (cost === null || tokens === null || breakdown === null || runs === null) {"
        "  throw new Error('faltan .usage-cost, .usage-tokens, .usage-breakdown o .usage-runs');"
        "}"
        "var headers = Array.prototype.map.call("
        "  document.querySelectorAll('table.table thead th'),"
        "  function(th) { return th.textContent.trim(); }"
        ");"
        "var rows = Array.prototype.map.call("
        "  document.querySelectorAll('table.table tbody tr'),"
        "  function(tr) {"
        "    return Array.prototype.map.call("
        "      tr.querySelectorAll('td.usage-cell'),"
        "      function(td) { return td.textContent.trim(); }"
        "    );"
        "  }"
        ");"
        "return {"
        "  cost: cost.textContent.trim(),"
        "  tokens: tokens.textContent.trim(),"
        "  breakdown: breakdown.textContent.trim(),"
        "  runsText: runs.textContent.trim(),"
        "  headers: headers,"
        "  rows: rows"
        "};"
    )
    if not isinstance(state, dict):
        raise E2eError(f"3.1: no se pudo leer la tarjeta de consumo: {state!r}")

    headers = [str(header) for header in state.get("headers", [])]
    for expected in ("Tokens", "Coste"):
        if expected not in headers:
            raise E2eError(f"3.1: falta la cabecera «{expected}» en el historial: {headers!r}")

    tokens_text = str(state.get("tokens", ""))
    expected_tokens = format_expected_tokens(
        int(usage.get("inputTokens", 0)) + int(usage.get("outputTokens", 0))
    )
    if not re.search(r"\d", tokens_text):
        raise E2eError(f"3.1: .usage-tokens no muestra dígitos: {tokens_text!r}")
    digits = re.sub(r"\D", "", tokens_text)
    if digits != re.sub(r"\D", "", expected_tokens):
        raise E2eError(
            f"3.1: .usage-tokens={tokens_text!r} no coincide con {expected_tokens!r}"
        )

    breakdown = str(state.get("breakdown", ""))
    if not breakdown.startswith("Entrada ") or "· Salida " not in breakdown:
        raise E2eError(f"3.1: línea de desglose inesperada: {breakdown!r}")

    cost_text = str(state.get("cost", ""))
    if not cost_text.startswith("$"):
        raise E2eError(f"3.1: .usage-cost no es un importe: {cost_text!r}")

    runs_text = str(state.get("runsText", ""))
    if "1 de 2" not in runs_text:
        raise E2eError(
            f"3.1: la tarjeta no indica 1 de 2 ejecuciones con datos: {runs_text!r}"
        )

    rows = state.get("rows", [])
    if not isinstance(rows, list) or len(rows) != 2:
        raise E2eError(f"3.1: el historial debía tener dos filas: {rows!r}")
    recent = [str(cell) for cell in rows[0]]
    legacy = [str(cell) for cell in rows[1]]
    if len(recent) < 2 or len(legacy) < 2:
        raise E2eError(f"3.1: faltan celdas de consumo en el historial: {rows!r}")
    if recent[0] == "—" or recent[1] == "—":
        raise E2eError(f"3.1: la fila del run con datos muestra «—»: {recent!r}")
    if legacy[0] != "—" or legacy[1] != "—":
        raise E2eError(
            f"3.1: la fila del run antiguo debía mostrar «—» en Tokens y Coste: {legacy!r}"
        )

    print(
        f"[3.1] tarjeta: coste={cost_text!r} tokens={tokens_text!r} "
        f"desglose={breakdown!r} ({runs_text})"
    )
    print(f"[3.1] cabeceras: {headers!r}")
    print(f"[3.1] fila reciente: {recent!r}")
    print(f"[3.1] fila antigua (sin datos): {legacy!r}")

    driver.scroll_to("#job-usage")
    card_shot = os.path.join(screenshot_dir, "detail-usage.png")
    driver.screenshot(card_shot)
    print(f"[captura] tarjeta de consumo: {card_shot}")

    driver.scroll_to("table.table")
    history_shot = os.path.join(screenshot_dir, "detail-history.png")
    driver.screenshot(history_shot)
    print(f"[captura] historial con Tokens/Coste: {history_shot}")


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description=(
            "Comprueba con opencode real el contexto de cron, el consumo y la tarjeta de "
            "consumo de la ventana."
        )
    )
    parser.add_argument(
        "--opencode-bin",
        default=os.environ.get("LAICRON_OPENCODE_BIN", DEFAULT_OPENCODE),
        help=f"Binario real de opencode (por defecto {DEFAULT_OPENCODE}).",
    )
    parser.add_argument(
        "--port",
        type=int,
        default=0,
        help="Puerto del daemon temporal (0 elige uno libre).",
    )
    parser.add_argument(
        "--screenshot-dir",
        default=os.path.join(tempfile.gettempdir(), "opencode", "laicron-e2e-usage"),
        help="Directorio donde guardar las capturas PNG.",
    )
    parser.add_argument(
        "--timeout",
        type=float,
        default=90.0,
        help="Segundos de espera por paso de UI (por defecto 90).",
    )
    parser.add_argument(
        "--no-build",
        action="store_true",
        help="No ejecutar pnpm build antes de arrancar el daemon.",
    )
    parser.add_argument(
        "--keep-temp",
        action="store_true",
        help="Conservar el directorio temporal del daemon.",
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
        raise E2eError(f"no se pudo ejecutar pnpm build: {exc}") from exc
    if completed.returncode != 0:
        print(completed.stdout[-4000:], file=sys.stderr)
        raise E2eError(f"pnpm build falló con código {completed.returncode}")
    print("[build] OK")


def main(argv: list[str]) -> int:
    args = build_parser().parse_args(argv)
    args.repo_root = repo_root_from_script()
    args.daemon: Daemon | None = None
    args.base_url = ""
    args.token = ""

    screenshot_dir = os.path.abspath(args.screenshot_dir)
    os.makedirs(screenshot_dir, exist_ok=True)

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

        daemon = Daemon(
            args.repo_root,
            opencode_bin=args.opencode_bin,
            port=None if args.port == 0 else args.port,
            timeout=args.timeout,
            keep_temp=args.keep_temp,
        )
        daemon.start()
        args.daemon = daemon
        args.base_url = daemon.base_url
        args.token = daemon.token or ""
        if not args.token:
            raise E2eError("no hay token para la ventana")

        warm_up_mcp_listing(args)
        instructions = read_cron_instructions(args.repo_root)
        driver = WindowDriver(args.base_url, args.token)
        driver.open(args.timeout)
        driver.wait_json(
            "return document.querySelector('.topbar') !== null"
            " && document.querySelector('.page-title') !== null;",
            args.timeout,
            "arranque de la interfaz (barra superior y vista de lista)",
        )

        job_id: str | None = None
        usage: dict[str, Any] | None = None
        try:
            job, usage = case_real_run(args, instructions)
            job_id = str(job["id"])
            print("4.1 (run real) OK")
        except E2eError as exc:
            failures.append(f"4.1 (run real) FAIL: {exc}")
            print(f"4.1 (run real) FAIL: {exc}")
            try:
                job = find_job(args, "e2e-usage-overlay")
                job_id = str(job["id"])
                fallback_usage = fetch_usage(args, job_id)
                usage = fallback_usage if fallback_usage.get("runsWithUsage", 0) > 0 else None
            except E2eError:
                job_id = None
                usage = None

        try:
            case_inherited(args)
            print("4.1 (herencia) OK")
        except E2eError as exc:
            failures.append(f"4.1 (herencia) FAIL: {exc}")
            print(f"4.1 (herencia) FAIL: {exc}")

        if job_id is not None and usage is not None:
            try:
                legacy_run_id = insert_legacy_run(args.daemon.db_path, job_id)
                print(f"[3.1] run antiguo insertado sin consumo: {legacy_run_id}")
                usage = fetch_usage(args, job_id)
                assert_equal(usage.get("runs"), 2, "3.1: runs tras insertar el antiguo")
                assert_equal(usage.get("runsWithUsage"), 1, "3.1: runsWithUsage")
                case_ui(driver, args, job_id, usage, screenshot_dir)
                print("3.1 OK")
            except E2eError as exc:
                failures.append(f"3.1 FAIL: {exc}")
                print(f"3.1 FAIL: {exc}")
                print("---- DOM (primeros 4000 caracteres) ----")
                print(driver.snippet())
                print("----------------------------------------")
        else:
            failures.append("3.1 FAIL: no hay cron con consumo para abrir")
            print("3.1 FAIL: no hay cron con consumo para abrir")
    except E2eError as exc:
        failures.append(f"e2e FAIL: {exc}")
        print(f"e2e FAIL: {exc}", file=sys.stderr)
        if daemon is not None:
            print("---- daemon.log ----", file=sys.stderr)
            print(daemon.log_tail(), file=sys.stderr)
            print("--------------------", file=sys.stderr)
    finally:
        if driver is not None:
            driver.close()
        if daemon is not None:
            daemon.stop()
            if args.keep_temp:
                print(f"[temp] {daemon.temp_dir}")
        xvfb.stop()

    if failures:
        print("\n[resumen] FALLOS:")
        for failure in failures:
            print(f"  - {failure}")
        return 1

    print("\n[resumen] 4.1 y 3.1 OK")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
