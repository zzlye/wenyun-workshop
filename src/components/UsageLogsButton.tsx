import { lazy, Suspense, useCallback, useState, type CSSProperties } from 'react'
import { ScrollText } from 'lucide-react'
import { useStore } from '../store'
import { LOCKED_WENYUN_PROFILE_ID, normalizeSettings } from '../lib/apiProfiles'

const UsageLogsModal = lazy(() => import('./UsageLogsModal'))

export default function UsageLogsButton({ onRequireLogin, className, style }: {
  onRequireLogin: () => void
  className?: string
  style?: CSSProperties
}) {
  const [open, setOpen] = useState(false)
  const settings = useStore(state => state.settings)
  const session = settings.newApiAccountSessions[LOCKED_WENYUN_PROFILE_ID]
  const profile = normalizeSettings(settings).profiles.find(item => item.id === LOCKED_WENYUN_PROFILE_ID)!
  const close = useCallback(() => setOpen(false), [])
  const login = useCallback(() => { setOpen(false); onRequireLogin() }, [onRequireLogin])
  return <>
    <button type="button" aria-label="使用日志" className={`inline-flex shrink-0 items-center justify-center gap-1 ${className || ''}`} style={style} onClick={() => session ? setOpen(true) : onRequireLogin()}>
      <ScrollText size={13} aria-hidden />日志
    </button>
    {open && session && <Suspense fallback={null}>
      <UsageLogsModal
        key={`${profile.baseUrl}:${session.userId ?? session.username}:${session.authSessionId ?? session.accessToken}`}
        profile={profile} session={session} onClose={close} onRequireLogin={login}
      />
    </Suspense>}
  </>
}
