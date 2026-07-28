# 部署到 Vercel

本项目保留 Cloudflare Worker + D1 路径，同时提供 Vinext + Nitro 的 Vercel 构建目标。Vercel 版本使用 Node.js 函数、同源 `/api`、PostgreSQL 持久化和服务端 DeepSeek 调用；不会把模型密钥发送到浏览器。

## 1. 能力边界

Vercel 托管版本支持 Web 工作台、匿名浏览器项目隔离、`ProjectSpec` 版本、消息、Agent Run、Artifact、Validation、Mock/DeepSeek Provider、确定性生成与验证、文件预览和内存 ZIP 导出。

Vercel 托管版本不执行 FastAPI、Python、Pytest、PlatformIO、本地命令、固件烧录或真实硬件操作。网页会把这些能力显示为不可用或 `NOT_RUN`，不会伪装成执行成功。

## 2. 创建 PostgreSQL

推荐使用 Neon Postgres；Supabase 的 pooled connection string 也可以使用。

### Neon

1. 在 Neon 控制台创建 Project 和 Database。
2. 在 Connection Details 中选择 pooled/serverless 连接。
3. 复制 `postgresql://...` 连接串。
4. 只把连接串写入本地忽略的 `.env` 或 Vercel 加密环境变量。

### Supabase

1. 创建项目。
2. 在 Database / Connect 中选择适合 Serverless 的 Transaction pooler。
3. 将 pooler 连接串作为 `DATABASE_URL`。
4. 如果密码包含特殊字符，使用控制台提供的已编码连接串。

## 3. 初始化数据库

先把真实连接串放入本地 `.env`，然后执行：

```bash
pnpm install
pnpm db:migrate:postgres
```

常用数据库命令：

```bash
# schema 变化后生成新迁移；不要改写已执行的迁移
pnpm db:generate:postgres

# 应用未执行迁移
pnpm db:migrate:postgres

# 初始化新数据库，使用同一套可追溯迁移
pnpm db:init:postgres
```

部署后检查：

```bash
curl https://你的域名/api/health/database
```

返回 `status: "ok"`、`adapter: "postgresql"` 才表示数据库已经连接并完成初始化。

## 4. 环境变量

在 Vercel Project Settings / Environment Variables 中设置：

| 变量 | 必需 | 说明 |
| --- | --- | --- |
| `DEPLOYMENT_PLATFORM` | 是 | `vercel` |
| `DATABASE_URL` | 是 | Neon 或 Supabase pooled PostgreSQL URL |
| `MODEL_PROVIDER` | 是 | `mock` 或 `deepseek` |
| `DEEPSEEK_API_KEY` | DeepSeek 模式必需 | 只允许服务端读取 |
| `DEEPSEEK_BASE_URL` | 否 | 默认 `https://api.deepseek.com` |
| `DEEPSEEK_DEFAULT_MODEL` | DeepSeek 模式建议 | 以账号当前可用模型为准 |
| `DEEPSEEK_REASONING_MODEL` | 否 | 空值回退到默认模型 |
| `DEEPSEEK_CODING_MODEL` | 否 | 空值回退到默认模型 |
| `DEEPSEEK_REASONING_EFFORT` | 否 | 本地 FastAPI 兼容配置 |
| `MODEL_TIMEOUT_SECONDS` | 否 | 默认 `120`，运行时上限 `120` |
| `MODEL_MAX_RETRIES` | 否 | 默认 `2`，运行时上限 `2` |
| `MODEL_TEMPERATURE` | 否 | 默认 `0.2` |
| `NEXT_PUBLIC_SITE_URL` | 否 | 需要绝对站点 URL 时使用 |

不要添加 `NEXT_PUBLIC_DEEPSEEK_API_KEY` 或其他浏览器可见密钥。

## 5. 本地验证

```bash
pnpm install
pnpm lint
pnpm test
pnpm exec tsc --noEmit
pnpm build:vercel
```

成功后必须存在：

```text
.vercel/output/config.json
.vercel/output/functions/__server.func/.vc-config.json
.vercel/output/static/
```

`config.json` 应使用 Build Output API v3；函数配置应显示 Node.js runtime 和 `maxDuration: 120`。

完整验证项目持久化时，需要测试 PostgreSQL 的 `DATABASE_URL` 并先执行迁移。没有数据库时，`/api/health` 会返回降级状态，创建项目不会假装成功。

## 6. 在 Vercel 创建项目

1. 把 `deploy/vercel` 分支推送到 GitHub。
2. 在 Vercel 选择 Add New / Project。
3. 导入 `chenziyi058/Designer-Prototype-Agent`。
4. 保持 Root Directory 为仓库根目录。
5. Build Command 使用仓库 `vercel.json` 中的 `pnpm build:vercel`。
6. 不设置静态 Output Directory。Nitro 会直接生成 `.vercel/output`。
7. 添加上表环境变量。
8. 先执行 PostgreSQL 迁移，再触发部署。
9. 先用预览域名验收，确认后再绑定自定义域名。

本仓库不会自动执行生产部署。

## 7. 部署后测试清单

- [ ] 首页、CSS、JavaScript、SVG 和 `og.png` 正常加载
- [ ] `/api/health` 返回 `status: "ok"`、`platform: "vercel"`
- [ ] `/api/health/database` 返回 PostgreSQL 正常
- [ ] Mock Provider 无 Key 时能创建项目并生成确定性资产
- [ ] 配置 DeepSeek 后 `/api/agent/test` 返回真实连接结果
- [ ] 新建项目后刷新页面，项目仍然存在
- [ ] 消息、ProjectSpec 版本、Run 和 Validation 刷新后仍存在
- [ ] 架构、硬件、BOM、协议、代码和文档可以生成
- [ ] 工程文件可以预览、单独下载，ZIP 可以下载并解压
- [ ] Python、PlatformIO 和真实硬件能力明确显示不可用
- [ ] 浏览器网络请求中没有 API Key

## 8. Cloudflare 与 Vercel 差异

| 项目 | Cloudflare | Vercel |
| --- | --- | --- |
| Web 构建 | Vinext + Cloudflare Vite plugin | Vinext + Nitro |
| API 入口 | `worker/index.ts` | `nitro/server/routes/api/[...path].ts` |
| 运行时 | Cloudflare Worker | Vercel Node.js Function |
| 数据库 | D1 / SQLite dialect | Neon 或 Supabase PostgreSQL |
| Drizzle schema | `db/schema.ts` | `db/schema.postgres.ts` |
| 迁移目录 | `drizzle/` | `drizzle-postgres/` |
| 图片处理 | Cloudflare Images 可用 | 普通 `public/` 静态资源 |
| ZIP | 内存生成 | 内存生成，输入上限 4.5 MB |
| 本地执行器 | 不在 Worker 内 | 不在 Vercel Function 内 |

两条托管路径共用 `server/api.ts`、生成器、模型接口和运行时契约。

## 9. 常见错误

### `.vercel/output` 没有生成

确认使用 `pnpm build:vercel`，且 `NITRO_PRESET=vercel` 没有被覆盖。不要把 Vercel Output Directory 指向 `dist`。

### `/api/health` 返回 503

查看响应中的 `database.detail`。通常是缺少 `DATABASE_URL`、连接串错误，或尚未运行 `pnpm db:migrate:postgres`。

### DeepSeek 显示 Mock

确认 `MODEL_PROVIDER=deepseek` 与 `DEEPSEEK_API_KEY` 同时存在。显式设置为 `mock` 时，即使存在 Key 也保持 Mock。

### 请求超时

函数上限为 120 秒。应缩短单次生成任务、确认数据库区域接近函数区域，并检查模型服务响应时间。

### ZIP 返回 413

Vercel 路径为内存 ZIP 设置了 4.5 MB 输入上限。较大的二进制文件或项目包应迁移到对象存储；当前版本不会写入临时本地文件来伪装持久化。

### 多设备看不到同一项目

当前公开演示使用浏览器生成的匿名 ID 隔离项目，不是完整账号系统。清理站点 Cookie 或 Local Storage 会得到新的匿名空间。正式多用户产品必须增加认证、授权和用量限制。
