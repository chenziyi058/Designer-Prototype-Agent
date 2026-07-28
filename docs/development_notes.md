# 开发说明

## 1. 当前实现状态

项目已经形成从需求创建、候选确认、版本管理、工程生成、验证记录到 ZIP 导出的可运行垂直流程。当前代码同时包含：

- 面向在线演示的 Vinext/React + Cloudflare Worker + D1 路径。
- 面向本机工程工具链的 FastAPI + SQLite + 文件工作区路径。

两条路径不是完全相同的部署包。开发、部署和验收时需要先明确目标运行形态。

## 2. 环境与依赖

| 工具 | 建议版本 | 依赖文件 |
| --- | --- | --- |
| Node.js | 22.13+ | `package.json` |
| pnpm | 与 lockfile 兼容 | `pnpm-lock.yaml` |
| Python | 3.11+ | `apps/api/requirements.txt`、`apps/api/pyproject.toml` |
| PlatformIO | 当前稳定版 | 本地虚拟环境或独立安装 |

首次安装：

```bash
cp .env.example .env
pnpm install
python3 -m venv .venv
source .venv/bin/activate
pip install -r apps/api/requirements.txt
pip install platformio
```

`.env`、虚拟环境、数据库、项目工作区、模型权重、缓存和构建产物均被 `.gitignore` 排除。

## 3. 本地命令

### Web 与托管 API

```bash
pnpm dev
pnpm lint
pnpm test
pnpm build
```

### FastAPI 与示例

```bash
source .venv/bin/activate
cd apps/api
uvicorn app.main:app --reload --port 8000
pytest
python scripts/generate_example.py
```

### 固件

```bash
cd examples/project-408f45c1/04_firmware
pio run
```

检查命令失败时必须保留真实失败状态。不能因为存在历史成功记录就报告当前构建通过。

## 4. 配置约定

- `MODEL_PROVIDER=mock`：无密钥开发和界面演示。
- `MODEL_PROVIDER=deepseek`：真实模型调用。
- `DEEPSEEK_API_KEY`：只允许写入本地 `.env` 或部署平台的加密环境变量。
- 模型名、Base URL、超时、重试和温度必须来自配置，不能硬编码到业务逻辑。
- 根目录和 `apps/api/.env` 均可被本地 API 加载；后者优先。

不要把真实 API Key 粘贴到 Issue、README、截图、测试夹具或提交历史。

## 5. ProjectSpec 开发纪律

修改生成项目之前先读取其 `01_requirements/project-spec.json`。核心需求变更必须：

1. 创建新版本。
2. 记录变更原因。
3. 列出受影响模块。
4. 重新运行硬件或协议相关检查。
5. 更新派生资产引用的 Spec 版本。

未知的引脚、电压、电流、地址、价格、库存或兼容性必须标记为待确认，不能为了生成完整文件而虚构。

## 6. 当前已知问题与技术债务

以下内容仅记录建议，不在本次 GitHub 整理中重构：

1. TypeScript 托管 API 与 Python 本地 API 存在部分重复逻辑，需要契约测试防止行为漂移。
2. `app/page.tsx` 与 `server/api.ts` 体积较大，未来可按领域模块拆分。
3. `app/chatgpt-auth.ts` 和部分默认 SVG 资源可能未被当前产品流程使用，应在确认部署依赖后再决定是否删除。
4. `examples/d1/` 的保留目的需要补充说明或在确认无用后处理。
5. Docker Compose 的 Web/API 拓扑与当前网页同源 Worker API 路径需要进一步统一，部署前应选择明确方案。
6. 在线公开使用前必须增加登录、用户级项目隔离、CSRF/CORS 策略、限流、模型调用配额和滥用监控。
7. 器件目录目前规模有限，后续扩展必须保存数据手册来源与核验状态。

## 7. 发布前检查

```bash
git status --short
git diff --check
git ls-files
pnpm lint
pnpm test
pnpm build

cd apps/api
pytest
python scripts/generate_example.py
```

另外需要检查：

- API Key、Token、Secret、Password 和私钥内容。
- `.env`、数据库、ZIP、项目工作区和本地绝对路径。
- Git 当前树和历史中超过 GitHub 100 MB 限制的对象。
- 截图中是否出现密钥、账户、内部地址或用户数据。

## 8. 贡献范围

仓库根目录的 `AGENTS.md` 是当前工程贡献规则。代码质量问题可以记录为 Issue 或开发说明；未经过需求确认时，不应借工程化整理之名改变核心业务逻辑。
