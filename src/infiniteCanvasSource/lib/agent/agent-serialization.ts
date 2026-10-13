// 工具快照不需要账户凭证或存储内部标识；完整参考图仅在用户选择附件后单独发送。
export function agentSnapshotJson(value: unknown) {
    return JSON.stringify(value, (key, item) => {
        if (/api.?key|token|secret|password|authorization|credential|storage.?key/i.test(key)) return undefined;
        if (typeof item === 'string' && item.startsWith('data:')) return '[媒体数据]';
        return item;
    });
}
