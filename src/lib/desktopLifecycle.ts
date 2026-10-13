import { getDesktopBridge } from './desktop'
import { flushAppPersistence, useStore } from '../store'
import { useConfigStore } from '../infiniteCanvasSource/stores/use-config-store'
import { useAgentStore } from '../infiniteCanvasSource/stores/use-agent-store'
import { flushCanvasStorePersistence, useCanvasStore } from '../infiniteCanvasSource/app/(user)/canvas/stores/use-canvas-store'

export async function initializeDesktop() {
  const desktop = getDesktopBridge()
  if (!desktop) return
  desktop.onBeforeClose(async () => {
    // 先把界面的最新视角送入状态，再等待画布、任务和磁盘队列全部完成。
    window.dispatchEvent(new Event('wenyun:flush-desktop-state'))
    await flushCanvasStorePersistence()
    await flushAppPersistence()
    await desktop.storage.flush()
    const state = useStore.getState()
    const agent = useAgentStore.getState()
    const busy = state.tasks.some((task) => task.status === 'running')
      || state.agentConversations.some((conversation) => conversation.rounds.some((round) => round.status === 'running'))
      || useCanvasStore.getState().projects.some((project) => project.nodes.some((node) => node.metadata?.status === 'loading'))
      || agent.sending || agent.waiting || agent.conversation.status === 'running'
    return { busy }
  })
  // 桌面配置为异步加密文件，必须完成恢复再挂载界面，不能用默认值覆盖旧配置。
  await useStore.persist.rehydrate()
  await useConfigStore.persist.rehydrate()
  if (!useStore.persist.hasHydrated() || !useConfigStore.persist.hasHydrated()) throw new Error('本地配置读取失败，原文件已保留。请检查数据目录权限后重新启动。')
}
