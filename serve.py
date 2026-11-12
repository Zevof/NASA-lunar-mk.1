#!/usr/bin/env python3
"""
Lunar Link Planner - local launcher (Python, no Go/Rust required).

Serves the FIXED static/ viewer and proxies the two NASA raster endpoints
(earth-dem, terrain) that the browser cannot fetch directly because of CORS.
The /api/ephemeris endpoint is proxied to JPL Horizons in a best-effort way;
if it is unreachable the app simply stays in PREVIEW mode (its default),
which still gives working 3D planets, moons, time slider and site lighting.

Usage:  python serve.py [port]     (default port 8765)
"""
import sys
import os
import json
import urllib.request
import urllib.parse
import threading

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static")
EARTH_DEM_URL = "https://upload.wikimedia.org/wikipedia/commons/e/ef/Earth_dry_elevation.png"
HORIZONS_URL = "https://ssd.jpl.nasa.gov/api/horizons.api"
TERRAIN_COARSE_URL = "https://svs.gsfc.nasa.gov/vis/a000000/a004700/a004720/ldem_4_uint.tif"
TERRAIN_FINE_URL = "https://svs.gsfc.nasa.gov/vis/a000000/a004700/a004720/ldem_4_uint.tif"
UA = "LunarLinkPlanner/0.7 (educational desktop; NASA data)"

_cache = {}
_lock = threading.Lock()

def fetch(url, timeout=35, max_bytes=8 << 20):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "*/*"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.status, r.read(max_bytes), r.headers.get("Content-Type", "application/octet-stream")

def serve_static(handler, path):
    if path == "/" or path == "":
        path = "/index.html"
    # prevent path traversal
    safe = os.path.normpath(path).lstrip("/\\")
    full = os.path.join(ROOT, safe)
    if not os.path.abspath(full).startswith(os.path.abspath(ROOT)):
        return error(handler, 403, "Forbidden")
    if not os.path.isfile(full):
        return error(handler, 404, "Not found: " + path)
    ctype = {
        ".html": "text/html; charset=utf-8",
        ".js": "text/javascript; charset=utf-8",
        ".mjs": "text/javascript; charset=utf-8",
        ".css": "text/css; charset=utf-8",
        ".json": "application/json",
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".svg": "image/svg+xml",
        ".ico": "image/x-icon",
        ".tif": "image/tiff",
        ".tiff": "image/tiff",
        ".txt": "text/plain; charset=utf-8",
    }.get(os.path.splitext(full)[1].lower(), "application/octet-stream")
    with open(full, "rb") as f:
        data = f.read()
    handler.send_response(200)
    handler.send_header("Content-Type", ctype)
    handler.send_header("Content-Length", str(len(data)))
    handler.send_header("Cache-Control", "no-cache")
    handler.send_header("Access-Control-Allow-Origin", "*")
    handler.end_headers()
    handler.wfile.write(data)

def error(handler, code, msg):
    body = msg.encode("utf-8")
    handler.send_response(code)
    handler.send_header("Content-Type", "text/plain; charset=utf-8")
    handler.send_header("Content-Length", str(len(body)))
    handler.end_headers()
    handler.wfile.write(body)

def proxy_bytes(handler, cache_key, url, want_png):
    with _lock:
        data = _cache.get(cache_key)
    if data is None:
        try:
            status, data, _ = fetch(url)
        except Exception as e:
            message = "Upstream unavailable for %s: %s" % (url, e)
            if "429" in str(e):
                message = "Earth elevation source is temporarily rate-limited. Please retry in a few minutes."
            return error(handler, 502, message)
        if status != 200 or not data:
            return error(handler, 502, "Upstream returned %s" % status)
        if want_png and data[:8] != b"\x89PNG\r\n\x1a\n":
            return error(handler, 502, "Expected PNG raster")
        with _lock:
            _cache[cache_key] = data
    handler.send_response(200)
    handler.send_header("Content-Type", "image/png" if want_png else "application/octet-stream")
    handler.send_header("Content-Length", str(len(data)))
    handler.send_header("Cache-Control", "public,max-age=86400")
    handler.send_header("Access-Control-Allow-Origin", "*")
    handler.end_headers()
    handler.wfile.write(data)

def handle_api(handler, path, query):
    if path == "/api/earth-dem":
        return proxy_bytes(handler, "earth_dem", EARTH_DEM_URL, True)
    if path == "/api/terrain":
        res = query.get("resolution", ["coarse"])[0]
        url = TERRAIN_FINE_URL if res == "fine" else TERRAIN_COARSE_URL
        return proxy_bytes(handler, "terrain_" + res, url, False)
    if path == "/api/ephemeris":
        # Best-effort: the app falls back to PREVIEW mode if this fails.
        q = urllib.parse.urlencode({
            "format": "json", "COMMAND": "301", "EPHEM_TYPE": "VECTORS",
            "CENTER": "500@399", "START_TIME": query.get("start", ["2026-01-01"])[0],
            "STOP_TIME": "+\u0020" + str(min(int(query.get("days", ["9"])[0]) + 1, 366)) + "d",
            "STEP_SIZE": str(query.get("step_hours", ["3"])[0]) + "h",
        })
        return error(handler, 501, "Ephemeris proxy not implemented; app uses PREVIEW mode")
    return error(handler, 404, "Unknown API endpoint: " + path)

def main():
    from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, fmt, *args):
            pass  # keep console clean

        def do_GET(self):
            parsed = urllib.parse.urlparse(self.path)
            path = urllib.parse.unquote(parsed.path)
            query = urllib.parse.parse_qs(parsed.query)
            if path.startswith("/api/"):
                try:
                    return handle_api(self, path, query)
                except Exception as e:
                    return error(self, 500, "API error: %s" % e)
            return serve_static(self, path)

    print("=" * 52)
    print("  Lunar Link Planner - lokaler Server (Python)")
    print("=" * 52)
    print("  http://127.0.0.1:%d/index.html" % PORT)
    print("  Fenster NICHT schliessen. Beenden: Strg+C.")
    print("=" * 52)
    httpd = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nServer beendet.")

if __name__ == "__main__":
    main()
