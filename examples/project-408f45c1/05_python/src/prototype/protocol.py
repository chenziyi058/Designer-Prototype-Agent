from __future__ import annotations
import json
from dataclasses import dataclass

PROTOCOL_VERSION = "1.0.0"
BAUD_RATE = 115200
MAX_MESSAGE_BYTES = 512
COMMANDS = ["ping", "get_status", "set_output"]
ERROR_CODES = ["INVALID_JSON", "UNKNOWN_COMMAND", "INVALID_PAYLOAD", "INTERNAL_ERROR"]

@dataclass(frozen=True)
class Message:
    type: str
    request_id: str
    name: str | None = None
    payload: dict | None = None
    def encode(self) -> bytes:
        data = (json.dumps(self.__dict__, ensure_ascii=False, separators=(",", ":")) + "\n").encode()
        if len(data) > MAX_MESSAGE_BYTES: raise ValueError("message exceeds protocol limit")
        return data
