#!/usr/bin/env bash
# Деплой Dolina Coffee PWA на прод.
# Собирает образ под linux/amd64, переносит на сервер и перезапускает контейнер.
#
# Требования: docker (с buildx), ssh-ключ ~/.ssh/fantasy_dev.
# Использование:  ./deploy.sh

set -euo pipefail

HOST="root@72.56.9.4"
KEY="$HOME/.ssh/fantasy_dev"
IMAGE="dolina-coffee:latest"
NAME="dolina"

echo "▶ Сборка образа ($IMAGE, linux/amd64)…"
docker build --platform linux/amd64 -t "$IMAGE" --load .

echo "▶ Перенос образа на сервер…"
docker save "$IMAGE" | gzip | \
  ssh -i "$KEY" -o BatchMode=yes "$HOST" 'gunzip | docker load'

echo "▶ Перезапуск контейнера…"
# Контейнер слушает только localhost:8080 — публичные 80/443 держит host-nginx (TLS).
ssh -i "$KEY" -o BatchMode=yes "$HOST" \
  "docker rm -f $NAME 2>/dev/null || true; \
   docker run -d --name $NAME --restart unless-stopped -p 127.0.0.1:8080:80 $IMAGE; \
   docker image prune -f >/dev/null"

echo "▶ Проверка…"
sleep 2
code=$(curl -s -o /dev/null -w '%{http_code}' --connect-timeout 15 https://dolina-coffee.ru/)
echo "  https://dolina-coffee.ru/  →  HTTP $code"
[ "$code" = "200" ] && echo "✅ Готово" || { echo "❌ Проверка не прошла"; exit 1; }
