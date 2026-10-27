import { useEffect, useRef, useState } from 'react'

export const LOG_REFRESH_COOLDOWN = 5000

export function useLogRefreshGuard(updatedAt: number, fetching: boolean) {
  const lastClaim = useRef(0)
  const [now, setNow] = useState(Date.now)
  const until = Math.max(updatedAt, lastClaim.current) + LOG_REFRESH_COOLDOWN
  const cooling = now < until
  useEffect(() => {
    const delay = until - Date.now()
    if (delay <= 0) { setNow(Date.now()); return }
    const timer = setTimeout(() => setNow(Date.now()), delay + 1)
    return () => clearTimeout(timer)
  }, [until])
  return {
    disabled: fetching || cooling,
    claim: () => {
      const time = Date.now()
      // 所有手动重读入口共用锁；同步锁防止同一帧连点绕过按钮禁用。
      if (fetching || time < Math.max(updatedAt, lastClaim.current) + LOG_REFRESH_COOLDOWN) return false
      lastClaim.current = time
      setNow(time)
      return true
    },
  }
}
