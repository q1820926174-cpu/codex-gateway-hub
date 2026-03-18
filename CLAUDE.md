# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Setup
cp .env.example .env
npm install
npm run prisma:migrate      # generate Prisma client + init DB

# Development
npm run dev                 # starts Next.js dev server (predev auto-runs prisma:generate)

# Production
npm run build
npm run start

# Database
npm run prisma:generate     # regenerate Prisma client after schema changes
npm run prisma:reset        # wipe and re-seed the database
npm run db:migrate:from-sqlite  # migrate SQLite data to MySQL/PostgreSQL

# Benchmarking
npm run bench:codex-prompts
```

No lint or test scripts exist. TypeScript strict mode serves as the primary correctness check.

## Architecture

**Codex Gateway Hub** is a Next.js App Router application that acts as an OpenAI-compatible API gateway. It translates between three wire APIs (`responses`, `chat_completions`, `anthropic_messages`) and routes requests through configurable upstream provider channels.

### Request Flow

```
Client → Rate Limit → API Log → resolveGatewayKey() → pickRequestedModel()
       → resolveRequestedModelMapping() → estimateLegacyChatTokens()
       → checkKeyDailyLimits() → pickModelByContext()
       → mapLegacyChatToResponses() → callResponsesApi[Stream]()
       → mapResponsesToLegacyChat() → recordTokenUsageEvent() → appendAiCallLogEntry()
```

### Key Layers

**Gateway endpoints** (`app/api/v1/`) — public-facing, OpenAI/Anthropic-compatible:
- `/chat/completions`, `/completions`, `/responses`, `/messages`, `/files`

**Console API** (`app/api/`) — protected by entry secret + cookie auth:
- `/keys`, `/upstreams`, `/usage`, `/logs`, `/secret-entry`, `/prompt-lab`

**Core library** (`lib/`) — all business logic lives here:
- `compat-handlers.ts` — main request routing and wire API dispatch (~198KB, central file)
- `mapper.ts` — request/response format conversion between wire APIs
- `upstream.ts` — upstream provider HTTP calls and key resolution
- `key-config.ts` — Zod schemas for key validation and config
- `usage-report.ts` — token tracking and daily limit enforcement
- `model-switch.ts` — dynamic model switching by context size
- `anthropic-compat.ts` — Anthropic Messages API compatibility
- `token-estimator.ts` — token counting via `js-tiktoken`
- `compat-config.ts` — Codex compatibility prompt rules
- `codex-export.ts` — native Codex CLI config bundle export
- `openai-file-store.ts` — file upload storage for vision inputs
- `ai-call-log-store.ts` — NDJSON AI call logging
- `api-log.ts` — request/response logging with sensitive field redaction
- `rate-limit.ts` — in-memory sliding window rate limiter
- `entry-secret.ts` / `console-api-auth.ts` — console authentication

**Frontend console** (`app/console/`, `components/console/`) — React 19 + TDesign + React Query + Zustand.

### Database (Prisma)

Three models in `prisma/schema.prisma`:
- `ProviderKey` — local gateway keys with per-key model mappings, upstream config, daily limits, runtime overrides
- `UpstreamChannel` — upstream provider configurations (reusable across keys)
- `TokenUsageEvent` — minute-bucketed token usage for analytics

Supports SQLite (default), MySQL, PostgreSQL — selected via `DATABASE_PROVIDER` env var. After any schema change, run `npm run prisma:generate`.

### Important Patterns

- **Wire API translation**: all requests normalize to internal `ResponsesRequest`, then map to the upstream's wire format, then map back on response.
- **Key resolution**: cached in-memory (default 1.5s TTL, max 2048 entries) — look up by `Authorization: Bearer` or `x-api-key`.
- **Model mapping**: per-key JSON mappings support round-robin, context-switch overrides, and vision fallback channels.
- **Rate limiting**: in-memory only — 120 req/min per IP on gateway routes, 20 req/min on entry secret, brute-force lockout after 6 failures in 5 min.
- **Logging**: API logs (redacted), AI call logs (NDJSON in `/logs/`), usage events (DB). File blobs stored in `/data/`.
- **Zod schemas** are used for all config validation at system boundaries (`key-config.ts`, `upstream-channel-config.ts`).
