import { describe, expect, it } from 'vitest'
import { getMobileComposerViewport } from './mobileComposerViewport'

describe('文运手机输入区可视范围', () => {
  it('键盘只压缩可视区域时把输入区抬到键盘上方', () => {
    expect(getMobileComposerViewport(844, { height: 480, offsetTop: 0, scale: 1 }, true)).toEqual({ height: 480, topInset: 0, bottomInset: 364 })
  })
  it('浏览器已向上平移页面时不重复计算遮挡', () => {
    expect(getMobileComposerViewport(844, { height: 480, offsetTop: 120, scale: 1 }, true)).toEqual({ height: 480, topInset: 120, bottomInset: 244 })
  })
  it('浏览器直接缩小布局高度时不额外抬高', () => {
    expect(getMobileComposerViewport(480, { height: 480, offsetTop: 0, scale: 1 }, true)).toEqual({ height: 480, topInset: 0, bottomInset: 0 })
  })
  it('桌面、缺少可视区域接口和捏合缩放都使用原布局', () => {
    for (const [viewport, mobile] of [[null, true], [{ height: 400, offsetTop: 20, scale: 2 }, true], [{ height: 400, offsetTop: 0, scale: 1 }, false]] as const) {
      expect(getMobileComposerViewport(844, viewport, mobile)).toEqual({ height: 844, topInset: 0, bottomInset: 0 })
    }
  })
  it('旋转与键盘收起后恢复完整高度', () => {
    expect(getMobileComposerViewport(390, { height: 390, offsetTop: 0, scale: 1 }, true)).toEqual({ height: 390, topInset: 0, bottomInset: 0 })
  })
  it('限制弹性滚动产生的越界偏移', () => {
    expect(getMobileComposerViewport(844, { height: 900, offsetTop: -20, scale: 1 }, true)).toEqual({ height: 844, topInset: 0, bottomInset: 0 })
  })
})
