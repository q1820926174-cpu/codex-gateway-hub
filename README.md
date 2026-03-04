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

- OpenAI 兼容网关：`/v1/chat/completions`、`/v1/completions`、`/v1/responses` / OpenAI-compatible gateway endpoints.
- 双线兼容上游协议：`responses` + `chat_completions` / Dual upstream protocol compatibility.
- 多 Key + 多渠道 + 每 Key 独立模型映射 / Multi keys + multi channels + per-key model mapping.
- 跨渠道视觉兜底（主模型不支持视觉时先图片转文本） / Cross-channel vision fallback when primary model lacks image support.
- 运行时 API 切模、清空覆盖、启停 Key / Runtime model switching, override clearing, and key enable or disable.
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

2. 启动 SQLite（默认） / Start with SQLite (default)

```bash
docker compose up -d --build
```

3. 启动 MySQL / Start with MySQL

```bash
docker compose -f docker-compose.mysql.yml up -d --build
```

4. 启动 PostgreSQL / Start with PostgreSQL

```bash
docker compose -f docker-compose.postgres.yml up -d --build
```

5. 查看网关日志 / View gateway logs

```bash
docker compose logs -f gateway
docker compose -f docker-compose.mysql.yml logs -f gateway
docker compose -f docker-compose.postgres.yml logs -f gateway
```

6. 停止并移除容器 / Stop and remove containers

```bash
docker compose down
docker compose -f docker-compose.mysql.yml down
docker compose -f docker-compose.postgres.yml down
```

说明 / Notes:
- 网关容器启动时会自动执行 Prisma 初始化（`npm run db:init`） / The gateway auto-runs Prisma initialization on startup.
- SQLite 数据持久化到 `gateway_data`（容器内 `/app/data/dev.db`） / SQLite data is persisted to `gateway_data`.
- MySQL 数据持久化到 `mysql_data`，PostgreSQL 数据持久化到 `postgres_data` / MySQL and PostgreSQL each use dedicated persistent volumes.

## Environment / 环境变量

```env
DATABASE_PROVIDER="sqlite"
DATABASE_URL="file:./dev.db"
CONSOLE_ENTRY_SECRET=""
GATEWAY_KEY_CACHE_TTL_MS="1500"
GATEWAY_KEY_CACHE_MAX="2048"
```

- `DATABASE_PROVIDER` 支持：`sqlite`、`mysql`、`postgresql` / Supported values: `sqlite`, `mysql`, `postgresql`.
- MySQL 连接串示例 / MySQL URL example:  
  `DATABASE_URL="mysql://codex:codex@127.0.0.1:3306/codex_gateway"`
- PostgreSQL 连接串示例 / PostgreSQL URL example:  
  `DATABASE_URL="postgresql://codex:codex@127.0.0.1:5432/codex_gateway?schema=public"`
- `CONSOLE_ENTRY_SECRET` 留空表示关闭入口暗号 / Empty `CONSOLE_ENTRY_SECRET` disables entry-secret protection.
- `GATEWAY_KEY_CACHE_TTL_MS` 与 `GATEWAY_KEY_CACHE_MAX` 用于高并发下本地 Key 缓存 / These two variables control local-key cache for high concurrency.
- `GATEWAY_KEY_CACHE_TTL_MS=0` 可关闭缓存 / Set `GATEWAY_KEY_CACHE_TTL_MS=0` to disable cache.
- 配置入口暗号后，访问 `/` 或 `/console/*` 会先跳转 `/secret-entry` / With entry-secret enabled, `/` and `/console/*` redirect to `/secret-entry`.

## Console Routes / 控制台路由

- `/console/access` - 本地 Key 接入 / Local key access
- `/console/upstream` - 上游渠道管理 / Upstream channel management
- `/console/runtime` - 运行时调度 / Runtime scheduling
- `/console/logs` - 请求日志 / Request logs
- `/console/calls` - AI 调用日志 / AI call logs
- `/console/usage` - 用量报表 / Usage report

## Main APIs / 主要接口

- `GET /api/health`
- `GET /api/config`
- `GET /api/keys`
- `POST /api/keys`
- `GET /api/keys/:id`
- `PUT /api/keys/:id`
- `DELETE /api/keys/:id`
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
- `POST /api/secret-entry`
- `DELETE /api/secret-entry`

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

## Codex Config Example / Codex 配置示例

```toml
base_url = "http://127.0.0.1:3000/v1"
wire_api = "responses"
model = "gpt-4.1-mini"
```

## Notes / 说明

- `wireApi` 固定为 `responses` / `wireApi` is fixed to `responses`.
- 本地 Key 必须符合 OpenAI 风格（`sk-...` 或 `sk-proj-...`） / Local key must match OpenAI-style format (`sk-...` or `sk-proj-...`).
- 客户端认证使用本地 Key，不是上游 API Key / Client auth uses local key, not upstream API key.

## License / 许可证

MIT License. See [LICENSE](LICENSE).
