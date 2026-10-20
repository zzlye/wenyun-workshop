// @vitest-environment happy-dom
import { act, createRef } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { InfiniteCanvas } from './infinite-canvas'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
let root: ReturnType<typeof createRoot>
afterEach(async () => { await act(async () => root?.unmount()); vi.unstubAllGlobals() })

it.each(['pointerup', 'pointercancel', 'blur'])('%s 时尚未绘制的最后一帧必须提交，后续重绘不回跳', async event => {
  const host = document.createElement('div')
  root = createRoot(host)
  const frames = new Map<number, FrameRequestCallback>()
  let nextId = 0
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.set(++nextId, callback); return nextId })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id))
  const containerRef = createRef<HTMLDivElement>()
  const onChange = vi.fn()
  const viewport = { x: 10, y: 20, k: 1 }
  await act(async () => root.render(<InfiniteCanvas containerRef={containerRef} viewport={viewport} interactionMode="pan" onViewportChange={onChange}><span>节点</span></InfiniteCanvas>))
  containerRef.current!.setPointerCapture = vi.fn()
  await act(async () => containerRef.current!.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerId: 1, clientX: 100, clientY: 100 })))
  await act(async () => window.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, clientX: 180, clientY: 140 })))
  // 故意在动画帧执行之前松开，模拟低帧率客户端的真实事件顺序。
  await act(async () => window.dispatchEvent(new PointerEvent(event, { pointerId: 1, clientX: 180, clientY: 140 })))
  expect(onChange).toHaveBeenLastCalledWith({ x: 90, y: 60, k: 1 })
  expect(frames.size).toBe(0)
})
