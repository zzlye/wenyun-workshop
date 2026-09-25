import { HOME_STREAMER_BACKGROUND_PATH } from '../lib/homeBackground'
import { Checkbox } from './Checkbox'

type Props = { enabled: boolean; onChange: (enabled: boolean) => void }

export default function HomeStreamerSetting({ enabled, onChange }: Props) {
  return (
    <section className="rounded-2xl border border-gray-200/70 bg-white/60 p-4 dark:border-white/[0.08] dark:bg-white/[0.03]">
      <Checkbox checked={enabled} onChange={onChange} label="主播模式" />
      <p className="mt-2 text-xs leading-6 text-gray-500 dark:text-gray-400">主页固定显示预设图片，不影响工坊背景。</p>
      {enabled && (
        <a href={HOME_STREAMER_BACKGROUND_PATH} target="_blank" rel="noopener noreferrer" className="mt-3 block overflow-hidden rounded-xl" aria-label="查看主播模式背景原图">
          <img src={HOME_STREAMER_BACKGROUND_PATH} alt="主播模式主页背景" className="aspect-video w-full object-cover" />
        </a>
      )}
    </section>
  )
}
