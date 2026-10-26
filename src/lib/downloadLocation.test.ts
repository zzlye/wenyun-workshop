// @vitest-environment happy-dom
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { chooseDownloadLocation, disableDownloadLocation, downloadFile, getDownloadLocation } from './downloadLocation'

const fixture = vi.hoisted(() => ({
  value: null as any,
  saveAs: vi.fn(),
  bridge: undefined as any,
  picker: vi.fn(),
}))
vi.mock('localforage', () => ({ default: { INDEXEDDB: 'indexeddb', createInstance: () => ({
  getItem: async () => fixture.value,
  setItem: async (_key: string, value: unknown) => { fixture.value = value },
}) } }))
vi.mock('file-saver', () => ({ saveAs: (...args: unknown[]) => fixture.saveAs(...args) }))
vi.mock('./desktop', () => ({ getDesktopBridge: () => fixture.bridge }))

beforeEach(() => {
  vi.clearAllMocks()
  fixture.value = null
  fixture.bridge = undefined
  vi.stubGlobal('isSecureContext', true)
  vi.stubGlobal('showDirectoryPicker', fixture.picker)
})
afterEach(() => vi.unstubAllGlobals())

function directory() {
  const files = new Map<string, Blob>()
  const close = vi.fn(async () => {})
  const abort = vi.fn(async () => {})
  const queryPermission = vi.fn(async () => 'granted')
  const handle = {
    name: '我的图片', queryPermission,
    getFileHandle: vi.fn(async (name: string, options?: { create?: boolean }) => {
      if (!options?.create && !files.has(name)) throw new DOMException('不存在', 'NotFoundError')
      return { createWritable: async () => ({
        write: async (blob: Blob) => { files.set(name, blob) }, close, abort,
      }) }
    }),
  }
  return { handle, files, close, abort, queryPermission }
}

it('未开启使用原下载方式，选择目录后保存，关闭后恢复', async () => {
  const blob = new Blob(['图像'])
  await downloadFile(blob, '图.png')
  expect(fixture.saveAs).toHaveBeenCalledWith(blob, '图.png')
  const { handle, files } = directory()
  fixture.picker.mockResolvedValue(handle)
  await chooseDownloadLocation()
  expect(await getDownloadLocation()).toEqual({ enabled: true, directory: '我的图片' })
  await downloadFile(blob, '图.png')
  expect(files.get('图.png')).toBe(blob)
  expect(fixture.saveAs).toHaveBeenCalledTimes(1)
  await disableDownloadLocation()
  await downloadFile(blob, '图.png')
  expect(fixture.saveAs).toHaveBeenCalledTimes(2)
})

it('取消更换保留原目录，并发同名下载不覆盖', async () => {
  const { handle, files } = directory()
  fixture.value = { enabled: true, handle }
  fixture.picker.mockRejectedValue(new DOMException('取消', 'AbortError'))
  expect(await chooseDownloadLocation()).toBeNull()
  expect((await getDownloadLocation()).enabled).toBe(true)
  const old = new Blob(['旧文件'])
  files.set('图.png', old)
  await Promise.all([downloadFile(new Blob(['a']), '图.png'), downloadFile(new Blob(['b']), '图.png')])
  expect(files.size).toBe(3)
  expect(files.get('图.png')).toBe(old)
})

it('权限失效、磁盘写入失败均报错，不悄悄改用默认下载', async () => {
  const { handle, queryPermission, close, abort } = directory()
  fixture.value = { enabled: true, handle }
  queryPermission.mockResolvedValue('prompt')
  await expect(downloadFile(new Blob(['图']), '图.png')).rejects.toThrow('授权已失效')
  expect(handle.getFileHandle).not.toHaveBeenCalled()
  queryPermission.mockResolvedValue('granted')
  close.mockRejectedValueOnce(new Error('磁盘空间不足'))
  await expect(downloadFile(new Blob(['图']), '图.png')).rejects.toThrow('磁盘空间不足')
  expect(abort).toHaveBeenCalledOnce()
  expect(fixture.saveAs).not.toHaveBeenCalled()
})

it('桌面端传原始字节并等待保存结果，失败不能报成功', async () => {
  const save = vi.fn().mockResolvedValue(undefined)
  fixture.bridge = { downloads: { info: async () => ({ enabled: true }), save } }
  const blob = new Blob(['图像原文'])
  await downloadFile(blob, '../图.png')
  expect(save.mock.calls[0][0]).toBe('.._图.png')
  expect(new TextDecoder().decode(save.mock.calls[0][1])).toBe('图像原文')
  save.mockRejectedValueOnce(new Error('目录不可写'))
  await expect(downloadFile(blob, '图.png')).rejects.toThrow('目录不可写')
  expect(fixture.saveAs).not.toHaveBeenCalled()
})

it('不支持文件夹授权的浏览器仍能正常下载', async () => {
  vi.stubGlobal('showDirectoryPicker', undefined)
  await downloadFile(new Blob(['图']), '图.png')
  expect(fixture.saveAs).toHaveBeenCalledOnce()
})
