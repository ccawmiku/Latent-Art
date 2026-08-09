"""Small, dependency-free server for the Latent Art Wallpaper.

Wallpaper Engine URL: http://127.0.0.1:18088/
Run with: python server.py
"""

from __future__ import annotations

import os
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer


HOST = "127.0.0.1"
PORT = 18088
ROOT = os.path.dirname(os.path.abspath(__file__))


class WallpaperHandler(SimpleHTTPRequestHandler):
    # HTTP/1.0 closes idle connections promptly and keeps the long-running
    # process small when Wallpaper Engine is not requesting the page.
    protocol_version = "HTTP/1.0"

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def log_message(self, _format, *_args):
        # No console noise during normal Wallpaper Engine use.
        return

    def end_headers(self):
        self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
        self.send_header("Pragma", "no-cache")
        self.send_header("Access-Control-Allow-Origin", "*")
        super().end_headers()


class WallpaperServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True


def main() -> None:
    os.chdir(ROOT)
    with WallpaperServer((HOST, PORT), WallpaperHandler) as server:
        print(f"Latent Art Wallpaper listening at http://{HOST}:{PORT}/")
        # serve_forever blocks in select(); CPU use is effectively zero while idle.
        server.serve_forever(poll_interval=1.0)


if __name__ == "__main__":
    main()
