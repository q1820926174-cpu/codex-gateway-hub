# Codex Gateway Hub / Codex 模型网关

本项目最主要功能是将老的第三方openai兼容接口 接入新版codex在中使用 实现通过接口动态切换模型，并对非视觉大模型用视觉模型进行图片转文本，让非视觉大模型支持视觉任务。
The main purpose of this project is to connect legacy third-party OpenAI-compatible APIs to the new Codex workflow, support runtime model switching via API, and use vision models for image-to-text fallback so non-vision models can handle visual tasks.

## GitHub Search SEO / GitHub 搜索优化关键词

`openai-compatible-gateway`, `responses-api`, `chat-completions`, `codex`, `multi-provider`, `api-gateway`, `model-routing`, `vision-fallback`, `token-usage`, `one-api-style`, `nextjs`, `prisma`, `ai-proxy`, `llm-gateway`, `openai-compat`

建议仓库 About 描述（可直接复制） / Suggested GitHub About text:
- `OpenAI-compatible Codex/Responses gateway with multi-provider routing, model mapping, vision fallback, runtime switching, and token analytics.`
- `OpenAI 兼容的 Codex/Responses 网关，支持多上游路由、模型映射、视觉兜底、运行时切换与 Token 统计。`

建议在 GitHub 仓库 Topics 中添加（便于检索） / Suggested GitHub Topics:
- `openai-compatible`
- `responses-api`
- `chat-completions`
- `llm-gateway`
- `multi-provider`
- `nextjs`
- `prisma`
- `codex`

## Core Features / 核心能力

- OpenAI + Anthropic 兼容网关：`/v1/chat/completions`、`/v1/completions`、`/v1/responses`、`/v1/messages`；上游支持 `responses`、`chat_completions`、`anthropic_messages` / OpenAI + Anthropic-compatible gateway endpoints with three upstream wire APIs.
- 三线兼容上游协议：`responses` + `chat_completions` + `anthropic_messages` / Triple upstream protocol compatibility.
- 多 Key + 多渠道 + 每 Key 独立模型映射 / Multi keys + multi channels + per-key model mapping.
- GLM 渠道支持按 Codex `reasoning_effort` 阈值映射深度思考，阈值可在前端模型配置中调整 / GLM channels can map Codex `reasoning_effort` into deep-thinking mode with a configurable frontend threshold.
- 跨渠道视觉兜底（主模型不支持视觉时先图片转文本） / Cross-channel vision fallback when primary model lacks image support.
- 运行时 API 切模、清空覆盖、启停 Key / Runtime model switching, override clearing, and key enable or disable.
- 控制台入口暗号保护 + Cookie 鉴权 / Entry-secret protected console access with cookie-based auth.
- 网关与入口接口内置轻量内存限流 / Built-in lightweight in-memory rate limiting for gateway and entry APIs.
- 请求日志、AI 调用日志、分钟级 Token 报表 / Request logs, AI call logs, and minute-level token reports.
- 控制台中英文切换（右上角） / Bilingual console language switch (top-right corner).

## Demo / 演示图

![Web Console Demo / 网站控制台演示](docs/images/demo-console.png)

## Quick Start / 快速启动

1. 安装依赖 / Install dependencies

```bash
npm install
```

2. 初始化环境与数据库 / Initialize env and database

```bash
cp .env.example .env
npm run prisma:migrate
```

3. 启动开发环境 / Start development server

```bash
npm run dev
```

默认地址 / Default URL: `http://127.0.0.1:3000`

## Docker Deploy / Docker 部署

1. 准备环境变量（建议先设置入口暗号） / Prepare env vars (set entry secret first)

```bash
cp .env.example .env
```

2. 按需修改数据库连接（默认 SQLite，可改外部 MySQL/PostgreSQL） / Configure database connection (SQLite by default, or external MySQL/PostgreSQL)

- SQLite（默认） / SQLite (default):
  - `DATABASE_PROVIDER=sqlite`
  - `DATABASE_URL=file:../data/dev.db`
- 外部 MySQL / External MySQL:
  - `DATABASE_PROVIDER=mysql`
  - `DATABASE_URL=mysql://<user>:<password>@<host>:3306/<database>`
- 外部 PostgreSQL / External PostgreSQL:
  - `DATABASE_PROVIDER=postgresql`
  - `DATABASE_URL=postgresql://<user>:<password>@<host>:5432/<database>?schema=public`

3. 启动网关容器 / Start gateway container

```bash
docker compose up -d --build
```

4. 查看网关日志 / View gateway logs

```bash
docker compose logs -f gateway
```

5. 停止并移除容器 / Stop and remove containers

```bash
docker compose down
```

说明 / Notes:
- 网关容器启动时会自动执行 Prisma 初始化（`npm run db:init`） / The gateway auto-runs Prisma initialization on startup.
- SQLite 数据持久化到 `gateway_data`（容器内 `/app/data/dev.db`） / SQLite data is persisted to `gateway_data`.
- Compose 不再内置 MySQL/PostgreSQL 容器，若使用 MySQL/PostgreSQL 请提供外部数据库并通过环境变量传入连接串 / Compose no longer bundles MySQL/PostgreSQL containers. Use external DB and pass connection settings via environment variables.

### China Acceleration Mode / 国内加速模式

默认关闭，可在 `.env` 打开（构建时自动切换 npm 源为国内镜像） / Disabled by default. Enable in `.env` to switch npm registry to a CN mirror during build:

```env
DOCKER_ACCELERATE_CN="1"
NPM_REGISTRY_CN="https://registry.npmmirror.com/"
```

可选代理（如果你本地有代理） / Optional proxy:

```env
HTTP_PROXY="http://127.0.0.1:7890"
HTTPS_PROXY="http://127.0.0.1:7890"
NO_PROXY="localhost,127.0.0.1"
```

重建镜像使配置生效 / Rebuild to apply:

```bash
docker compose build --no-cache gateway
docker compose up -d
```

说明 / Note:
- 该模式主要加速依赖安装；Docker 基础镜像下载速度取决于你宿主机 Docker daemon 的镜像加速器配置 / This mainly accelerates dependency installation; base image pull speed depends on Docker daemon mirror settings on the host.

## Environment / 环境变量

```env
DATABASE_PROVIDER="sqlite"
DATABASE_URL="file:./dev.db"
CONSOLE_ENTRY_SECRET=""
CONSOLE_ENTRY_COOKIE_SECURE="auto"
ANTHROPIC_VERSION="2023-06-01"
OPENAI_FILE_STORAGE_DIR="./data/openai-files"
OPENAI_FILE_UPLOAD_MAX_BYTES="20971520"
OPENAI_FILE_DATA_URL_MAX_BYTES="20971520"
GATEWAY_KEY_CACHE_TTL_MS="1500"
GATEWAY_KEY_CACHE_MAX="2048"
GATEWAY_STREAM_TIMEOUT_MS="600000"
VISION_CAPTION_CACHE_TTL_MS="86400000"
VISION_CAPTION_CACHE_MAX="2048"
DOCKER_ACCELERATE_CN="0"
NPM_REGISTRY="https://registry.npmjs.org/"
NPM_REGISTRY_CN="https://registry.npmmirror.com/"
HTTP_PROXY=""
HTTPS_PROXY=""
NO_PROXY="localhost,127.0.0.1"
```

- `DATABASE_PROVIDER` 支持：`sqlite`、`mysql`、`postgresql` / Supported values: `sqlite`, `mysql`, `postgresql`.
- MySQL 连接串示例 / MySQL URL example:  
  `DATABASE_URL="mysql://codex:codex@127.0.0.1:3306/codex_gateway"`
- PostgreSQL 连接串示例 / PostgreSQL URL example:  
  `DATABASE_URL="postgresql://codex:codex@127.0.0.1:5432/codex_gateway?schema=public"`
- `CONSOLE_ENTRY_SECRET` 留空表示关闭入口暗号 / Empty `CONSOLE_ENTRY_SECRET` disables entry-secret protection.
- `CONSOLE_ENTRY_COOKIE_SECURE` 支持 `auto`（默认）、`true`、`false`。`auto` 会按请求协议自动判断是否加 `Secure`（推荐） / `CONSOLE_ENTRY_COOKIE_SECURE` accepts `auto` (default), `true`, `false`. `auto` decides `Secure` by request protocol (recommended).
- `ANTHROPIC_VERSION` 用于 Anthropic 上游默认请求头，未显式传入时回落到该值 / `ANTHROPIC_VERSION` sets the default Anthropic upstream header when the client does not send one.
- `OPENAI_FILE_STORAGE_DIR` 为 `/v1/files` 的本地存储目录，Docker 默认可设为 `/app/data/openai-files` 以持久化 / `OPENAI_FILE_STORAGE_DIR` is local storage for `/v1/files`; for Docker, set `/app/data/openai-files` for persistence.
- `OPENAI_FILE_UPLOAD_MAX_BYTES` 限制上传大小（默认 20MB） / `OPENAI_FILE_UPLOAD_MAX_BYTES` limits upload size (default 20MB).
- `OPENAI_FILE_DATA_URL_MAX_BYTES` 限制 `file_id` 内联为 data URL 的大小（默认 20MB） / `OPENAI_FILE_DATA_URL_MAX_BYTES` limits `file_id` inlining to data URL (default 20MB).
- `GATEWAY_KEY_CACHE_TTL_MS` 与 `GATEWAY_KEY_CACHE_MAX` 用于高并发下本地 Key 缓存 / These two variables control local-key cache for high concurrency.
- `GATEWAY_KEY_CACHE_TTL_MS=0` 可关闭缓存 / Set `GATEWAY_KEY_CACHE_TTL_MS=0` to disable cache.
- `GATEWAY_STREAM_TIMEOUT_MS` 控制流式上游请求超时（默认 `600000` 毫秒）；`0` 表示不设置流式超时 / `GATEWAY_STREAM_TIMEOUT_MS` controls stream upstream timeout (default `600000` ms); set `0` to disable stream timeout.
- `VISION_CAPTION_CACHE_TTL_MS` 控制“非视觉模型图片兜底解析”结果缓存 TTL（默认 `86400000` 毫秒，即 24 小时）；`0` 表示关闭缓存 / `VISION_CAPTION_CACHE_TTL_MS` controls TTL for vision-fallback caption cache (default `86400000` ms, 24h); set `0` to disable.
- `VISION_CAPTION_CACHE_MAX` 控制“非视觉模型图片兜底解析”缓存条目上限（默认 `2048`）；`0` 表示关闭缓存 / `VISION_CAPTION_CACHE_MAX` sets max entries for vision-fallback caption cache (default `2048`); set `0` to disable.
- `DOCKER_ACCELERATE_CN=1` 时，Docker 构建阶段 npm 将使用 `NPM_REGISTRY_CN` / When `DOCKER_ACCELERATE_CN=1`, Docker build uses `NPM_REGISTRY_CN` for npm install.
- `NPM_REGISTRY` 为默认 npm 源，`NPM_REGISTRY_CN` 为加速模式 npm 源 / `NPM_REGISTRY` is default npm registry; `NPM_REGISTRY_CN` is used in acceleration mode.
- `HTTP_PROXY`、`HTTPS_PROXY`、`NO_PROXY` 会透传到构建与运行容器 / `HTTP_PROXY`, `HTTPS_PROXY`, `NO_PROXY` are passed to both build and runtime containers.
- 配置入口暗号后，访问 `/` 或 `/console/*` 会先跳转 `/secret-entry` / With entry-secret enabled, `/` and `/console/*` redirect to `/secret-entry`.

## SQLite To MySQL/PostgreSQL Migration / SQLite 迁移到 MySQL/PostgreSQL

从本地 SQLite 迁移数据到外部 MySQL/PostgreSQL（迁移 `UpstreamChannel`、`ProviderKey`、`TokenUsageEvent` 三张表） / Migrate local SQLite data to external MySQL/PostgreSQL (`UpstreamChannel`, `ProviderKey`, `TokenUsageEvent`).

```bash
npm run db:migrate:from-sqlite -- \
  --target-provider=postgresql \
  --target-url='postgresql://user:pass@127.0.0.1:5432/codex_gateway?schema=public'
```

```bash
npm run db:migrate:from-sqlite -- \
  --target-provider=mysql \
  --target-url='mysql://user:pass@127.0.0.1:3306/codex_gateway'
```

可选参数 / Optional flags:
- `--source-url=file:./dev.db`：指定源 SQLite 文件（默认 `file:./dev.db`） / specify source SQLite URL (default `file:./dev.db`).
- `--overwrite-target`：清空目标数据库已有数据后再导入 / clear target data before import.
- `--keep-export-file`：保留临时导出 JSON 文件 / keep temporary exported JSON file.
- `--export-file=<path>`：指定导出文件路径 / set export file path.

说明 / Notes:
- 脚本会自动创建/补齐目标表结构，但不会写入默认演示数据 / Script initializes target schema without seeding demo data.
- 若目标库已有数据且未加 `--overwrite-target`，脚本会中止 / Script aborts when target DB is non-empty unless `--overwrite-target` is provided.
- 若 SQLite 中存在引用失效的 `TokenUsageEvent`（`keyId` 不存在于 `ProviderKey`），迁移时会自动跳过并打印告警 / Orphan `TokenUsageEvent` rows (missing `ProviderKey`) are skipped with a warning during migration.

## Console Routes / 控制台路由

- `/secret-entry` - 入口暗号页 / Entry-secret unlock page
- `/console/access` - 本地 Key 接入 / Local key access
- `/console/upstream` - 上游渠道管理 / Upstream channel management
- `/console/runtime` - 运行时调度 / Runtime scheduling
- `/console/logs` - 请求日志 / Request logs
- `/console/calls` - AI 调用日志 / AI call logs
- `/console/usage` - 用量报表 / Usage report

## Main APIs / 主要接口

- Gateway compatibility routes / 网关兼容路由
  - `POST /v1/chat/completions`（别名：`/api/v1/chat/completions`）
  - `POST /v1/completions`（别名：`/api/v1/completions`）
  - `POST /v1/responses`（别名：`/api/v1/responses`）
  - `POST /v1/messages`（别名：`/api/v1/messages`）
  - `POST /v1/files`（别名：`/api/v1/files`，`multipart/form-data` 上传文件）
  - `GET /v1/files`（别名：`/api/v1/files`，按当前本地 key 列表）
  - `GET /v1/files/:id`（别名：`/api/v1/files/:id`）
  - `DELETE /v1/files/:id`（别名：`/api/v1/files/:id`）
  - `GET /v1/files/:id/content`（别名：`/api/v1/files/:id/content`）
- Console/admin routes / 控制台与管理路由
- `GET /api/health`
- `GET /api/config`
- `GET /api/keys`
- `POST /api/keys`
- `GET /api/keys/:id`
- `PUT /api/keys/:id`
- `DELETE /api/keys/:id`
- `GET /api/keys/:id/codex-export`（导出原生 Codex CLI 配置包 / export native Codex CLI bundle）
- `GET /api/upstreams`
- `POST /api/upstreams`
- `GET /api/upstreams/:id`
- `PUT /api/upstreams/:id`
- `DELETE /api/upstreams/:id`
- `POST /api/upstreams/test`（上游模型连通测试 / upstream connectivity test）
- `POST /api/keys/test-upstream`（按 Key 测试上游 / upstream test by key）
- `GET /api/keys/switch-model`（查询运行时状态 / query runtime status）
- `POST /api/keys/switch-model`（运行时切模或启停 / switch model or enable/disable key）
- `GET /api/usage`
- `DELETE /api/usage`
- `GET /api/logs`
- `DELETE /api/logs`
- `GET /api/call-logs`
- `DELETE /api/call-logs`
- `POST /api/secret-entry`（提交入口暗号并写入 Cookie / submit entry secret and set cookie）
- `DELETE /api/secret-entry`（清除入口 Cookie / clear entry cookie）

## Auth & Rate Limit / 鉴权与限流

- 所有网关兼容路由都使用本地 Key 鉴权，支持 `Authorization: Bearer <local_key>` 或 `x-api-key: <local_key>` / All gateway-compatible routes authenticate with the local key via either `Authorization: Bearer <local_key>` or `x-api-key: <local_key>`.
- `POST /v1/messages` 与 `/api/v1/messages` 额外透传 `anthropic-version`、`anthropic-beta` 到 Anthropic 上游；如果客户端未传 `anthropic-version`，则默认使用 `ANTHROPIC_VERSION` 或 `2023-06-01` / `POST /v1/messages` and `/api/v1/messages` also forward `anthropic-version` and `anthropic-beta`; when omitted, `anthropic-version` defaults to `ANTHROPIC_VERSION` or `2023-06-01`.
- `/v1/*` 与 `/api/v1/*` 默认启用轻量内存限流：单 IP 每分钟 120 次；`/api/secret-entry` 为单 IP 每分钟 20 次；超限返回 `429` 与 `retryAfterSeconds` / `/v1/*` and `/api/v1/*` use lightweight in-memory rate limiting by default (120 req/min per IP); `/api/secret-entry` is 20 req/min per IP, returning `429` with `retryAfterSeconds` when exceeded.
- `/api/secret-entry` 额外启用防爆破策略：单 IP 5 分钟内连续输错 6 次会锁定 15 分钟 / `/api/secret-entry` also enables brute-force protection: 6 consecutive failures within 5 minutes trigger a 15-minute lock per IP.

## Runtime Switch API / 运行时切换接口

### 1) Query status / 查询状态

```bash
curl -sS "http://127.0.0.1:3000/api/keys/switch-model" \
  -H "Authorization: Bearer <your_local_key>"
```

### 2) Set runtime override / 设置运行时覆盖模型

```bash
curl -sS -X POST "http://127.0.0.1:3000/api/keys/switch-model" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <your_local_key>" \
  -d '{
    "model": "gpt-4.1-mini",
    "syncDefaultModel": false
  }'
```

### 3) Clear override / 清空覆盖

```bash
curl -sS -X POST "http://127.0.0.1:3000/api/keys/switch-model" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <your_local_key>" \
  -d '{
    "clear": true
  }'
```

### 4) Enable or disable key / 启用或停用 Key

```bash
curl -sS -X POST "http://127.0.0.1:3000/api/keys/switch-model" \
  -H "Content-Type: application/json" \
  -d '{
    "id": 1,
    "enabled": false
  }'
```

### Request payload (POST) / 请求体（POST）

```json
{
  "id": 1,
  "localKey": "sk-...",
  "keyName": "prod-coding-gateway",
  "model": "gpt-4.1-mini",
  "clear": false,
  "syncDefaultModel": false,
  "enabled": true
}
```

选择器优先级 / Selector priority:
- `id` > `localKey` > `keyName` > `Authorization Bearer`
- `keyName` 命中多个 key 时返回 `409` / returns `409` if `keyName` matches multiple keys.

## Gateway Compatibility / 网关兼容示例

### Chat Completions

```bash
curl http://127.0.0.1:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <your_local_key>" \
  -d '{
    "model": "gpt-4.1-mini",
    "messages": [
      {"role":"system","content":"You are concise."},
      {"role":"user","content":"Say hello in one line."}
    ]
  }'
```

### Responses

```bash
curl http://127.0.0.1:3000/v1/responses \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <your_local_key>" \
  -d '{
    "model": "gpt-4.1-mini",
    "input": [
      {
        "role": "user",
        "content": [{"type":"input_text","text":"hello"}]
      }
    ]
  }'
```

### Files Upload + `file_id` Vision

```bash
# 1) upload image file
curl -sS http://127.0.0.1:3000/v1/files \
  -H "Authorization: Bearer <your_local_key>" \
  -F "purpose=vision" \
  -F "file=@./example.png"
```

上传后返回 `id`（例如 `file-xxxxxxxx`），可在 `chat/completions` 或 `responses` 里用 `file_id` 引用，网关会自动转为可识别图片输入。

```bash
# 2) use file_id in chat/completions
curl -sS http://127.0.0.1:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <your_local_key>" \
  -d '{
    "model": "gpt-4.1-mini",
    "messages": [
      {
        "role": "user",
        "content": [
          {"type":"text","text":"Describe this image in one sentence."},
          {"type":"image_file","image_file":{"file_id":"file-xxxxxxxx"}}
        ]
      }
    ]
  }'
```

```bash
# 3) use video file_id in chat/completions
curl -sS http://127.0.0.1:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <your_local_key>" \
  -d '{
    "model": "glm-5",
    "messages": [
      {
        "role": "user",
        "content": [
          {"type":"text","text":"请一句话描述这个视频。"},
          {"type":"video_file","video_file":{"file_id":"file-xxxxxxxx"}}
        ]
      }
    ]
  }'
```

说明 / Note:
- 多图片可在同一次请求里放多个 `image_file.file_id` / Multi-image in one request is supported by passing multiple `image_file.file_id` parts.
- 视频 `file_id` 会根据 MIME 自动映射到视频输入（`video_url` / `input_video`） / Video `file_id` is auto-mapped to video input by MIME (`video_url` / `input_video`).
- 当视觉兜底通道为 `anthropic_messages` 且 provider 为 `doubao` 时，网关会自动启用兼容模式，改走 `chat/completions` 执行视频理解 / When fallback wire API is `anthropic_messages` with provider `doubao`, gateway auto-enables compatibility mode and uses `chat/completions` for video understanding.

### Anthropic Messages

```bash
curl http://127.0.0.1:3000/v1/messages \
  -H "Content-Type: application/json" \
  -H "x-api-key: <your_local_key>" \
  -H "anthropic-version: 2023-06-01" \
  -d '{
    "model": "claude-sonnet-4-5",
    "max_tokens": 512,
    "messages": [
      {"role":"user","content":"用一句话介绍你自己"}
    ]
  }'
```

## Codex Config Example / Codex 配置示例

```toml
base_url = "http://127.0.0.1:3000/v1"
wire_api = "responses"
model = "gpt-4.1-mini"
```

## Third-party Codex apply_patch / 第三方 Codex apply_patch

- 网关侧现有的 Responses 与工具调用映射已经足够；现在原生 Codex 导出还会通过 `http_headers` 给请求打上 Codex 标记，并在网关运行时把第三方提示词动态追加到当前用户消息。 / The gateway-side Responses and tool-call mapping is already sufficient; native Codex export now also tags requests via `http_headers` so the gateway can append third-party prompt rules to the active user message at runtime.
- 要让第三方模型在原生 Codex 里稳定支持 `apply_patch`，不能只配 `base_url` 与 `wire_api`；还需要同时提供 `model_catalog_json` 与 `model_instructions_file`。 / Stable third-party `apply_patch` support in native Codex needs more than `base_url` and `wire_api`; it also requires both `model_catalog_json` and `model_instructions_file`.
- 控制台 `Access` 页面新增了 `Native Codex CLI Export` 预览，可直接复制 `.env`、`config.toml` 片段、`model_catalog_json`、`instructions` 与可选 `AGENTS.md`。 / The `Access` console now includes a `Native Codex CLI Export` preview for copying the `.env`, `config.toml` snippet, `model_catalog_json`, `instructions`, and optional `AGENTS.md`.
- 已保存的 Key 也可以调用 `GET /api/keys/:id/codex-export?applyPatchToolType=function|freeform` 获取同一份导出结果。 / Saved keys can also fetch the same export bundle from `GET /api/keys/:id/codex-export?applyPatchToolType=function|freeform`.
- 推荐先使用 `function` 模式；如果你的上游代理或模型对 freeform/custom 工具更稳定，再切到 `freeform`。 / Start with `function` mode; switch to `freeform` only if your upstream proxy or model behaves better with freeform/custom tools.

推荐的原生 Codex 片段 / Recommended native Codex snippet:

```toml
model_provider = "gateway"
model = "gpt-5.3-codex"
model_reasoning_effort = "high"
disable_response_storage = true
model_catalog_json = "~/.codex/codex-gateway-hub/gateway_gpt-5.3-codex.catalog.json"
model_instructions_file = "~/.codex/codex-gateway-hub/gateway_gpt-5.3-codex.instructions.md"

[model_providers.gateway]
name = "gateway"
base_url = "http://127.0.0.1:3000/v1"
env_key = "OPENAI_API_KEY"
wire_api = "responses"
http_headers = { "x-codex-gateway-client" = "codex", "x-codex-apply-patch-tool-type" = "function" }
```

最小探针验证 / Minimal probe validation:

1. 创建 `probe_codex.txt`，内容写成 `hello`。 / Create `probe_codex.txt` with `hello`.
2. 把 `probe_codex.txt` 改成 `hello world`。 / Update `probe_codex.txt` to `hello world`.
3. 删除 `probe_codex.txt`。 / Delete `probe_codex.txt`.

如果配置正确，Codex 应该触发真实文件编辑，而不是把 patch 文本直接打印在对话里。 / When configured correctly, Codex should trigger real file edits instead of printing the patch in chat output.

对比基线与第三方模型（`gpt-5.4` vs `gpt-5.3-codex`）可直接运行：

```bash
npm run bench:codex-prompts -- --out-dir .tmp/codex-bench/latest
```

脚本会在输出目录生成 `report.json` 与 `report.md`，默认检查：
- 是否最终输出 `DONE`
- 是否真实完成创建/修改/删除（`probe_codex.txt` 最终不存在）
- 是否误把 patch 文本直接输出
- token 消耗与工具使用方式（`apply_patch` / shell）

## Notes / 说明

- `wireApi` 固定为 `responses` / `wireApi` is fixed to `responses`.
- 本地 Key 必须符合 OpenAI 风格（`sk-...` 或 `sk-proj-...`） / Local key must match OpenAI-style format (`sk-...` or `sk-proj-...`).
- 客户端认证使用本地 Key，不是上游 API Key；所有 `/v1/*` 与 `/api/v1/*` 兼容路由均支持 `Authorization: Bearer` 与 `x-api-key` / Client auth uses the local key instead of the upstream API key; all `/v1/*` and `/api/v1/*` compatibility routes accept both `Authorization: Bearer` and `x-api-key`.

## License / 许可证

MIT License. See [LICENSE](LICENSE).
