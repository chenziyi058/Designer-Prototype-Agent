"""Baseline placeholder-free training entrypoint.
Provide labeled JSONL before running; exits clearly when data is absent.
"""
from pathlib import Path
import json

def load(path: Path) -> list[dict]:
    if not path.exists(): raise FileNotFoundError("需要先采集并标注数据")
    return [json.loads(line) for line in path.read_text().splitlines() if line.strip()]
if __name__=="__main__": print(f"loaded {len(load(Path('labeled-data.jsonl')))} labeled samples")
