"""Persistent Kokoro TTS server: model loads once, scenes synthesize without respawn.

Stdlib only. Endpoints (localhost only):
  GET  /health      -> {"ok": true, "model": ...}
  POST /synthesize  {"text": str, "voice"?: str, "speed"?: float}
                    -> {"audio_base64": ..., "timing": {...}} (same as kokoro_tts.py)

Usage:
  KOKORO_PYTHON=/tmp/kokoro-spike/bin/python
  $KOKORO_PYTHON scripts/kokoro_server.py [--port 8765]
  KOKORO_SERVER_URL=http://127.0.0.1:8765 npm run generate-video -- ...

Threaded: concurrent scene requests serialize on kokoro-mlx's internal lock,
which is still far cheaper than one model load per scene.
"""
import json
import os
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from kokoro_tts import ALLOWED_VOICES, get_tts, synthesize  # noqa: E402


class Handler(BaseHTTPRequestHandler):
    server_version = 'KokoroTTSServer/1'

    def log_message(self, *args):
        pass

    def _json(self, code, obj):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == '/health':
            self._json(200, {'ok': True, 'model': 'kokoro-82M-mlx', 'voices': list(ALLOWED_VOICES)})
        else:
            self._json(404, {'error': 'unknown endpoint'})

    def do_POST(self):
        if self.path != '/synthesize':
            self._json(404, {'error': 'unknown endpoint'})
            return
        try:
            length = int(self.headers.get('Content-Length') or 0)
            if length > 200000:
                raise RuntimeError('Request too large')
            request = json.loads(self.rfile.read(length) or b'{}')
            result = synthesize(request['text'], request.get('voice') or 'af_heart',
                                float(request.get('speed') or 1.0), tts=self.server.tts)
            self._json(200, result)
        except Exception as error:
            self._json(500, {'error': 'Kokoro TTS failed: %s' % error})


def main():
    port = 8765
    for i, arg in enumerate(sys.argv):
        if arg == '--port' and i + 1 < len(sys.argv):
            port = int(sys.argv[i + 1])
    print('Loading Kokoro model (once)...', flush=True)
    tts = get_tts()
    print('Voices: %s' % (', '.join(sorted(tts.list_voices()))[:200]), flush=True)
    server = ThreadingHTTPServer(('127.0.0.1', port), Handler)
    server.tts = tts
    print('Kokoro server on http://127.0.0.1:%d' % port, flush=True)
    server.serve_forever()


if __name__ == '__main__':
    main()
