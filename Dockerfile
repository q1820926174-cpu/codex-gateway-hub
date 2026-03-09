FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-bookworm-slim AS builder
ARG DATABASE_PROVIDER=sqlite
ARG DATABASE_URL=file:../data/dev.db
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
ENV DATABASE_PROVIDER=${DATABASE_PROVIDER}
ENV DATABASE_URL=${DATABASE_URL}
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run prisma:generate && npm run build

FROM node:22-bookworm-slim AS runner
ARG DATABASE_PROVIDER=sqlite
ARG DATABASE_URL=file:../data/dev.db
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
ENV DATABASE_PROVIDER=${DATABASE_PROVIDER}
ENV DATABASE_URL=${DATABASE_URL}
COPY --from=builder /app ./
RUN npm prune --omit=dev && rm -rf .next/cache
EXPOSE 3000
CMD ["sh", "-c", "npm run db:init && npm run start"]
