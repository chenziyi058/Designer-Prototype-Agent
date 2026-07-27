import json
import sys
from pathlib import Path

API_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(API_ROOT))

from app.generator import generate_workspace, smart_ring_spec
from app.schemas import ProjectSpec

DESCRIPTION = """我想开发一个用于帮助用户进入专注状态的智能指环。用户可以旋转指环，
设备记录旋转速度、方向变化、停顿时间和使用时长。系统使用 ESP32 和编码器采集数据，
通过 USB 串口发送给电脑。Python 程序保存数据，并使用简单的机器学习模型识别用户是否
进入稳定专注状态。设备可以根据识别结果调整电机阻尼。第一版不设计 PCB，预算控制在
1500 元以内，我的编程经验较少。"""

if __name__ == "__main__":
    files = generate_workspace(smart_ring_spec(), REPO_ROOT / "examples", DESCRIPTION)
    schema_path = REPO_ROOT / "packages/schemas/project-spec.schema.json"
    schema_path.write_text(
        json.dumps(ProjectSpec.model_json_schema(), ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(f"generated {len(files)} files")
