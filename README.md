# Designer Prototype Agent

面向工业设计师的“智能产品原型工程师”。它把纯文字产品概念先整理为带来源和验证状态的 `ProjectSpec`，再生成系统架构、BOM、接线、USB 串口协议、ESP32 固件、Python 工具、测试与完整工程包。

这不是通用聊天机器人。所有派生资产依赖版本化 `ProjectSpec`，工程精确性由确定性程序检查；无法核对的器件参数和价格保持“待确认”。

## 已实现的垂直闭环

1. 五步文字项目表单与工业软件风格工作台。
2. Pydantic `ProjectSpec`、JSON Schema、来源/置信度/验证状态。
3. SQLite + SQLAlchemy 项目、版本、消息、运行、文件、器件、BOM、验证、测试与决策记录。
4. 可配置的 DeepSeek OpenAI-compatible Provider 与无密钥 Mock Provider。
5. 系统架构、BOM、协议、PlatformIO、Python、测试和文档工程包生成。
6. GPIO、I²C、电平、电机驱动与电源预算确定性检查。
7. 修改影响分析、ProjectSpec 版本创建/恢复与工程包 ZIP 导出。
8. 智能专注指环标准案例与自动化测试。

## 仓库结构

```text
app/                    Next.js/Vinext 工作台
apps/api/               FastAPI、SQLAlchemy、Agent 核心与测试
packages/schemas/       共享 JSON Schema
catalogs/components/    少量明确标记为示例的器件目录
examples/               可重新生成的智能专注指环案例
projects/               用户项目工作区（运行时生成）
templates/              扩展模板位置
docs/                   架构与安全说明
```

## 本地启动

要求 Node 22+、pnpm、Python 3.11+。

```bash
cp .env.example .env
pnpm install
python3 -m venv .venv
source .venv/bin/activate
pip install -r apps/api/requirements.txt
pip install platformio  # 需要编译 ESP32 固件时

# 终端 1
pnpm dev

# 终端 2
cd apps/api
uvicorn app.main:app --reload --port 8000
```

打开前端打印的本地地址；API 文档位于 `http://localhost:8000/docs`。默认 `MODEL_PROVIDER=mock`，无需 API Key。

## DeepSeek 配置

将 `.env` 中 `MODEL_PROVIDER` 改为 `deepseek`，填写 `DEEPSEEK_API_KEY` 与至少一个 `DEEPSEEK_DEFAULT_MODEL`。推理和编码模型为空时自动回退到默认模型。Base URL、超时、重试和温度均可配置，模型名不在业务代码中硬编码。

## 测试与构建

```bash
pnpm lint
pnpm test
pnpm build

cd apps/api
pytest
python scripts/generate_example.py

# 生成项目的固件目录内（安装 PlatformIO 后）
pio run
```

标准案例已在 `esp32-s3-devkitc-1` 环境真实编译通过。新生成项目在未运行 PlatformIO 时仍保持 `NOT_RUN`，不会继承或伪造“编译通过”。

## Docker

```bash
cp .env.example .env
docker compose up --build
```

Web 使用 3000 端口，API 使用 8000 端口。SQLite 与项目工作区通过本地目录持久化。

## 安全边界

Agent 内容只用于低压、有人值守的原型辅助。首次上电前人工检查接线；电机与大电流负载必须使用合适驱动器；确认电压、最大电流和启动电流；运动机构保留急停。市电、高压、高温、大功率、医疗和人体安全相关项目必须由专业人员复核。
