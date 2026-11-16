#!/usr/bin/env python3
"""LAICron desktop window built with GTK3 and WebKit2.

The window is a thin shell around the local web UI: it receives the URL as its
first argument, loads it in a WebKit view and does nothing else. Closing the
window only ends this Python process; the daemon keeps running under systemd.
"""

from __future__ import annotations

import os
import sys

APP_ID = "io.github.laicron.LAICron"
WINDOW_TITLE = "LAICron"
WINDOW_WIDTH = 1100
WINDOW_HEIGHT = 760


def prefers_english() -> bool:
    """True when the process environment asks for English."""
    value = (
        os.environ.get("LAICRON_LANG")
        or os.environ.get("LC_ALL")
        or os.environ.get("LC_MESSAGES")
        or os.environ.get("LANG")
        or ""
    )
    language = value.lower().replace("_", "-").split(".")[0]
    return language.startswith("en")


MISSING_BINDINGS_MESSAGE_ES = (
    "Error: no se encontró GTK3 o WebKit2 4.1. Instala las dependencias del "
    "sistema (por ejemplo, gir1.2-gtk-3.0 y gir1.2-webkit2-4.1) y vuelve a "
    "intentarlo."
)

MISSING_BINDINGS_MESSAGE_EN = (
    "Error: GTK3 or WebKit2 4.1 was not found. Install the system dependencies "
    "(for example gir1.2-gtk-3.0 and gir1.2-webkit2-4.1) and try again."
)

MISSING_BINDINGS_MESSAGE = (
    MISSING_BINDINGS_MESSAGE_EN if prefers_english() else MISSING_BINDINGS_MESSAGE_ES
)


def load_bindings() -> tuple[object, object] | None:
    """Imports Gtk 3 and WebKit2, preferring WebKit2 4.1 and falling back to 4.0."""
    try:
        import gi
    except ImportError:
        return None

    try:
        gi.require_version("Gtk", "3.0")
        try:
            gi.require_version("WebKit2", "4.1")
        except ValueError:
            gi.require_version("WebKit2", "4.0")
        from gi.repository import Gtk, WebKit2
    except (ImportError, ValueError):
        return None

    return Gtk, WebKit2


def build_window(Gtk: object, WebKit2: object, url: str) -> object:
    """Creates the application window with an expanded WebKit view."""
    application = Gtk.Application(application_id=APP_ID)

    def on_activate(app: object) -> None:
        window = Gtk.ApplicationWindow(application=app)
        window.set_title(WINDOW_TITLE)
        window.set_default_size(WINDOW_WIDTH, WINDOW_HEIGHT)

        webview = WebKit2.WebView()
        webview.set_hexpand(True)
        webview.set_vexpand(True)
        webview.load_uri(url)

        # GTK3 adds children with add() and shows the whole window at once.
        window.add(webview)
        window.show_all()

    application.connect("activate", on_activate)
    return application


def main(argv: list[str]) -> int:
    if len(argv) < 2:
        message = (
            "Error: missing interface URL. Usage: window.py <url>"
            if prefers_english()
            else "Error: falta la URL de la interfaz. Uso: window.py <url>"
        )
        print(message, file=sys.stderr)
        return 2

    bindings = load_bindings()
    if bindings is None:
        print(MISSING_BINDINGS_MESSAGE, file=sys.stderr)
        return 2

    Gtk, WebKit2 = bindings
    application = build_window(Gtk, WebKit2, argv[1])

    # Pass only the program name so GTK does not try to interpret the URL as a
    # file to open.
    return application.run([argv[0]])


if __name__ == "__main__":
    sys.exit(main(sys.argv))
