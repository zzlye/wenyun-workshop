// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import GroupedModelSelect from './GroupedModelSelect'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
let host: HTMLDivElement, root: Root
beforeEach(() => {
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks() })

it.each([false, true])('普通Key无分组模型可直接选择，窄屏=%s', async compact => {
  vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: compact, addEventListener() {}, removeEventListener() {} } as unknown as MediaQueryList)
  const onChange = vi.fn()
  await act(async () => root.render(<GroupedModelSelect value="gpt-image-2" options={[
    { value: 'gpt-image-2', label: 'gpt-image-2' },
    { value: '官-gpt-image-2.5-flare', label: '官-gpt-image-2.5-flare' },
  ]} onChange={onChange} />))
  await act(async () => host.querySelector('button')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })))
  const items = [...document.querySelectorAll<HTMLElement>('[role="menuitemradio"]')]
  expect(items.map(item => item.textContent)).toEqual(['gpt-image-2', '官-gpt-image-2.5-flare'])
  expect(document.body.textContent).not.toContain('暂无可用模型')
  await act(async () => items[1].click())
  expect(onChange).toHaveBeenCalledWith('官-gpt-image-2.5-flare')
})
