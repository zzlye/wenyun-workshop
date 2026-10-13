import { Button, Input } from 'antd';
import { KeyRound, Link2, PlugZap } from 'lucide-react';
import { canvasThemes } from '@/lib/canvas-theme';

export function AgentConnectView({ theme, url, token, enabled, connected, activity, connectError, onUrlChange, onTokenChange, onToggleEnabled }: {
    theme: (typeof canvasThemes)[keyof typeof canvasThemes];
    url: string; token: string; enabled: boolean; connected: boolean; activity: string; connectError: string;
    onUrlChange: (value: string) => void; onTokenChange: (value: string) => void; onToggleEnabled: () => void;
}) {
    return <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <div className="mb-5 flex items-center justify-between gap-3">
            <h2 className="text-base font-semibold">连接 Canvas Agent</h2>
            <span className="text-xs" style={{ color: connected ? '#16a34a' : theme.node.muted }}>{connected ? '已连接' : enabled ? '连接中' : '未连接'}</span>
        </div>
        <div className="space-y-4">
            <label className="grid gap-2 text-sm">服务地址
                <Input aria-label="Agent 服务地址" disabled={enabled} prefix={<Link2 size={16} />} value={url} onChange={e => onUrlChange(e.target.value)} placeholder="http://127.0.0.1:17371" />
            </label>
            <label className="grid gap-2 text-sm">连接令牌
                <Input.Password aria-label="Agent 连接令牌" disabled={enabled} prefix={<KeyRound size={16} />} value={token} onChange={e => onTokenChange(e.target.value)} autoComplete="off" />
            </label>
            <Button type={enabled ? 'default' : 'primary'} icon={<PlugZap size={16} />} onClick={onToggleEnabled}>{enabled ? '断开连接' : '连接'}</Button>
            {connectError ? <p role="alert" className="break-words text-sm text-red-600">{connectError}</p> : enabled ? <p className="break-words text-xs" style={{ color: theme.node.muted }}>{activity}</p> : null}
        </div>
    </div>;
}
