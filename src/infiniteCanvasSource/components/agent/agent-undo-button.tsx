import { App, Button, Tooltip } from 'antd';
import { Undo2 } from 'lucide-react';
import { useAgentStore } from '@/stores/use-agent-store';

export function AgentUndoButton() {
    const canUndo = useAgentStore(state => Boolean(state.canvasContext?.canUndo));
    const { message } = App.useApp();
    return <Tooltip title="撤销画布修改"><Button type="text" aria-label="撤销画布修改" disabled={!canUndo} icon={<Undo2 size={16} />} onClick={() => {
        try { useAgentStore.getState().canvasContext?.undoOps(); }
        catch (error) { message.warning(error instanceof Error ? error.message : '撤销失败'); }
    }} /></Tooltip>;
}
