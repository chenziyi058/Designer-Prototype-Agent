from __future__ import annotations
import json
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ALLOWED_COMMANDS = {"ping", "get_status", "set_output"}
FRONTEND = Path(__file__).resolve().parents[1] / "frontend"

class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(FRONTEND), **kwargs)

    def do_POST(self) -> None:
        if self.path != "/api/command":
            self.send_error(404); return
        try:
            size = int(self.headers.get("Content-Length", "0"))
            if size > 512: raise ValueError("message exceeds 512 bytes")
            message = json.loads(self.rfile.read(size))
            if message.get("type") != "command" or not message.get("request_id"):
                raise ValueError("type and request_id are required")
            if message.get("name") not in ALLOWED_COMMANDS:
                raise ValueError("unknown command")
            result = {"type": "response", "request_id": message["request_id"], "status": "accepted",
                      "message": "仅完成本地协议校验；未连接或操作真实硬件"}
            self._json(200, result)
        except (ValueError, json.JSONDecodeError) as error:
            self._json(422, {"type": "error", "code": "INVALID_PAYLOAD", "message": str(error)})

    def _json(self, status: int, value: dict) -> None:
        body = json.dumps(value, ensure_ascii=False).encode()
        self.send_response(status); self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body))); self.end_headers(); self.wfile.write(body)

if __name__ == "__main__":
    print("Local prototype console: http://localhost:8765")
    ThreadingHTTPServer(("127.0.0.1", 8765), Handler).serve_forever()
