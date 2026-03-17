# Codex Gateway Hub v0.1.0

Initial public release of an OpenAI-compatible gateway built for Codex, Responses, Chat Completions, and Anthropic Messages workflows.

## Highlights

- Multi-provider routing with per-key model mapping
- `responses`, `chat/completions`, and `anthropic_messages` upstream compatibility
- Runtime model switching and key enable/disable controls
- Vision fallback for non-vision primary models
- File upload plus image and video `file_id` reuse
- Web console for access, upstreams, runtime state, logs, and usage analytics
- Docker deployment with SQLite by default and MySQL/PostgreSQL support

## Getting Started

```bash
npm install
cp .env.example .env
npm run prisma:migrate
npm run dev
curl -sS http://127.0.0.1:3000/api/health
```

## Who This Helps

- people bridging legacy OpenAI-compatible providers into Codex
- operators who need one local gateway key across multiple upstream vendors
- teams that want runtime model switching without changing client configuration
- users who need vision fallback and request analytics in the same gateway

## Notes

- The first database initialization seeds a default upstream channel and a local `sk-...` key.
- Configure your upstream API key in the web console if it is not already present in `.env`.
