#!/bin/sh
set -eu

# 图片任务服务和网页服务必须同时存活，避免页面可打开但任务提交静默失效。
node /opt/wenyun/image-tasks.mjs &
task_pid=$!

# 通过官方入口启动 Nginx，确保环境变量替换和反代配置在每次重建容器时都会执行。
/docker-entrypoint.sh nginx -g 'daemon off;' &
nginx_pid=$!

shutdown_services() {
    trap - TERM INT EXIT
    kill -TERM "$nginx_pid" "$task_pid" 2>/dev/null || true
    wait "$nginx_pid" 2>/dev/null || true
    wait "$task_pid" 2>/dev/null || true
}

trap shutdown_services TERM INT EXIT

while kill -0 "$nginx_pid" 2>/dev/null && kill -0 "$task_pid" 2>/dev/null; do
    sleep 1
done

exit 1
