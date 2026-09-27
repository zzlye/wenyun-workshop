#!/bin/sh
set -eu

config=${CADDY_CONFIG:-/opt/new-api/caddy/Caddyfile}
backup=${CADDY_BACKUP:-/opt/new-api/caddy/Caddyfile.before-h2-20260927}
test -f "$backup"
cp "$backup" "$config"

# 隔离副本验证只恢复文件，生产回退还需重新加载配置。
if [ "${CADDY_SKIP_RELOAD:-0}" = 1 ]; then
    exit 0
fi

docker exec new-api-caddy caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
docker exec new-api-caddy caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile
