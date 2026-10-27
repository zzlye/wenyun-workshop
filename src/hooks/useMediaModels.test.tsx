// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, expect, it, vi } from 'vitest'
import { useMediaModels } from './useMediaModels'
import { useVideoModels } from './useVideoModels'
import { CANVAS_VIDEO_BASE_URL } from '../lib/videoModel'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
afterEach(() => vi.restoreAllMocks())

it('自动读取并合并工坊、画布、视频目录请求，换 Key 时隔离迟到结果', async () => {
  let resolveOld!: (value: Response) => void
  const old = new Promise<Response>(resolve => { resolveOld = resolve })
  const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
    if ((init?.headers as Record<string, string>).Authorization === 'Bearer old') return old
    return new Response(JSON.stringify({ data: [{ id: 'nano-banana-2' }, { id: 'sd2.5-720p' }] }))
  })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  const host = document.createElement('div')
  const root = createRoot(host)
  function Probe({ apiKey }: { apiKey: string }) {
    const models = useMediaModels(CANVAS_VIDEO_BASE_URL, apiKey, false)
    const second = useMediaModels(CANVAS_VIDEO_BASE_URL, apiKey, false)
    const video = useVideoModels(apiKey, false)
    return <div>{models.data?.images.map(item => item.value).join(',')}{second.data?.images.length}{video.data?.join(',')}</div>
  }
  const render = async (apiKey: string) => act(async () => root.render(<QueryClientProvider client={client}><Probe apiKey={apiKey} /></QueryClientProvider>))
  const settle = async () => act(async () => { await new Promise(resolve => setTimeout(resolve, 20)) })
  try {
    await render('')
    expect(fetchMock).not.toHaveBeenCalled()
    await render('old')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await render('new')
    await settle()
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(host.textContent).toContain('Nano-Banana-2')
    expect(host.textContent).toContain('sd2.5-720p')
    await act(async () => resolveOld(new Response(JSON.stringify({ data: [{ id: 'gpt-image-2' }] }))))
    await settle()
    expect(host.textContent).not.toContain('gpt-image-2')
    await render('')
    expect(host.textContent).not.toContain('Nano-Banana-2')
  } finally {
    await act(async () => root.unmount())
    client.clear()
  }
})
