#!/usr/bin/env bash
# Деплой статики админ-панели на https://dolina-coffee.ru/admin/
set -euo pipefail
HOST="root@72.56.9.4"
KEY="$HOME/.ssh/fantasy_dev"

echo "▶ Сборка админки…"
(cd admin && npm run build)

echo "▶ Перенос на сервер…"
tar czf /tmp/admin-dist.tgz -C admin/dist .
scp -i "$KEY" -o BatchMode=yes /tmp/admin-dist.tgz "$HOST:/opt/dolina/admin-dist.tgz"
ssh -i "$KEY" -o BatchMode=yes "$HOST" '
rm -rf /opt/dolina/admin-dist && mkdir -p /opt/dolina/admin-dist
tar xzf /opt/dolina/admin-dist.tgz -C /opt/dolina/admin-dist
'
echo "▶ Проверка…"
code=$(curl -s -o /dev/null -w '%{http_code}' https://dolina-coffee.ru/admin/)
echo "  https://dolina-coffee.ru/admin/  →  HTTP $code"
[ "$code" = "200" ] && echo "✅ Готово" || exit 1
