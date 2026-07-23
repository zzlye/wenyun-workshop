#!/bin/sh
set -eu

# 两个进程必须同时存活，任一退出都让容器失败，避免网页可打开但保活通道静默失效。
node /opt/wenyun/image-relay.mjs &
relay_pid=$!

nginx -g 'daemon off;' &
nginx_pid=$!

shutdown_services() {
    trap - TERM INT EXIT
    kill -TERM "$nginx_pid" "$relay_pid" 2>/dev/null || true
    wait "$nginx_pid" 2>/dev/null || true
    wait "$relay_pid" 2>/dev/null || true
}

trap shutdown_services TERM INT EXIT

while kill -0 "$nginx_pid" 2>/dev/null && kill -0 "$relay_pid" 2>/dev/null; do
    sleep 1
done

exit 1
