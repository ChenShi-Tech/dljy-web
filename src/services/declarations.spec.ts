// @vitest-environment happy-dom
// isCurveEdited（申报曲线脏标记派生口径）：对比规则与保存链一致——
// 编辑器 24 点每小时 4 个恒等 15min 点、点电量 = MW/4（4 位舍入）。
// 坏掉的症状：加载/保存后误报「含未保存修改」、无修改也可点保存（服务端把
// RISK_CHECKED 打回 DRAFT、作废风控结果）；或真改了却不标脏。
// （happy-dom pragma：declarations.ts → api.ts → regionContext 模块级读 localStorage。）
import { describe, expect, it } from 'vitest'
import { isCurveEdited } from './declarations'

/** 模拟服务端保存链：客户端 round4 → 服务端 round2。 */
const savedFromHourly = (hourly: number[]) =>
  hourly.flatMap((mw) => Array.from({ length: 4 }, () => Math.round(Math.round((mw / 4) * 10000) / 10000 * 100) / 100))

describe('isCurveEdited', () => {
  it('编辑器值与保存曲线一致（保存后回读）→ 不标脏', () => {
    const hourly = Array.from({ length: 24 }, (_, h) => (h % 5) * 3 + 5)
    expect(isCurveEdited(hourly, savedFromHourly(hourly))).toBe(false)
  })

  it('任一小时被改动 → 标脏', () => {
    const hourly = Array.from({ length: 24 }, (_, h) => (h % 5) * 3 + 5)
    const saved = savedFromHourly(hourly)
    const edited = [...hourly]
    edited[14] = edited[14] + 2
    expect(isCurveEdited(edited, saved)).toBe(true)
  })

  it('saved 缺失或长度不足 96 → 视为已同步不标脏（首载未保存态不误报）', () => {
    expect(isCurveEdited([30], undefined)).toBe(false)
    expect(isCurveEdited([30], [7.5])).toBe(false)
  })

  it('舍入对齐：编辑器 33.33 保存后服务端 round2 回读为 33.32 → 不标脏；真改 33.33 → 标脏', () => {
    // syncHourlyFromDeclaration 回读：8.33 × 4 = 33.32，派生 8.33 与保存值同源 → 一致
    expect(isCurveEdited(Array(24).fill(33.32), Array(96).fill(8.33))).toBe(false)
    // 用户真实把功率改成 33.33：派生 8.3325 ≠ 保存值 8.33 → 标脏
    expect(isCurveEdited(Array(24).fill(33.33), Array(96).fill(8.33))).toBe(true)
  })
})

// 风控/敞口入参归一：输入框清空/误输不向服务端发垃圾值，兜底 1 MWh；正常值原样透传。
// 人工不可见（服务端本就优雅拒绝），故以单测锁定归一口径。
import { normalizeExposureTotalMwh } from './declarations'

describe('normalizeExposureTotalMwh', () => {
  it('清空/非数/0/负数 → 兜底 1 MWh', () => {
    for (const bad of ['', 'abc', 0, -5, Number.NaN, null, undefined]) {
      expect(normalizeExposureTotalMwh(bad)).toBe(1)
    }
  })

  it('正常正数原样透传（含小数）', () => {
    expect(normalizeExposureTotalMwh(20000)).toBe(20000)
    expect(normalizeExposureTotalMwh(12.5)).toBe(12.5)
    expect(normalizeExposureTotalMwh('3000')).toBe(3000)
  })
})

// 曲线编辑器输入归一（工作台审查 P2）：清空/半输入态（v-model.number 得 ''）、非数与
// 负数必须是「可见的非法」（禁用保存+明示），而不是 ''/4=0 静默归零、'' 参与求和退化成
// 字符串拼接把总量显示成拼接数字。
import { editorMwOf, invalidHourIndexesOf } from './declarations'

describe('editorMwOf', () => {
  it('合法数值（含小数、数字串）原样透传', () => {
    expect(editorMwOf(30)).toBe(30)
    expect(editorMwOf(12.5)).toBe(12.5)
    expect(editorMwOf('45')).toBe(45)
    expect(editorMwOf(0)).toBe(0)
  })

  it('未填/非数/负数 → NaN（非法，由保存门拦截）', () => {
    for (const bad of ['', ' ', 'abc', -1, Number.NaN, null, undefined]) {
      expect(Number.isNaN(editorMwOf(bad))).toBe(true)
    }
  })
})

describe('invalidHourIndexesOf', () => {
  it('只标记非法的小时，合法值（含数字串）不误报', () => {
    const hourly: Array<number | ''> = Array.from({ length: 24 }, () => 30)
    hourly[3] = ''
    hourly[7] = -5
    hourly[11] = 'abc' as unknown as number
    expect(invalidHourIndexesOf(hourly)).toEqual([3, 7, 11])
  })

  it('全部合法 → 空数组（保存门放行）', () => {
    expect(invalidHourIndexesOf(Array.from({ length: 24 }, (_, h) => h))).toEqual([])
  })
})
