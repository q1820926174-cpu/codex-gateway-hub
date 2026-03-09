FROM node:22-bookworm-slim AS deps
ARG DOCKER_ACCELERATE_CN=0
ARG NPM_REGISTRY=https://registry.npmjs.org/
ARG NPM_REGISTRY_CN=https://registry.npmmirror.com/
ARG HTTP_PROXY=
ARG HTTPS_PROXY=
ARG NO_PROXY=
WORKDIR /app
ENV HTTP_PROXY=${HTTP_PROXY}
ENV HTTPS_PROXY=${HTTPS_PROXY}
ENV NO_PROXY=${NO_PROXY}
COPY package.json package-lock.json ./
RUN set -eux; \
    registry="${NPM_REGISTRY}"; \
    case "${DOCKER_ACCELERATE_CN}" in \
      1|true|TRUE|yes|YES|on|ON) registry="${NPM_REGISTRY_CN}" ;; \
      *) ;; \
    esac; \
    npm config set registry "${registry}"; \
    npm config set fetch-retries 5; \
    npm config set fetch-retry-factor 2; \
    npm config set fetch-retry-mintimeout 20000; \
    npm config set fetch-retry-maxtimeout 120000; \
    echo "Using npm registry: $(npm config get registry)"; \
    npm ci

FROM node:22-bookworm-slim AS builder
ARG DATABASE_PROVIDER=sqlite
ARG DATABASE_URL=file:../data/dev.db
ARG HTTP_PROXY=
ARG HTTPS_PROXY=
ARG NO_PROXY=
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
ENV DATABASE_PROVIDER=${DATABASE_PROVIDER}
ENV DATABASE_URL=${DATABASE_URL}
ENV HTTP_PROXY=${HTTP_PROXY}
ENV HTTPS_PROXY=${HTTPS_PROXY}
ENV NO_PROXY=${NO_PROXY}
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run prisma:generate && npm run build

FROM node:22-bookworm-slim AS runner
ARG DATABASE_PROVIDER=sqlite
ARG DATABASE_URL=file:../data/dev.db
ARG HTTP_PROXY=
ARG HTTPS_PROXY=
ARG NO_PROXY=
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
ENV DATABASE_PROVIDER=${DATABASE_PROVIDER}
ENV DATABASE_URL=${DATABASE_URL}
ENV HTTP_PROXY=${HTTP_PROXY}
ENV HTTPS_PROXY=${HTTPS_PROXY}
ENV NO_PROXY=${NO_PROXY}
COPY --from=builder /app ./
RUN npm prune --omit=dev && rm -rf .next/cache
EXPOSE 3000
CMD ["sh", "-c", "npm run db:init && npm run start"]
