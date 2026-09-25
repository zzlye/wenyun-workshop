// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Select from './Select'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
let cleanup = () => {}
afterEach(() => cleanup())

async function render(native = false, disabled = false) {
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  const change = vi.fn()
  await act(async () => root.render(<Select value={1} options={[{ value: 1, label: '一个' }, { value: 2, label: '两个' }]} onChange={change} native={native} disabled={disabled} ariaLabel="数量" />))
  cleanup = () => { act(() => root.unmount()); host.remove() }
  return { host, change }
}

describe('手机原生选择器', () => {
  it('保留选项原类型，不把数字参数改成字符串', async () => {
    const { host, change } = await render(true)
    const select = host.querySelector('select')!
    expect(select.getAttribute('aria-label')).toBe('数量')
    await act(async () => { select.value = '2'; select.dispatchEvent(new Event('change', { bubbles: true })) })
    expect(change).toHaveBeenCalledWith(2)
  })

  it('禁用属性传递到系统控件', async () => {
    const { host } = await render(true, true)
    expect(host.querySelector('select')?.disabled).toBe(true)
  })

  it('未启用原生选项时保留原来的桌面菜单', async () => {
    const { host, change } = await render()
    expect(host.querySelector('select')).toBeNull()
    await act(async () => (host.querySelector('.cursor-pointer') as HTMLElement).click())
    await act(async () => (host.querySelector('[data-option-value="2"]') as HTMLElement).click())
    expect(change).toHaveBeenCalledWith(2)
  })
})
