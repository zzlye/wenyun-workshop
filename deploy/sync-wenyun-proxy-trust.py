#!/usr/bin/env python3
"""同步西米露容器的代理信任地址，避免重启后不同用户共用限流额度。"""
import datetime
import fcntl
import ipaddress
import json
import pathlib
import re
import subprocess


def run(args, **kwargs):
    return subprocess.run(args, check=True, capture_output=True, text=True, timeout=20, **kwargs)


def main():
    # 与手动执行共用进程锁；只改内部 3000 端口的单地址信任规则。
    with open('/run/wenyun-proxy-trust.lock', 'w') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        container = json.loads(run(['docker', 'inspect', 'wenyun-workshop']).stdout)[0]
        if not container['State']['Running']:
            return
        network = container['NetworkSettings']['Networks']['new-api_new-api-network']
        address = ipaddress.ip_address(network['IPAddress'])
        if address.version != 4 or not address.is_private:
            raise RuntimeError('西米露容器地址不符合内部 IPv4 要求')
        config = pathlib.Path('/opt/new-api/caddy/Caddyfile')
        before = config.read_text()
        pattern = r'(http://:3000\s*\{\s*reverse_proxy\s+127\.0\.0\.1:\d+\s*\{[^{}]*?trusted_proxies\s+)(\d+\.\d+\.\d+\.\d+/32)(\s*\})'
        matches = list(re.finditer(pattern, before))
        if len(matches) != 1:
            raise RuntimeError('内部代理规则结构已变化，停止自动修改')
        match = matches[0]
        wanted = str(address) + '/32'
        if match.group(2) == wanted:
            print('代理信任地址已一致：' + wanted)
            return
        after = before[:match.start(2)] + wanted + before[match.end(2):]
        command = ['docker', 'exec', '-i', 'new-api-caddy', 'caddy']
        run(command + ['validate', '--config', '/dev/stdin', '--adapter', 'caddyfile'], input=after)
        backup = config.parent / 'backups' / ('proxy-trust-' + datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S%fZ'))
        backup.mkdir(parents=True, mode=0o700)
        (backup / 'Caddyfile.before').write_text(before)
        if config.read_text() != before:
            raise RuntimeError('配置被同时修改，停止自动更新')
        # 保留绑定挂载文件的 inode；热加载失败即回滚原配置。
        try:
            config.write_text(after)
            run(command + ['reload', '--config', '/etc/caddy/Caddyfile', '--adapter', 'caddyfile'])
        except Exception:
            config.write_text(before)
            run(command + ['reload', '--config', '/etc/caddy/Caddyfile', '--adapter', 'caddyfile'])
            raise
        print('代理信任地址已更新：' + match.group(2) + ' -> ' + wanted)


if __name__ == '__main__':
    main()
