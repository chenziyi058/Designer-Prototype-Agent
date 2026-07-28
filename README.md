# Designer Prototype Agent

面向工业设计师的“智能产品原型工程师”。它把纯文字产品概念先整理为带来源和验证状态的 `ProjectSpec`，再生成系统架构、BOM、接线、USB 串口协议、ESP32 固件、Python 工具、测试与完整工程包。

这不是通用聊天机器人。所有派生资产依赖版本化 `ProjectSpec`，工程精确性由确定性程序检查；无法核对的器件参数和价格保持“待确认”。

## 已实现的垂直闭环

1. 五步文字项目表单与工业软件风格工作台。
2. Pydantic `ProjectSpec`、JSON Schema、来源/置信度/验证状态。
3. 部署端使用 Cloudflare D1；本地工程执行器使用 SQLite + SQLAlchemy，均持久化项目、版本、消息、运行、文件与验证记录。
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

# 完整网页（同源 API + 本地 D1）
pnpm dev

# 可选：需要本机 Python/PlatformIO 执行能力时，另开终端
cd apps/api
uvicorn app.main:app --reload --port 8000
```

打开前端打印的本地地址。网页使用同源 `/api`，无需依赖 `localhost:8000`；FastAPI 文档位于 `http://localhost:8000/docs`，它保留给本机编译与工程执行流程。默认 `MODEL_PROVIDER=mock`，无需 API Key。

## DeepSeek 配置

复制并编辑根目录配置：

```bash
cp .env.example .env
```

```env
MODEL_PROVIDER=deepseek
DEEPSEEK_API_KEY=你的密钥
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_DEFAULT_MODEL=deepseek-v4-flash
DEEPSEEK_REASONING_MODEL=deepseek-v4-pro
DEEPSEEK_CODING_MODEL=deepseek-v4-pro
```

根目录与 `apps/api/.env` 都会被加载，后者优先。推理和编码模型为空时自动回退到默认模型；Base URL、超时、重试、推理强度和温度均可配置。

启动 API 后执行真实连接测试：

```bash
curl -X POST http://localhost:8000/api/agent/test
```

返回 `DEEPSEEK_CONNECTION_OK`、实际模型名和 Token 用量即表示接入成功。启用 DeepSeek 后：

- `POST /api/projects` 调用 Requirement Interpreter 生成 ProjectSpec 初稿。
- `POST /api/projects/{id}/messages` 携带当前 ProjectSpec 调用项目 Agent。
- `POST /api/projects/{id}/generate/{module}` 调用对应专业生成 Skill，并把结果写入项目工作区。
- `GET /api/projects/{id}/agent-runs` 返回模型、Skill、Token、生成文件和失败信息。

模型调用失败会记录为确定性回退，不会伪装成 DeepSeek 成功；项目创建、问答和工程模板仍可继续。模型生成内容还会经过工程诚信检查，未经核对的电气数值、引脚、价格、具体候选型号或兼容性断言不会写入工程资产。API Key 只能放在未提交的 `.env` 或部署平台的加密运行时变量中。

## 工作台使用

1. 用“新建项目”的五步表单创建项目；DeepSeek 会先解析需求，再保存 ProjectSpec v1。
2. 在右侧 Agent 面板输入需求修改。明确的预算、主控和软件需求修改会创建新版本，并把旧工程资产标记为需要重新确认；普通问答不会改写 ProjectSpec。
3. 左侧模块页面可调用 DeepSeek 生成专业分析，并在项目工作区保留确定性模板代码与模型生成记录。
4. 文件列表支持 Markdown、JSON、YAML、CSV、Python、C++、TypeScript 等文本预览、复制和单文件下载；项目概览可导出完整 ZIP。
5. 硬件、协议和代码页面可运行相应确定性检查。托管网页执行静态代码检查，并明确把 Python、PlatformIO 和实物测试标为 `NOT_RUN`；本机 FastAPI 工程执行器才会实际运行 Python 与 PlatformIO。
6. “需求”页面可查看或恢复 ProjectSpec 历史版本；“验证记录”页面显示验证结果、模型、Token、文件和失败信息。

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

完整功能验收矩阵见 [`docs/acceptance-matrix.md`](docs/acceptance-matrix.md)。

## Docker

```bash
cp .env.example .env
docker compose up --build
```

Web 使用 3000 端口，API 使用 8000 端口。SQLite 与项目工作区通过本地目录持久化。

## 安全边界

Agent 内容只用于低压、有人值守的原型辅助。首次上电前人工检查接线；电机与大电流负载必须使用合适驱动器；确认电压、最大电流和启动电流；运动机构保留急停。市电、高压、高温、大功率、医疗和人体安全相关项目必须由专业人员复核。
