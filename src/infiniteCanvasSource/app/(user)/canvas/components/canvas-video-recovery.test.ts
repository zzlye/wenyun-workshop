import { readFileSync } from 'node:fs'
import ts from 'typescript'
import axios from 'axios'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { requestVideoGeneration, VideoTaskPendingError } from '../../../../services/api/video'
import { defaultConfig } from '../../../../stores/use-config-store'
import { CanvasNodeType, type CanvasNodeData } from '../types'
import { reconcileHydratedCanvasNodes } from '../utils/canvas-media-hydration'

vi.mock('axios', () => ({
  default: {
    post: vi.fn(),
    get: vi.fn(),
    isAxiosError: (error: { isAxiosError?: boolean }) => Boolean(error?.isAxiosError),
  },
}))

// 直接执行页面的恢复回调与首次读盘流程，覆盖接口失败到节点显示的完整状态写回。
const source = readFileSync(new URL('../[id]/canvas-client-page.tsx', import.meta.url), 'utf8')
const ast = ts.createSourceFile(
  'canvas-client-page.tsx',
  source,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
)
let recovery = ''
let restoration = ''
function visit(node: ts.Node) {
  if (
    ts.isVariableDeclaration(node) &&
    node.name.getText(ast) === 'recoverCanvasVideoTaskNode' &&
    node.initializer &&
    ts.isCallExpression(node.initializer)
  ) {
    recovery = node.initializer.arguments[0].getText(ast)
  }
  if (
    ts.isCallExpression(node) &&
    node.expression.getText(ast) === 'useEffect' &&
    node.arguments[0]?.getText(ast).includes('const project = openProject(projectId)')
  ) {
    restoration = node.arguments[0].getText(ast)
  }
  ts.forEachChild(node, visit)
}
visit(ast)
if (!recovery || !restoration) throw new Error('未找到页面实际视频恢复流程')

function callback<T>(body: string, deps: Record<string, unknown>): T {
  const compiled = ts.transpileModule(`const handler = ${body};`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText
  return new Function(...Object.keys(deps), compiled + '\nreturn handler;')(...Object.values(deps))
}

const taskId = 'async_sd_failed'
const errorMessage = '我暂时无法为您服务，请重新提交'
const loadingNode: CanvasNodeData = {
  id: 'sd-result',
  type: CanvasNodeType.Video,
  title: 'SD2.0 视频',
  position: { x: 20, y: 30 },
  width: 420,
  height: 240,
  metadata: { status: 'loading', videoTaskId: taskId, model: 'sd-2.0-720p', generationStartedAt: 1000 },
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

function scenario() {
  let project = {
    id: 'sd-project',
    nodes: [loadingNode],
    connections: [],
    groups: [],
    chatSessions: [],
    activeChatId: null,
    backgroundMode: 'lines',
    showImageInfo: false,
    viewport: { x: 0, y: 0, k: 1 },
  }
  const nodes = { current: project.nodes }
  const recovering = { current: new Set<string>() }
  const running = new Set<string>()
  const setNodes = vi.fn((next: CanvasNodeData[]) => {
    nodes.current = next
  })
  const deps = {
    CanvasNodeType,
    VideoTaskPendingError,
    requestVideoGeneration,
    NODE_STATUS_LOADING: 'loading',
    NODE_STATUS_ERROR: 'error',
    CLEARED_VIDEO_TASK_METADATA: { videoTaskId: undefined, videoTaskPhase: undefined },
    effectiveConfig: { ...defaultConfig, videoApiKey: 'video-test-key' },
    normalizeCanvasVideoModel: (model: string) => model,
    buildGenerationTiming: () => ({ generationElapsedMs: 100 }),
    recoveringVideoTaskIdsRef: recovering,
    markCanvasNodeRunning: (id: string) => running.add(id),
    clearCanvasNodeRunning: (ids: string[]) => ids.forEach((id) => running.delete(id)),
    persistCanvasVideoTaskReference: vi.fn(),
    uploadMediaFile: vi.fn(),
    commitGenerationNodes: (update: (nodes: CanvasNodeData[]) => CanvasNodeData[]) => {
      project = { ...project, nodes: update(project.nodes) }
      setNodes(project.nodes)
    },
    fitNodeSize: () => ({}),
    getGeneratedMediaSizePatch: () => ({}),
    videoMetadata: () => ({}),
    VIDEO_NODE_MAX_WIDTH: 420,
    VIDEO_NODE_MAX_HEIGHT: 420,
    hydrated: true,
    projectId: project.id,
    openProject: () => project,
    useCanvasStore: { getState: () => ({ projects: [project] }) },
    getCanvasGenerationSessionIds: () => new Set(running),
    resetInterruptedCanvasGenerations: (items: CanvasNodeData[]) => items,
    hydrateCanvasImages: vi.fn(async (items: CanvasNodeData[]) => items),
    hydrateAssistantImages: vi.fn(async () => []),
    reconcileHydratedCanvasNodes,
    nodesRef: nodes,
    connectionsRef: { current: [] },
    runningNodeIdsRef: { current: running },
    setNodes,
    setProjectLoaded: vi.fn(),
    replaceCanvasRoute: vi.fn(),
    setRunningNodeIds: vi.fn(),
    setConnections: vi.fn(),
    setGroups: vi.fn(),
    setChatSessions: vi.fn(),
    setActiveChatId: vi.fn(),
    setBackgroundMode: vi.fn(),
    setShowImageInfo: vi.fn(),
    setViewport: vi.fn(),
    didInitialCenterRef: { current: false },
    historyRef: { current: {} },
    historyCommitTimerRef: { current: null },
    lastHistoryRef: { current: {} },
    setHistoryState: vi.fn(),
  }
  const recover = callback<(node: CanvasNodeData) => Promise<void>>(recovery, deps)
  const restore = callback<() => (() => void) | undefined>(restoration, deps)
  return { nodes, deps, recover, restore, running, recovering, project: () => project }
}

describe('SD2.0 失败结果回写画布', () => {
  it('真实失败响应结束生成，清除恢复凭据与运行锁，不重复提交', async () => {
    vi.mocked(axios.get).mockResolvedValueOnce({
      data: {
        id: taskId,
        task_id: taskId,
        model: 'sd-2.0-720p',
        status: 'failed',
        result_expired: false,
        error: { message: errorMessage },
      },
    })
    const s = scenario()
    const pending = s.recover(loadingNode)
    await vi.advanceTimersByTimeAsync(10)
    await pending

    expect(s.nodes.current[0].metadata).toMatchObject({
      status: 'error',
      errorDetails: errorMessage,
      videoTaskId: undefined,
      videoTaskPhase: undefined,
    })
    expect(s.project().nodes).toBe(s.nodes.current)
    expect(s.running.size).toBe(0)
    expect(s.recovering.current.size).toBe(0)
    expect(axios.get).toHaveBeenCalledTimes(1)
    expect(axios.post).not.toHaveBeenCalled()
    expect(s.deps.uploadMediaFile).not.toHaveBeenCalled()
  })

  it('读盘途中收到失败后，迟到的旧 loading 快照不能把错误覆盖回生成中', async () => {
    vi.mocked(axios.get).mockResolvedValueOnce({
      data: {
        id: taskId,
        status: 'failed',
        error: { message: errorMessage },
      },
    })
    const s = scenario()
    let finishHydration!: (nodes: CanvasNodeData[]) => void
    s.deps.hydrateCanvasImages.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishHydration = resolve
        }),
    )
    const cleanup = s.restore()
    const pending = s.recover(loadingNode)
    await vi.advanceTimersByTimeAsync(10)
    await pending
    expect(s.nodes.current[0].metadata?.status).toBe('error')

    finishHydration([loadingNode])
    await vi.advanceTimersByTimeAsync(10)

    expect(s.nodes.current[0].metadata).toMatchObject({ status: 'error', errorDetails: errorMessage })
    expect(s.nodes.current).toBe(s.project().nodes)
    expect(s.deps.setProjectLoaded).toHaveBeenLastCalledWith(true)
    expect(axios.get).toHaveBeenCalledTimes(1)
    expect(axios.post).not.toHaveBeenCalled()
    cleanup?.()
  })
})
