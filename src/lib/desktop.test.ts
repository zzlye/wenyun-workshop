import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDesktopBlobStorage, createDesktopStateStorage, desktopRequestUrl, type DesktopBridge } from './desktop'
import { buildApiUrl } from './devProxy'
import { getAllTasks, getImage, putTask, putImage, deleteImage, replaceAgentConversations } from './db'

afterEach(() => vi.unstubAllGlobals())

function bridge() {
  const storage = { get: vi.fn(), put: vi.fn().mockResolvedValue('one'), all: vi.fn().mockResolvedValue([]), remove: vi.fn(), clear: vi.fn(), keys: vi.fn(), replace: vi.fn() }
  vi.stubGlobal('window', { wenyunDesktop: { version: 1, storage } as unknown as DesktopBridge })
  return storage
}

describe('桌面存储适配', () => {
  it('没有桌面桥时保留浏览器存储和请求路径', () => {
    expect(createDesktopBlobStorage('canvas-images')).toBeUndefined()
    expect(createDesktopStateStorage('settings')).toBeUndefined()
    expect(desktopRequestUrl('https://example.com/v1/models')).toBe('https://example.com/v1/models')
  })

  it('工坊的图片和任务通过桌面存储，缺失记录仍返回 undefined', async () => {
    const storage = bridge()
    storage.get.mockResolvedValue(null)
    const task = { id: 'one', prompt: '测试' } as Parameters<typeof putTask>[0]
    const image = { id: 'one', dataUrl: 'data:image/png;base64,AQID', createdAt: 1 }
    await putTask(task)
    await putImage(image)
    await getAllTasks()
    expect(await getImage('missing')).toBeUndefined()
    expect(storage.put).toHaveBeenCalledWith('tasks', 'one', task)
    expect(storage.put).toHaveBeenCalledWith('images', 'one', image)
    expect(storage.all).toHaveBeenCalledWith('tasks')
  })

  it('删除原图也删除缩略图，批量对话使用原子替换入口', async () => {
    const storage = bridge()
    storage.remove.mockResolvedValue(undefined)
    storage.replace.mockResolvedValue(undefined)
    await deleteImage('one')
    await replaceAgentConversations([])
    expect(storage.remove).toHaveBeenCalledWith('images', 'one')
    expect(storage.remove).toHaveBeenCalledWith('thumbnails', 'one')
    expect(storage.replace).toHaveBeenCalledWith('agentConversations', [])
  })

  it('Blob 跨隔离桥保留类型和原始内容', async () => {
    const storage = bridge()
    const adapter = createDesktopBlobStorage('canvas-images')!
    const original = new Blob([new Uint8Array([0, 255, 128])], { type: 'image/png' })
    await adapter.setItem('image:one', original)
    const payload = storage.put.mock.calls[0][2]
    expect(payload.mimeType).toBe('image/png')
    expect(Array.from(new Uint8Array(payload.bytes))).toEqual([0, 255, 128])
    storage.get.mockResolvedValue(payload)
    const restored = (await adapter.getItem<Blob>('image:one'))!
    expect(restored.type).toBe('image/png')
    expect(Array.from(new Uint8Array(await restored.arrayBuffer()))).toEqual([0, 255, 128])
  })

  it('磁盘写入失败向上传递，不能静默改存浏览器', async () => {
    const storage = bridge()
    storage.put.mockRejectedValue(new Error('磁盘已满'))
    await expect(createDesktopStateStorage('canvas-state')!.setItem('one', 'value')).rejects.toThrow('磁盘已满')
  })

  it('桌面自定义接口经本机转发，内置接口沿用既有路径', () => {
    bridge()
    expect(buildApiUrl('https://custom.example/v1', 'images/edits', null, false)).toBe('/desktop-api/https/custom.example/v1/images/edits')
    expect(buildApiUrl('https://api.zzlye.xyz/v1', 'images/edits', null, true)).toBe('/api-proxy/wenyun/images/edits')
    expect(desktopRequestUrl('blob:test')).toBe('blob:test')
    expect(desktopRequestUrl('/image-tasks/one')).toBe('/image-tasks/one')
  })
})
