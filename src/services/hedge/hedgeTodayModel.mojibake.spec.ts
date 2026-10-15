// 敞口数据腿来源文本防乱码（dljy#3731 缺陷⑤ · spot-page-correctness delta
// 「敞口来源文本正确解码呈现」）：legRowsOf 归一化时对 label/reason/note 做
// 可读化——乱码呈现占位、原文挂 *MojibakeRaw；正常文本直通。
import { describe, expect, it } from 'vitest'
import { legRowsOf, todayOverviewOf } from './hedgeTodayModel'

// 「云电交易日报」的 UTF-8 字节按 GBK 误读产物（Node GBK 解码器构造的真实形态）。
const MISREAD_LABEL = '浜戠數浜ゆ槗鏃ユ姤'
const MISREAD_REASON = '涓婃父缃戝彛瓒呮椂'

function overviewWithLegs(rows: unknown[]) {
  return todayOverviewOf({ legs: { rows } })
}

describe('legRowsOf 来源文本防乱码（缺陷⑤）', () => {
  it('乱码 label/reason 呈现占位并保留原文', () => {
    const rows = legRowsOf(
      overviewWithLegs([{ key: 'FORECAST_VENDOR', label: MISREAD_LABEL, reason: MISREAD_REASON, status: 'FAILED' }])
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].label).toBe('来源解析失败')
    expect(rows[0].labelMojibakeRaw).toBe(MISREAD_LABEL)
    expect(rows[0].reason).toBe('来源解析失败')
    expect(rows[0].reasonMojibakeRaw).toBe(MISREAD_REASON)
  })

  it('正常文本直通、无 raw 残留', () => {
    const rows = legRowsOf(
      overviewWithLegs([{ key: 'PLANT_OUTPUT', label: '厂站出力（实际）', note: '数据截至 15 分钟前', status: 'OK' }])
    )
    expect(rows[0].label).toBe('厂站出力（实际）')
    expect(rows[0].labelMojibakeRaw).toBeNull()
    expect(rows[0].note).toBe('数据截至 15 分钟前')
    expect(rows[0].noteMojibakeRaw).toBeNull()
  })

  it('缺 label 回退 key（既有行为不回归）', () => {
    const rows = legRowsOf(overviewWithLegs([{ key: 'LEGACY', status: 'OK' }]))
    expect(rows[0].label).toBe('LEGACY')
    expect(rows[0].labelMojibakeRaw).toBeNull()
  })
})
