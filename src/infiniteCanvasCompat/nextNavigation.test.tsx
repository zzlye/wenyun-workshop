// @vitest-environment happy-dom
import { act, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { CanvasNavigationProvider, useRouter } from './nextNavigation'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
let root: ReturnType<typeof createRoot>
afterEach(async () => { await act(async () => root?.unmount()) })

it('公告和账号更新不重新恢复当前画布，导航始终调用最新回调', async () => {
  const host = document.createElement('div')
  root = createRoot(host)
  const restore = vi.fn()
  const oldNavigate = vi.fn()
  const newNavigate = vi.fn()
  function Project() {
    const router = useRouter()
    const [position, setPosition] = useState(10)
    useEffect(() => { restore(); setPosition(10) }, [router.replace])
    return <><button onClick={() => setPosition(300)}>平移</button><button onClick={() => router.push('/canvas/next')}>切换</button><output>{position}</output></>
  }
  const render = (navigate = oldNavigate, appearanceTheme: 'light' | 'dark' = 'light') => root.render(
    <CanvasNavigationProvider value={{ pathname: '/canvas/current', params: { id: 'current' }, navigate, backToHome: () => {}, openHome: () => {}, openWenyun: () => {}, openSettings: () => {}, appearanceTheme, setAppearanceTheme: () => {} }}><Project /></CanvasNavigationProvider>,
  )
  await act(async () => render())
  await act(async () => host.querySelector('button')!.click())
  await act(async () => render(newNavigate, 'dark'))
  expect(restore).toHaveBeenCalledTimes(1)
  expect(host.querySelector('output')?.textContent).toBe('300')
  await act(async () => host.querySelectorAll('button')[1].click())
  expect(newNavigate).toHaveBeenCalledWith('/canvas/next')
  expect(oldNavigate).not.toHaveBeenCalled()
})
