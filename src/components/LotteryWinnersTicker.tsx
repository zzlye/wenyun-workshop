import { useState } from 'react'
import { Pause, Play } from 'lucide-react'
import type { LotteryWinner } from '../lib/newApiLottery'
import './lottery-winners-ticker.css'

export default function LotteryWinnersTicker({
  winners,
  formatQuota,
}: {
  winners: LotteryWinner[]
  formatQuota: (quota: number) => string
}) {
  const [paused, setPaused] = useState(false)
  return (
    <div className="flex min-w-0 items-center gap-2 rounded-xl bg-slate-50 px-3 py-2 dark:bg-white/5">
      <div className="wenyun-lottery-ticker" data-paused={paused} tabIndex={0} aria-label="中奖名单">
        <div
          className="wenyun-lottery-ticker-track"
          style={{ animationDuration: `${Math.max(24, winners.length * 5)}s` }}
        >
          {/* 两份等宽名单衔接成无缝循环，辅助阅读只读取第一份真实记录。 */}
          {[0, 1].map((copy) => (
            <ul key={copy} aria-hidden={copy === 1 ? true : undefined} className="wenyun-lottery-ticker-list">
              {winners.map((winner) => (
                <li key={winner.id} className="flex shrink-0 items-center gap-2 whitespace-nowrap text-xs">
                  <span className="text-slate-400">{winner.username}</span>
                  <span className="font-medium tabular-nums text-blue-500">+{formatQuota(winner.quota)}</span>
                </li>
              ))}
            </ul>
          ))}
        </div>
      </div>
      <button
        type="button"
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-slate-400 transition hover:bg-slate-200/60 hover:text-blue-500 dark:hover:bg-white/10"
        aria-label={paused ? '继续滚动' : '暂停滚动'}
        title={paused ? '继续滚动' : '暂停滚动'}
        aria-pressed={paused}
        onClick={() => setPaused((value) => !value)}
      >
        {paused ? <Play size={14} aria-hidden /> : <Pause size={14} aria-hidden />}
      </button>
    </div>
  )
}
