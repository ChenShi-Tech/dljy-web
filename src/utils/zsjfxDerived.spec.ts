// 衍生线纯函数单测（Epic #3591 S2 / dljy#3594，ZW-05）：空值传播、分母零保护、差值口径。
import { describe, expect, it } from 'vitest'
import { computeDerivedSeries, derivedName } from './zsjfxDerived'

const flat = (v: number | null) => new Array<number | null>(96).fill(v)

describe('computeDerivedSeries（ZW-05 纪律）', () => {
  const a = flat(100).map((v, i) => (i === 5 ? null : v))
  const b = flat(80).map((v, i) => (i === 5 ? null : i === 10 ? 0 : v))

  it('差值：逐点 a−b，任一侧空值传播为空（不补零）', () => {
    const d = computeDerivedSeries({ kind: 'diff', a: 'A', b: 'B' }, a, b)
    expect(d.points[0]).toBe(20)
    expect(d.points[5]).toBe(null) // A 侧空值 → 传播为空
    expect(d.points[10]).toBe(100) // B 侧真实零参与差值：100−0
    expect(d.nullPropagated).toBe(1)
  })

  it('比值：分母为零的时段置空并计数，不产出极大值', () => {
    const d = computeDerivedSeries({ kind: 'ratio', a: 'A', b: 'B' }, a, b)
    expect(d.points[0]).toBe(1.25)
    expect(d.points[10]).toBe(null) // 分母=0 → 置空
    expect(d.excludedZeroDenominator).toBe(1)
  })

  it('覆盖率：实际(B)÷预测(A)，分母为预测侧', () => {
    const d = computeDerivedSeries({ kind: 'coverage', a: '预测', b: '实际' }, flat(100), flat(95))
    expect(d.points[0]).toBe(95)
  })

  it('缺曲线（undefined）按全空处理', () => {
    const d = computeDerivedSeries({ kind: 'diff', a: 'A', b: 'B' }, undefined, undefined)
    expect(d.points.every((v) => v === null)).toBe(true)
    expect(d.nullPropagated).toBe(96)
  })

  it('derivedName 含运算语义且可作移除键', () => {
    const spec = { kind: 'diff' as const, a: '日前价出清', b: '实时价出清' }
    expect(derivedName(spec)).toBe('日前价出清 − 实时价出清')
  })
})
