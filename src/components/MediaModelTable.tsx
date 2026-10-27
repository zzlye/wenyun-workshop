import { groupMediaModels, type ModelOption } from '../lib/mediaModels'
import { getImageSizeTiersForModel } from '../lib/modelPricing'
import type { NewApiModelPerformanceItem } from '../lib/newApi'

export default function MediaModelTable({ options, video, loading, error, warning, metadataReady, metrics = [] }: {
  options: ModelOption[]; video?: boolean; loading: boolean; error?: string; warning?: string; metadataReady: boolean; metrics?: NewApiModelPerformanceItem[]
}) {
  // 普通 Key 只返回模型时展示平铺表格，不把公开分组或账号倍率强行套上去。
  const ungrouped = options.filter(model => !model.group)
  const groups = [...groupMediaModels(options), ...(ungrouped.length ? [{ label: '', models: ungrouped, ratio: undefined, description: undefined }] : [])]
  return <div className="space-y-4" aria-busy={loading}>
    {error && <div role="alert" className="rounded-xl bg-amber-50 p-3 text-sm text-amber-700 dark:bg-amber-500/10 dark:text-amber-200">{options.length ? '刷新失败，当前显示上次成功获取的数据。' + error : error}</div>}
    {warning && !error && <div role="status" className="rounded-xl bg-amber-50 p-3 text-sm text-amber-700 dark:bg-amber-500/10 dark:text-amber-200">{warning}</div>}
    {groups.map(group => <section key={group.label} className="overflow-hidden rounded-xl border border-gray-200/70 dark:border-white/[0.08]">
      {group.label && <h3 className="flex items-center justify-between gap-4 bg-gray-50 px-4 py-3 text-sm font-semibold dark:bg-white/[0.04]">
        <span className="min-w-0 flex-1"><span>{group.label}</span>{group.description && <span className="mt-1 block whitespace-pre-wrap break-words text-xs font-normal text-gray-500 dark:text-gray-400">{group.description}</span>}</span>{group.ratio !== undefined && <span className="text-xs font-normal text-gray-500">{group.ratio} 倍</span>}
      </h3>}
      <div role="table" aria-label={`${group.label}模型列表`}>
        <div role="row" className="hidden grid-cols-[minmax(0,1fr)_100px_minmax(0,1.8fr)_80px] gap-4 px-4 py-2 text-xs text-gray-400 sm:grid">
          {['模型', video ? '简介' : '分辨率', '计费', '成功率'].map(label => <span role="columnheader" key={label}>{label}</span>)}
        </div>
        {group.models.map(model => {
          const rate = metrics.find(item => item.model.toLowerCase() === model.value.toLowerCase())?.successRate
          return <div key={model.value} role="row" className="grid gap-3 border-t border-gray-100 px-4 py-3 text-sm dark:border-white/[0.06] sm:grid-cols-[minmax(0,1fr)_100px_minmax(0,1.8fr)_80px]">
            <div role="cell" className="min-w-0 break-all font-medium">{model.label}{!video && model.description && <p className="mt-1 whitespace-pre-wrap break-words text-xs font-normal text-gray-500 dark:text-gray-400">{model.description}</p>}</div>
            <div role="cell" className="text-xs text-gray-500">{video ? model.description || '—' : getImageSizeTiersForModel(model.value).join('、') || '自动'}</div>
            <div role="cell" className="min-w-0">
              <div>{model.billing?.summary ?? (loading ? '正在获取价格…' : '暂无价格')}</div>
              {model.billing?.lines.map(line => <div key={line.label} className="mt-1 flex flex-wrap justify-between gap-x-2 text-xs text-gray-500 dark:text-gray-400">
                <span>{line.label}</span><span>{line.text}</span>
              </div>)}
            </div>
            <div role="cell" className="text-xs text-gray-500">{typeof rate === 'number' && Number.isFinite(rate) ? `${rate.toFixed(2)}%` : '暂无数据'}</div>
          </div>
        })}
      </div>
    </section>)}
    {!options.length && !error && <div role="status" className="py-10 text-center text-sm text-gray-500">{loading ? '正在获取模型…' : metadataReady ? '暂无可用模型' : '登录或填写 Key 后查看模型'}</div>}
  </div>
}
