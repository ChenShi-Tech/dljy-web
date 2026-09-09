// @vitest-environment happy-dom
// isCurveEdited（申报曲线脏标记派生口径）：对比规则与保存链一致——
// 编辑器 96 点每点即一个 15min 时点、点电量 = MW/4（4 位舍入）。
// 坏掉的症状：加载/保存后误报「含未保存修改」、无修改也可点保存（服务端把
// RISK_CHECKED 打回 DRAFT、作废风控结果）；或真改了却不标脏。
// （happy-dom pragma：declarations.ts → api.ts → regionContext 模块级读 localStorage。）
import { describe, expect, it } from 'vitest'
import { isCurveEdited } from './declarations'

/** 模拟服务端保存链：客户端 round4 → 服务端 round2。 */
const savedFromPoints = (pointMw: number[]) =>
  pointMw.map((mw) => Math.round(Math.round((mw / 4) * 10000) / 10000 * 100) / 100)

describe('isCurveEdited', () => {
  it('编辑器值与保存曲线一致（保存后回读）→ 不标脏', () => {
    const points = Array.from({ length: 96 }, (_, i) => (i % 7) * 3 + 5)
    expect(isCurveEdited(points, savedFromPoints(points))).toBe(false)
  })

  it('任一时点被改动 → 标脏', () => {
    const points = Array.from({ length: 96 }, (_, i) => (i % 7) * 3 + 5)
    const saved = savedFromPoints(points)
    const edited = [...points]
    edited[59] = edited[59] + 2
    expect(isCurveEdited(edited, saved)).toBe(true)
  })

  it('同一小时 4 个 15min 点可各不相同（96 点直编）：只改其中一点也标脏', () => {
    const points = Array.from({ length: 96 }, () => 30)
    const saved = savedFromPoints(points)
    const edited = [...points]
    edited[65] = 40 // 16:15 与同小时其余三点不再恒等
    expect(isCurveEdited(edited, saved)).toBe(true)
  })

  it('saved 缺失或长度不足 96 → 视为已同步不标脏（首载未保存态不误报）', () => {
    expect(isCurveEdited(Array(96).fill(30), undefined)).toBe(false)
    expect(isCurveEdited(Array(96).fill(30), [7.5])).toBe(false)
  })

  it('舍入对齐：编辑器 33.32 保存后服务端 round2 回读为 33.32 → 不标脏；真改 33.33 → 标脏', () => {
    // syncPointsFromDeclaration 回读：8.33 × 4 = 33.32，与保存值同源 → 一致
    expect(isCurveEdited(Array(96).fill(33.32), Array(96).fill(8.33))).toBe(false)
    // 用户真实把功率改成 33.33：派生 8.3325 ≠ 保存值 8.33 → 标脏
    expect(isCurveEdited(Array(96).fill(33.33), Array(96).fill(8.33))).toBe(true)
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
import { editorMwOf, invalidPointIndexesOf } from './declarations'

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

describe('invalidPointIndexesOf', () => {
  it('只标记非法的时点，合法值（含数字串）不误报', () => {
    const points: Array<number | ''> = Array.from({ length: 96 }, () => 30)
    points[3] = ''
    points[70] = -5
    points[95] = 'abc' as unknown as number
    expect(invalidPointIndexesOf(points)).toEqual([3, 70, 95])
  })

  it('全部合法 → 空数组（保存门放行）', () => {
    expect(invalidPointIndexesOf(Array.from({ length: 96 }, (_, i) => i % 10))).toEqual([])
  })
})
