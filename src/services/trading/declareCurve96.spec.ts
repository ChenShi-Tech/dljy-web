// declareCurve96 纯函数单测（merge-declare-desk-into-s4 任务 2.1）：
// 锁定 96 点换算与两套时点口径，编辑器抽取后行为与申报台原实现等价。
import { describe, expect, it } from 'vitest'
import {
  CURVE_POINT_COUNT,
  buildCurveCsv,
  buildCurveDetail96,
  curvePointLabel,
  energy96ToMw96,
  mw96ToEnergy96,
  pointStartLabel
} from './declareCurve96'

describe('pointStartLabel（时段起点口径）', () => {
  it('0→00:00，95→23:45，每 4 点一小时', () => {
    expect(pointStartLabel(0)).toBe('00:00')
    expect(pointStartLabel(1)).toBe('00:15')
    expect(pointStartLabel(4)).toBe('01:00')
    expect(pointStartLabel(95)).toBe('23:45')
  })
  it('非法下标返回 —；空串按 Number(空串)===0 口径（与申报台原实现等价）', () => {
    expect(pointStartLabel(-1)).toBe('—')
    expect(pointStartLabel(96)).toBe('—')
    expect(pointStartLabel(undefined)).toBe('—')
    // 原实现 Number('') === 0 → '00:00'；编辑器批量段输入清空时保持该口径，不另造分支
    expect(pointStartLabel('')).toBe('00:00')
  })
})

describe('curvePointLabel（时段段末口径）', () => {
  it('0→00:15，3→01:00，95→24:00', () => {
    expect(curvePointLabel(0)).toBe('00:15')
    expect(curvePointLabel(3)).toBe('01:00')
    expect(curvePointLabel(95)).toBe('24:00')
  })
})

describe('MW ⇄ MWh 换算（MWh/点 = MW/4）', () => {
  it('energy96ToMw96：MWh×4，2 位舍入；缺点按 0', () => {
    const mw = energy96ToMw96([2.5, 0.0125])
    expect(mw[0]).toBe(10)
    expect(mw[1]).toBe(0.05)
    expect(mw).toHaveLength(CURVE_POINT_COUNT)
    expect(mw[95]).toBe(0)
  })
  it('mw96ToEnergy96：MW/4，4 位舍入', () => {
    const energy = mw96ToEnergy96([10, 0.05])
    expect(energy[0]).toBe(2.5)
    expect(energy[1]).toBe(0.0125)
    expect(energy).toHaveLength(CURVE_POINT_COUNT)
  })
  it('往返换算恒等（编辑器保存链与回显一致）', () => {
    const energy = Array.from({ length: CURVE_POINT_COUNT }, (_, i) => i / 4)
    expect(mw96ToEnergy96(energy96ToMw96(energy).map((v) => (v === '' ? 0 : v)))).toEqual(energy)
  })
})

describe('buildCurveDetail96', () => {
  it('只读态（editing=null）按已保存曲线取值', () => {
    const rows = buildCurveDetail96(Array.from({ length: 96 }, () => 2.5), null)
    expect(rows).toHaveLength(96)
    expect(rows[0]).toEqual({ label: '00:15', mw: '10.00', mwh: '2.5000' })
  })
  it('编辑态以编辑器实时值为准', () => {
    const rows = buildCurveDetail96(Array.from({ length: 96 }, () => 0), [8, ...Array.from({ length: 95 }, () => 0)])
    expect(rows[0]!.mw).toBe('8.00')
    expect(rows[0]!.mwh).toBe('2.0000')
  })
})

describe('buildCurveCsv', () => {
  it('表头/明细/合计行结构与申报台原导出一致', () => {
    const csv = buildCurveCsv(buildCurveDetail96(Array.from({ length: 96 }, () => 2.5), null), 240)
    const lines = csv.split('\n')
    expect(lines[0]).toBe('时点,功率(MW),电量(MWh)')
    expect(lines[1]).toBe('00:15,10.00,2.5000')
    expect(lines[97]).toBe('合计(96点),,240')
  })
})
