// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { DownloadLocationSetting } from './DownloadLocationSetting'

const fixture = vi.hoisted(() => ({ choose: vi.fn(), disable: vi.fn() }))
vi.mock('../lib/downloadLocation', () => ({
  supportsDownloadLocation: () => true,
  getDownloadLocation: async () => ({ enabled: false, directory: '' }),
  chooseDownloadLocation: fixture.choose,
  disableDownloadLocation: fixture.disable,
}))
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
afterEach(() => vi.clearAllMocks())

it('用户能开启、更改和关闭下载目录，取消选择不误开启', async () => {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  try {
    await act(async () => root.render(<DownloadLocationSetting />))
    const checkbox = () => host.querySelector<HTMLInputElement>('input[type="checkbox"]')!
    expect(checkbox().checked).toBe(false)
    expect(host.textContent).not.toMatch(/选开|可选|轮询/)
    fixture.choose.mockResolvedValueOnce(null)
    await act(async () => checkbox().click())
    expect(checkbox().checked).toBe(false)
    fixture.choose.mockResolvedValueOnce({ enabled: true, directory: 'D:\\图片' })
    await act(async () => checkbox().click())
    expect(checkbox().checked).toBe(true)
    expect(host.textContent).toContain('D:\\图片')
    fixture.choose.mockResolvedValueOnce({ enabled: true, directory: 'E:\\作品' })
    await act(async () => host.querySelector<HTMLButtonElement>('button')!.click())
    expect(host.textContent).toContain('E:\\作品')
    fixture.disable.mockResolvedValue({ enabled: false, directory: 'E:\\作品' })
    await act(async () => checkbox().click())
    expect(checkbox().checked).toBe(false)
    expect(host.querySelector('button')).toBeNull()
  } finally {
    await act(async () => root.unmount())
    host.remove()
  }
})
