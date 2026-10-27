import { useEffect, useId, useState } from 'react'
import { DropdownMenu } from 'radix-ui'
import { Check, ChevronDown, ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react'
import { groupMediaModels, type ModelOption } from '../lib/mediaModels'

type Props = {
  value: string
  options: ModelOption[]
  onChange: (model: string) => void
  className?: string
  loading?: boolean
  error?: string
  emptyText?: string
  onRefresh?: () => Promise<unknown> | void
  updatedAt?: number
}

const panelClass = 'z-[1600] min-w-40 max-w-[calc(100vw-24px)] overflow-y-auto rounded-xl border border-gray-200 bg-white p-1 text-xs text-gray-800 shadow-xl dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100'
const itemClass = 'flex cursor-pointer select-none items-center gap-3 rounded-lg px-3 py-2 outline-none data-[highlighted]:bg-gray-100 dark:data-[highlighted]:bg-gray-800'

export default function GroupedModelSelect({ value, options, onChange, className, loading, error, onRefresh, updatedAt = 0, emptyText = '暂无可用模型' }: Props) {
  const [open, setOpen] = useState(false)
  const [compact, setCompact] = useState(false)
  const [activeCategory, setActiveCategory] = useState<string | null>(null)
  const id = useId()
  const categories = groupMediaModels(options)
  const title = options.find(item => item.value === value)?.label || value || '选择模型'
  const currentCategory = categories.find(category => category.label === activeCategory)
  useEffect(() => {
    const screen = window.matchMedia('(max-width: 639px)')
    const update = () => setCompact(screen.matches)
    update()
    screen.addEventListener('change', update)
    return () => screen.removeEventListener('change', update)
  }, [])
  useEffect(() => {
    const close = (event: Event) => { if ((event as CustomEvent<string>).detail !== id) { setOpen(false); setActiveCategory(null) } }
    window.addEventListener('model-picker-open', close)
    return () => window.removeEventListener('model-picker-open', close)
  }, [id])
  const renderModels = (models: ModelOption[]) => <DropdownMenu.RadioGroup value={value} onValueChange={onChange}>
    {models.map(model => <DropdownMenu.RadioItem key={model.value} value={model.value} textValue={model.label} className={itemClass}>
      <span className="min-w-0 flex-1 break-words">{model.label}{model.description && <span className="mt-1 block max-w-72 whitespace-pre-wrap text-[11px] text-gray-500 dark:text-gray-400">{model.description}</span>}</span>
      <span className="w-3 shrink-0"><DropdownMenu.ItemIndicator><Check size={12} /></DropdownMenu.ItemIndicator></span>
    </DropdownMenu.RadioItem>)}
  </DropdownMenu.RadioGroup>
  // Portal 避免画布缩放和浮层裁切；Radix 负责悬停、触屏点击与方向键展开。
  return <DropdownMenu.Root modal={false} open={open} onOpenChange={next => {
    if (next) {
      window.dispatchEvent(new CustomEvent('model-picker-open', { detail: id }))
      // 重新展开过期目录才刷新，避免后台配置变化后长期开着画布仍只看到旧分组。
      if (!loading && onRefresh && Date.now() - updatedAt >= 60000) void onRefresh()
    }
    else setActiveCategory(null)
    setOpen(next)
  }}>
    <DropdownMenu.Trigger asChild>
      <button type="button" aria-label="模型" title={title} className={`flex min-w-0 items-center justify-between gap-2 ${className ?? ''}`}
        onPointerDown={event => event.stopPropagation()} onMouseDown={event => event.stopPropagation()}>
        <span className="min-w-0 flex-1 truncate text-left">{title}</span><ChevronDown size={13} className="shrink-0" />
      </button>
    </DropdownMenu.Trigger>
    <DropdownMenu.Portal>
      <DropdownMenu.Content data-canvas-no-zoom className={`${panelClass} ${compact ? 'w-80' : ''}`} sideOffset={6} align="start" collisionPadding={12}
        style={{ maxHeight: 'min(28rem, var(--radix-dropdown-menu-content-available-height))' }}
        onPointerDown={event => event.stopPropagation()} onMouseDown={event => event.stopPropagation()} onWheel={event => event.stopPropagation()}>
        {error && <div role="alert" className="max-w-72 px-3 py-2 text-red-500">{error}</div>}
        {!categories.length ? <div className="px-3 py-2 text-gray-500">{loading ? '正在获取模型…' : emptyText}</div>
          : compact ? currentCategory ? <>
            {/* 窄屏在同一个浮层内逐级选择，避免侧边子菜单超出屏幕。 */}
            <DropdownMenu.Item className={itemClass} onSelect={event => { event.preventDefault(); setActiveCategory(null) }}>
              <ChevronLeft size={13} /><span>返回分类</span>
            </DropdownMenu.Item>
            <DropdownMenu.Separator className="my-1 h-px bg-gray-100 dark:bg-gray-700" />
            {renderModels(currentCategory.models)}
          </> : categories.map(category => <DropdownMenu.Item key={category.label} className={itemClass}
            onSelect={event => { event.preventDefault(); setActiveCategory(category.label) }}>
            <span className="min-w-0 flex-1">{category.label}{category.description && <span className="mt-1 block max-w-64 whitespace-pre-wrap break-words text-[11px] text-gray-500 dark:text-gray-400">{category.description}</span>}</span>{category.ratio !== undefined && <span className="text-xs text-gray-500">{category.ratio} 倍</span>}<ChevronRight size={13} />
          </DropdownMenu.Item>) : categories.map(category => <DropdownMenu.Sub key={category.label}>
            <DropdownMenu.SubTrigger className={itemClass}>
              <span className="min-w-0 flex-1">{category.label}{category.description && <span className="mt-1 block max-w-64 whitespace-pre-wrap break-words text-[11px] text-gray-500 dark:text-gray-400">{category.description}</span>}</span>{category.ratio !== undefined && <span className="text-xs text-gray-500">{category.ratio} 倍</span>}<ChevronRight size={13} />
            </DropdownMenu.SubTrigger>
            <DropdownMenu.Portal>
              <DropdownMenu.SubContent data-canvas-no-zoom className={`${panelClass} max-w-[min(22rem,calc(100vw-24px))]`} sideOffset={2} collisionPadding={12}
                style={{ maxHeight: 'min(28rem, var(--radix-dropdown-menu-content-available-height))' }}
                onPointerDown={event => event.stopPropagation()} onMouseDown={event => event.stopPropagation()} onWheel={event => event.stopPropagation()}>
                {renderModels(category.models)}
              </DropdownMenu.SubContent>
            </DropdownMenu.Portal>
          </DropdownMenu.Sub>)}
        {onRefresh && <><DropdownMenu.Separator className="my-1 h-px bg-gray-100 dark:bg-gray-700" /><DropdownMenu.Item disabled={loading} className={`${itemClass} text-gray-500`} onSelect={event => { event.preventDefault(); void onRefresh() }}><RefreshCw size={12} className={loading ? 'animate-spin' : ''} />{loading ? '正在刷新…' : '刷新分组'}</DropdownMenu.Item></>}
      </DropdownMenu.Content>
    </DropdownMenu.Portal>
  </DropdownMenu.Root>
}
