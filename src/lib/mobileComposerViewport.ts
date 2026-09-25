type Viewport = { height: number; offsetTop: number; scale: number }

// 软键盘可能只缩小可视区域而不改变布局高度；捏合缩放不当作键盘遮挡。
export function getMobileComposerViewport(layoutHeight: number, viewport: Viewport | null, mobile: boolean) {
  if (!mobile || !viewport || Math.abs(viewport.scale - 1) > 0.01) {
    return { height: layoutHeight, topInset: 0, bottomInset: 0 }
  }
  const height = Math.max(0, Math.min(layoutHeight, viewport.height))
  const topInset = Math.max(0, Math.min(layoutHeight - height, viewport.offsetTop))
  return { height, topInset, bottomInset: Math.max(0, layoutHeight - height - topInset) }
}
