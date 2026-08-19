# ── build ──────────────────────────────────────────────────────────
# debian-slim (glibc): better-sqlite3 сегфолтит на alpine/musl (проверено).
# toolchain нужен для node-gyp (better-sqlite3 собирается из исходников).
FROM node:20-slim AS build
WORKDIR /app
RUN apt-get update -qq && apt-get install -y -qq python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json* ./
RUN npm ci
COPY . .
RUN npm run build \
  && npm prune --omit=dev

# ── runtime ────────────────────────────────────────────────────────
FROM node:20-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
# node_modules переносим из build (уже собранные нативные модули, без dev).
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
# Данные (журнал + admin.sqlite) — на volume.
RUN mkdir -p /app/data
VOLUME ["/app/data"]

EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD node -e "fetch('http://localhost:3001/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/index.js"]
