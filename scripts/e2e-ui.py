#!/usr/bin/env python3
"""End-to-end check of the LAICron UI driving the real GTK3 + WebKit2 window.

It covers the two interactive acceptance tasks:

* 8.2 - create a cron from the form and see it in the list.
* 8.3 - trigger "Ejecutar ahora" from the detail view and see the run in the
  history table and the assistant message in the chat.

The window is driven through JavaScript (`WebKit2.WebView.run_javascript`) and
every assertion reads the live DOM. Run it against a daemon started with a
temporary database:

    python3 scripts/e2e-ui.py --base-url http://127.0.0.1:7317 --token <token>
    LAICRON_PORT=7317 LAICRON_TOKEN=<token> python3 scripts/e2e-ui.py

It exits 0 when both checks pass and 1 otherwise. No repository path is
assumed: everything comes from the arguments, the environment or the URL.
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import tempfile
import time
from typing import Any
from urllib.parse import quote

import gi

gi.require_version("Gtk", "3.0")
gi.require_version("WebKit2", "4.1")

from gi.repository import GLib, Gtk, WebKit2  # noqa: E402  (must follow require_version)

DEFAULT_PORT = 7317
RUN_BUTTON_LABEL = "Ejecutar ahora"
SUCCESS_LABEL = "Correcta"
EXPECTED_OUTPUT = "hola-ui"


class UiError(RuntimeError):
    """A check failed or the window could not be driven."""


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
        self.window = Gtk.Window(title="LAICron e2e")
        self.window.set_default_size(1280, 900)
        self.webview = WebKit2.WebView()
        settings = self.webview.get_settings()
        settings.set_property("enable-developer-extras", True)
        self.window.add(self.webview)
        self.window.show_all()

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
        env = dict(os.environ)
        try:
            subprocess.run(
                ["import", "-window", "root", path],
                check=True,
                env=env,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                timeout=30,
            )
        except (OSError, subprocess.SubprocessError) as exc:
            raise UiError(f"no se pudo capturar la pantalla en {path}: {exc}") from exc

    def close(self) -> None:
        self.window.destroy()
        pump(0.2)


def once_value_in(minutes: int) -> str:
    """`datetime-local` value (local time) for `minutes` from now."""
    target = time.localtime(time.time() + minutes * 60)
    return time.strftime("%Y-%m-%dT%H:%M", target)


def fill_form_script(name: str, workdir: str, once_at: str) -> str:
    return f"""
(function() {{
  function setValue(selector, value) {{
    var element = document.querySelector(selector);
    if (element === null) {{ throw new Error('selector no encontrado: ' + selector); }}
    element.value = value;
    element.dispatchEvent(new Event('input', {{ bubbles: true }}));
    element.dispatchEvent(new Event('change', {{ bubbles: true }}));
    return element.value;
  }}
  function setChecked(selector, value) {{
    var element = document.querySelector(selector);
    if (element === null) {{ throw new Error('selector no encontrado: ' + selector); }}
    element.checked = value;
    element.dispatchEvent(new Event('input', {{ bubbles: true }}));
    element.dispatchEvent(new Event('change', {{ bubbles: true }}));
    return element.checked;
  }}
  setValue('#job-name', {json.dumps(name)});
  setValue('#job-runner', 'shell');
  setValue('#job-command', 'echo {EXPECTED_OUTPUT}');
  setValue('#job-cwd', {json.dumps(workdir)});
  setValue('#job-schedule-kind', 'once');
  setValue('#job-once-at', {json.dumps(once_at)});
  setChecked('#job-notify', false);
  return 'filled';
}})()
"""


def submit_form(driver: WindowDriver) -> None:
    driver.js(
        """
(function() {
  var form = document.querySelector('form.form');
  if (form === null) { throw new Error('no se encontró form.form'); }
  var submit = form.querySelector('button[type="submit"]');
  if (submit === null) { throw new Error('no se encontró el botón Guardar'); }
  submit.click();
  return 'clicked';
})()
"""
    )


def check_form_readback(driver: WindowDriver, name: str, workdir: str, once_at: str) -> dict[str, Any]:
    readback = driver.eval_json(
        """
var command = document.querySelector('#job-command');
var once = document.querySelector('#job-once-at');
return {
  name: document.querySelector('#job-name').value,
  runner: document.querySelector('#job-runner').value,
  command: command === null ? null : command.value,
  cwd: document.querySelector('#job-cwd').value,
  scheduleKind: document.querySelector('#job-schedule-kind').value,
  onceAt: once === null ? null : once.value,
  onceType: once === null ? null : once.type,
  notify: document.querySelector('#job-notify').checked,
  shellVisible: command !== null && !command.closest('.form-grid').hidden,
  onceVisible: once !== null && !once.closest('.form-grid').hidden,
  fieldErrors: Array.prototype.map.call(
    document.querySelectorAll('[data-error-for]:not([hidden])'),
    function(slot) { return slot.getAttribute('data-error-for') + ': ' + slot.textContent; }
  )
};
"""
    )
    if not isinstance(readback, dict):
        raise UiError(f"no se pudo leer el formulario: {readback!r}")

    problems: list[str] = []
    if readback.get("name") != name:
        problems.append(f"name={readback.get('name')!r}")
    if readback.get("runner") != "shell":
        problems.append(f"runner={readback.get('runner')!r}")
    if readback.get("command") != f"echo {EXPECTED_OUTPUT}":
        problems.append(f"command={readback.get('command')!r}")
    if readback.get("cwd") != workdir:
        problems.append(f"cwd={readback.get('cwd')!r}")
    if readback.get("scheduleKind") != "once":
        problems.append(f"scheduleKind={readback.get('scheduleKind')!r}")
    readback_once = str(readback.get("onceAt") or "")
    if readback_once[:16] != once_at[:16]:
        problems.append(f"onceAt={readback.get('onceAt')!r} (esperado {once_at!r})")
    if readback.get("notify") is not False:
        problems.append(f"notify={readback.get('notify')!r}")
    if readback.get("shellVisible") is not True:
        problems.append("los campos del ejecutor shell siguen ocultos")
    if readback.get("onceVisible") is not True:
        problems.append("el campo de fecha única sigue oculto")
    if readback.get("fieldErrors"):
        problems.append(f"errores de campo visibles: {readback['fieldErrors']}")
    if problems:
        raise UiError("el formulario no refleja lo rellenado: " + "; ".join(problems))
    return readback


def step_82(driver: WindowDriver, name: str, workdir: str, once_at: str, timeout: float) -> str:
    """Creates a cron from the form and returns its id from the list row."""
    driver.js("location.hash = '#/new';")
    driver.wait_json(
        "var form = document.querySelector('form.form');"
        "return form !== null && document.querySelector('#job-name') !== null;",
        timeout,
        "vista de creación (#/new)",
    )

    driver.js(fill_form_script(name, workdir, once_at))
    check_form_readback(driver, name, workdir, once_at)

    submit_form(driver)

    row = driver.wait_json(
        f"""
if (location.hash !== '#/') {{ return null; }}
var link = null;
document.querySelectorAll('a.job-name').forEach(function(anchor) {{
  if (anchor.textContent.trim() === {json.dumps(name)}) {{ link = anchor; }}
}});
if (link === null) {{ return null; }}
var tr = link.closest('tr');
var cells = Array.prototype.map.call(tr.children, function(td) {{ return td.textContent.trim(); }});
return {{
  href: link.getAttribute('href'),
  schedule: cells.length > 1 ? cells[1] : null,
  nextRun: cells.length > 2 ? cells[2] : null,
  lastStatus: cells.length > 3 ? cells[3] : null,
  row: cells
}};
""",
        timeout,
        f"fila «{name}» en la lista tras guardar",
    )

    if not isinstance(row, dict):
        raise UiError(f"fila inesperada: {row!r}")
    next_run = str(row.get("nextRun") or "").strip()
    if next_run in ("", "—"):
        raise UiError(f"la fila no muestra próxima ejecución (celda={next_run!r}, fila={row.get('row')!r})")
    schedule = str(row.get("schedule") or "")
    if "Una vez" not in schedule:
        raise UiError(f"la programación mostrada no es «Una vez»: {schedule!r}")

    href = str(row.get("href") or "")
    job_id = href.rsplit("/", 1)[-1]
    if not job_id:
        raise UiError(f"no se pudo extraer el id del cron desde {href!r}")
    print(f"[8.2] fila creada: id={job_id} programación={schedule!r} próxima={next_run!r}")
    return job_id


def open_detail(driver: WindowDriver, job_id: str, name: str, timeout: float) -> None:
    driver.js(f"location.hash = '#/jobs/{quote(job_id, safe='')}';")
    driver.wait_json(
        f"""
var title = document.querySelector('.page-title');
if (title === null || title.textContent.trim() !== {json.dumps(name)}) {{ return null; }}
var runButton = null;
document.querySelectorAll('.page-actions button').forEach(function(candidate) {{
  if (candidate.textContent.trim() === {json.dumps(RUN_BUTTON_LABEL)}) {{ runButton = candidate; }}
}});
if (runButton === null) {{ return null; }}
return {{ title: title.textContent.trim(), runs: document.querySelectorAll('.table tbody tr').length }};
""",
        timeout,
        "vista de detalle con «Ejecutar ahora»",
    )


def click_run_now(driver: WindowDriver) -> None:
    driver.js(
        f"""
(function() {{
  var target = null;
  document.querySelectorAll('.page-actions button').forEach(function(candidate) {{
    if (candidate.textContent.trim() === {json.dumps(RUN_BUTTON_LABEL)}) {{ target = candidate; }}
  }});
  if (target === null) {{ throw new Error('no se encontró el botón «{RUN_BUTTON_LABEL}»'); }}
  target.click();
  return 'clicked';
}})()
"""
    )


def step_83(driver: WindowDriver, job_id: str, name: str, timeout: float) -> dict[str, Any]:
    """Runs the cron from the detail view and checks history plus chat."""
    open_detail(driver, job_id, name, timeout)
    click_run_now(driver)

    result = driver.wait_json(
        f"""
var rows = document.querySelectorAll('.table tbody tr');
var first = rows.length > 0 ? rows[0] : null;
var badge = first === null ? null : first.querySelector('.badge');
var assistant = null;
document.querySelectorAll('.chat .message.assistant .message-content').forEach(function(node) {{
  if (node.textContent.indexOf({json.dumps(EXPECTED_OUTPUT)}) !== -1) {{ assistant = node.textContent.trim(); }}
}});
if (badge === null || badge.textContent.trim() !== {json.dumps(SUCCESS_LABEL)}) {{ return null; }}
if (assistant === null) {{ return null; }}
return {{
  status: badge.textContent.trim(),
  statusClass: badge.className,
  trigger: first.children.length > 1 ? first.children[1].textContent.trim() : null,
  startedAt: first.children.length > 2 ? first.children[2].textContent.trim() : null,
  duration: first.children.length > 3 ? first.children[3].textContent.trim() : null,
  exitCode: first.children.length > 4 ? first.children[4].textContent.trim() : null,
  chat: assistant,
  chatCount: document.querySelectorAll('.chat .message').length
}};
""",
        timeout,
        "ejecución «Correcta» en el historial y mensaje con el resultado en el chat",
    )

    if not isinstance(result, dict):
        raise UiError(f"resultado inesperado del detalle: {result!r}")
    if result.get("exitCode") not in ("0", 0):
        raise UiError(f"código de salida inesperado: {result.get('exitCode')!r}")
    print(
        "[8.3] historial: estado={status!r} disparador={trigger!r} inicio={started!r} "
        "duración={duration!r} salida={exit!r}".format(
            status=result.get("status"),
            trigger=result.get("trigger"),
            started=result.get("startedAt"),
            duration=result.get("duration"),
            exit=result.get("exitCode"),
        )
    )
    print(f"[8.3] chat: {result.get('chat')!r}")
    return result


def chat_screenshot_path(path: str) -> str:
    """Sibling path used for the chat capture (`detail.png` -> `detail-chat.png`)."""
    stem, extension = os.path.splitext(path)
    return f"{stem}-chat{extension or '.png'}"


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Comprueba la interfaz de LAICron creando un cron y ejecutándolo desde la ventana real.",
    )
    parser.add_argument(
        "--base-url",
        default=os.environ.get("LAICRON_BASE_URL"),
        help="URL base del daemon (por defecto http://127.0.0.1:<puerto>).",
    )
    parser.add_argument(
        "--port",
        type=int,
        default=int(os.environ.get("LAICRON_PORT", DEFAULT_PORT)),
        help=f"Puerto del daemon cuando no se pasa --base-url (por defecto {DEFAULT_PORT}).",
    )
    parser.add_argument(
        "--token",
        default=os.environ.get("LAICRON_TOKEN"),
        help="Token de acceso del daemon (o variable LAICRON_TOKEN).",
    )
    parser.add_argument(
        "--token-file",
        default=None,
        help="Archivo del que leer el token (evita pasarlo por la línea de comandos).",
    )
    parser.add_argument(
        "--name",
        default="e2e-ui-form",
        help="Nombre del cron que se crea (por defecto e2e-ui-form).",
    )
    parser.add_argument(
        "--workdir",
        default=tempfile.gettempdir(),
        help="Directorio de trabajo del cron shell (obligatorio en el formulario).",
    )
    parser.add_argument(
        "--once-in-minutes",
        type=int,
        default=10,
        help="Minutos hasta la ejecución única (por defecto 10).",
    )
    parser.add_argument(
        "--timeout",
        type=float,
        default=45.0,
        help="Segundos de espera por paso (por defecto 45).",
    )
    parser.add_argument(
        "--screenshot",
        default=None,
        help="Ruta PNG donde guardar una captura del detalle.",
    )
    return parser


def main(argv: list[str]) -> int:
    args = build_parser().parse_args(argv)

    token = args.token
    if args.token_file is not None:
        try:
            with open(args.token_file, "r", encoding="utf-8") as handle:
                token = handle.read().strip()
        except OSError as exc:
            print(f"error: no se pudo leer el token de {args.token_file}: {exc}", file=sys.stderr)
            return 2
    if token is None or token.strip() == "":
        print("error: falta el token (--token, --token-file o LAICRON_TOKEN)", file=sys.stderr)
        return 2

    base_url = args.base_url or f"http://127.0.0.1:{args.port}"
    workdir = os.path.abspath(args.workdir)
    if not os.path.isdir(workdir):
        print(f"error: el directorio de trabajo no existe: {workdir}", file=sys.stderr)
        return 2

    once_at = once_value_in(args.once_in_minutes)
    Gtk.init([])

    driver = WindowDriver(base_url, token)
    job_id: str | None = None
    failures: list[str] = []
    try:
        print(f"[e2e] base={base_url} nombre={args.name} cwd={workdir} fecha={once_at}")
        driver.open(args.timeout)

        driver.wait_json(
            "return document.querySelector('.topbar') !== null && "
            "document.querySelector('.page-title') !== null;",
            args.timeout,
            "arranque de la interfaz (barra superior y vista de lista)",
        )

        try:
            job_id = step_82(driver, args.name, workdir, once_at, args.timeout)
            print("8.2 OK")
        except UiError as exc:
            failures.append(f"8.2 FAIL: {exc}")
            print(f"8.2 FAIL: {exc}")
            print("---- DOM (primeros 4000 caracteres) ----")
            print(driver.snippet())
            print("----------------------------------------")

        if job_id is not None:
            try:
                step_83(driver, job_id, args.name, args.timeout)
                print("8.3 OK")
            except UiError as exc:
                failures.append(f"8.3 FAIL: {exc}")
                print(f"8.3 FAIL: {exc}")
                print("---- DOM (primeros 4000 caracteres) ----")
                print(driver.snippet())
                print("----------------------------------------")

            if args.screenshot is not None:
                try:
                    driver.screenshot(args.screenshot)
                    print(f"[e2e] captura: {args.screenshot}")
                    chat_path = chat_screenshot_path(args.screenshot)
                    driver.js(
                        "var chat = document.querySelector('.chat');"
                        "if (chat !== null) { chat.scrollIntoView({ block: 'center' }); }"
                    )
                    driver.screenshot(chat_path)
                    print(f"[e2e] captura del chat: {chat_path}")
                except UiError as exc:
                    print(f"[e2e] aviso: {exc}", file=sys.stderr)
    except UiError as exc:
        failures.append(f"error: {exc}")
        print(f"error: {exc}", file=sys.stderr)
    finally:
        driver.close()

    if failures:
        print("RESULTADO: FALLO")
        return 1
    print("RESULTADO: OK")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
