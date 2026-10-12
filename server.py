"""Serves the app at http://localhost:8000 and tells the browser to always check for the newest files,
so updates to the app show up on a normal reload (python -m http.server lets the browser cache old JS)."""
import http.server
import sys

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8000


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map, ".webmanifest": "application/manifest+json"}

    def end_headers(self):
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()


if __name__ == "__main__":
    with http.server.ThreadingHTTPServer(("localhost", PORT), NoCacheHandler) as httpd:
        print(f"LearningEnglish is running at http://localhost:{PORT}  (close this window to stop)")
        httpd.serve_forever()
