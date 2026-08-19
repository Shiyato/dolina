#!/usr/bin/env bash
# Деплой бэкенда Dolina API на прод.
# Сборка идёт НА СЕРВЕРЕ (нативный amd64): переносим исходники, собираем там.
# Причины: (1) нативный модуль better-sqlite3; (2) Docker Hub 429 обходится
# локальным тегом node:20-slim-amd64, уже загруженным на сервер.
#
# Требования: ssh-ключ ~/.ssh/fantasy_dev, локальный .env с ключами iiko+admin.

set -euo pipefail

HOST="root@72.56.9.4"
KEY="$HOME/.ssh/fantasy_dev"
NAME="dolina-api"
ENV_REMOTE="/opt/dolina/api.env"

echo "▶ Сборка dist локально (проверка типов)…"
(cd server && npm run build)

echo "▶ Упаковка исходников…"
(cd server && tar czf /tmp/dolina-api-src.tgz --exclude node_modules --exclude dist --exclude data .)

echo "▶ Перенос исходников и .env на сервер…"
ssh -i "$KEY" -o BatchMode=yes "$HOST" "mkdir -p /opt/dolina"
scp -i "$KEY" -o BatchMode=yes /tmp/dolina-api-src.tgz "$HOST:/opt/dolina/api-src.tgz"
scp -i "$KEY" -o BatchMode=yes ./.env "$HOST:$ENV_REMOTE"

echo "▶ Сборка образа на сервере и перезапуск…"
ssh -i "$KEY" -o BatchMode=yes -o ServerAliveInterval=15 "$HOST" '
set -e
rm -rf /opt/dolina/api-src && mkdir -p /opt/dolina/api-src
tar xzf /opt/dolina/api-src.tgz -C /opt/dolina/api-src
cd /opt/dolina/api-src
# базовый образ уже на сервере локальным тегом (обход docker hub rate limit)
sed -i "s|FROM node:20-slim|FROM node:20-slim-amd64|g" Dockerfile
docker build -t dolina-api:latest . 2>&1 | tail -2
docker rm -f dolina-api 2>/dev/null || true
docker run -d --name dolina-api --restart unless-stopped \
  -p 127.0.0.1:3001:3001 \
  --env-file /opt/dolina/api.env \
  -e CORS_ORIGIN=https://dolina-coffee.ru \
  -e JOURNAL_PATH=/app/data/journal.json \
  -v dolina-api-data:/app/data \
  dolina-api:latest
docker image prune -f >/dev/null
'

echo "▶ Настройка nginx (/api → :3001)…"
ssh -i "$KEY" -o BatchMode=yes "$HOST" 'grep -q "location /api/" /etc/nginx/sites-available/dolina-coffee.conf && echo "  location /api/ уже есть" && nginx -t -q && systemctl reload nginx'

echo "▶ Проверка…"
sleep 3
code=$(curl -s -o /dev/null -w '%{http_code}' --connect-timeout 15 https://dolina-coffee.ru/api/health)
echo "  https://dolina-coffee.ru/api/health  →  HTTP $code"
[ "$code" = "200" ] && echo "✅ API задеплоен" || { echo "⚠️  health не 200 (docker logs dolina-api)"; exit 1; }
