from __future__ import annotations
import json
from dataclasses import dataclass

MAX_MESSAGE_BYTES = 512
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
