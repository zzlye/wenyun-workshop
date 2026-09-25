import { describe, expect, it } from 'vitest'
import { clearUrlSettingParams, hasUrlSettingParams } from './urlSettings'

describe('清理已停用的配置链接', () => {
  it('清除配置、接口和密钥参数，保留其他页面参数', () => {
    const params = new URLSearchParams('apiKey=old-key&apiUrl=https://old.example/v1&settings={}&model=old&apiMode=responses&apiFormat=auto&codexCli=true&streamImages=true&streamPartialImages=2&project=abc')
    expect(hasUrlSettingParams(params)).toBe(true)
    clearUrlSettingParams(params)
    expect(params.toString()).toBe('project=abc')
    expect(hasUrlSettingParams(params)).toBe(false)
  })
  it('普通链接保持不变', () => {
    const params = new URLSearchParams('project=abc')
    expect(hasUrlSettingParams(params)).toBe(false)
    clearUrlSettingParams(params)
    expect(params.toString()).toBe('project=abc')
  })
})
