import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'

it('日志原生控件同时声明亮暗配色和选项底色，避免系统弹层白底浅字', () => {
  const css = readFileSync(new URL('../index.css', import.meta.url), 'utf8')
  const modal = readFileSync(new URL('./UsageLogsModal.tsx', import.meta.url), 'utf8')
  expect(modal).toMatch(/className="account-logs [^"]*flex/)
  const block = (selector: string) => css.slice(css.indexOf(selector)).split('}')[0]
  expect(block('.account-logs select,')).toContain('color-scheme: light;')
  expect(block('.dark .account-logs select,')).toContain('color-scheme: dark;')
  expect(block('.account-logs option,')).toContain('background-color: #ffffff;')
  expect(block('.account-logs option,')).toContain('color: #27272a;')
  expect(block('.dark .account-logs option,')).toContain('background-color: #27272a;')
  expect(block('.dark .account-logs option,')).toContain('color: #f4f4f5;')
})
