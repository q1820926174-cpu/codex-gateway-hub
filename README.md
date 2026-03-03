# OpenAI Compat -> Responses Gateway  
# OpenAI 兼容 -> Responses 网关

一体化 Next.js 控制台项目（前后端不分离），支持多上游供应商、多本地 Key、模型映射、视觉兜底、运行时模型切换与用量报表。  
An integrated Next.js console (non-separated frontend/backend) for multi-upstream providers, multi-local keys, model mapping, vision fallback, runtime model switching, and usage reports.

## GitHub Search SEO / GitHub 搜索优化关键词

`openai-compatible-gateway`, `responses-api`, `chat-completions`, `codex`, `multi-provider`, `api-gateway`, `model-routing`, `vision-fallback`, `token-usage`, `one-api-style`, `nextjs`, `prisma`, `ai-proxy`, `llm-gateway`, `openai-compat`

建议仓库 About 描述（可直接复制）/ Suggested GitHub About text:
- `OpenAI-compatible Codex/Responses gateway with multi-provider routing, model mapping, vision fallback, runtime switching, and token analytics.`
- `OpenAI 兼容的 Codex/Responses 网关，支持多上游路由、模型映射、视觉兜底、运行时切换与 Token 统计。`

建议在 GitHub 仓库 Topics 中添加（便于检索）/ Suggested GitHub Topics:
- `openai-compatible`
- `responses-api`
- `chat-completions`
- `llm-gateway`
- `multi-provider`
- `nextjs`
- `prisma`
- `codex`

## Core Features / 核心能力

- OpenAI 兼容网关：`/v1/chat/completions`、`/v1/completions`、`/v1/responses`
- 双线兼容上游协议：`responses` + `chat_completions`
- 多 Key + 多渠道 + 每 Key 独立模型映射
- 跨渠道视觉兜底（主模型不支持视觉时，先图片转文本）
- 运行时 API 切模、清空覆盖、启停 Key
- 请求日志 / AI 调用日志 / 分钟级 token 报表
- 中英文语言切换（控制台右上角）

## Quick Start / 快速启动

1. 安装依赖 / Install dependencies

```bash
npm install
```

2. 初始化环境与数据库 / Init env and database

```bash
cp .env.example .env
npm run prisma:migrate
```

3. 启动开发环境 / Start dev server

```bash
npm run dev
```

默认地址 / Default URL: `http://127.0.0.1:3000`

## Environment / 环境变量

```env
DATABASE_URL="file:./dev.db"
CONSOLE_ENTRY_SECRET=""
```

- `CONSOLE_ENTRY_SECRET` 为空时关闭网页暗号入口。  
  When empty, entry-secret protection is disabled.
- 配置后访问 `/` 或 `/console/*` 会先跳转 `/secret-entry`。  
  If set, `/` or `/console/*` redirects to `/secret-entry` first.

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
- `POST /api/upstreams/test` (上游模型连通测试 / upstream test)
- `POST /api/keys/test-upstream` (按 Key 测试上游 / test upstream by key)
- `GET /api/keys/switch-model` (查询运行时状态 / query runtime status)
- `POST /api/keys/switch-model` (运行时切模/启停 / switch/enable/disable)
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

### 4) Enable/Disable key / 启用或停用 Key

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

Selector rule / 选择器规则:
- 优先级：`id` > `localKey` > `keyName` > `Authorization Bearer`
- 若 `keyName` 命中多个 key，会返回 `409`

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

- `wireApi` 固定为 `responses`。  
  `wireApi` is fixed to `responses`.
- 本地 Key 必须符合 OpenAI 风格（`sk-...` 或 `sk-proj-...`）。  
  Local key must follow OpenAI format (`sk-...` or `sk-proj-...`).
- 客户端认证使用本地 Key，不是上游 API Key。  
  Client auth uses local key, not upstream API key.

## License / 许可证

MIT License. See [LICENSE](LICENSE).
