import { expect, it } from 'vitest'
import { logDatePreset } from './LogDateRangePicker'
import { defaultTaskLogFilters } from '../lib/newApiTaskLogs'

it('时间预设与原站周日周界限一致，正确处理跨月和闰年', () => {
  const now = new Date(2026, 9, 27, 18, 15)
  expect(logDatePreset('today', now)).toEqual({ startDate: '2026-10-27T00:00', endDate: '2026-10-27T23:59' })
  expect(logDatePreset('7d', now).startDate).toBe('2026-10-21T00:00')
  expect(logDatePreset('week', now)).toEqual({ startDate: '2026-10-25T00:00', endDate: '2026-10-31T23:59' })
  expect(logDatePreset('30d', now).startDate).toBe('2026-09-28T00:00')
  expect(logDatePreset('month', new Date(2024, 1, 12))).toEqual({ startDate: '2024-02-01T00:00', endDate: '2024-02-29T23:59' })
})

it('默认截止到当前后一小时，跨午夜不会丢掉今天的记录', () => {
  expect(defaultTaskLogFilters(new Date(2026, 9, 27, 23, 30))).toMatchObject({ startDate: '2026-10-27T00:00', endDate: '2026-10-28T00:30' })
})
