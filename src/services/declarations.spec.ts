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

// 风控结果里的中长期敞口约束说明（ChenShi-Tech/dljy#3475）：只透出服务端 note，不在前端重算；
// 坏掉的症状 = 页面自己拼覆盖数字（与服务端口径漂移）或旧结果显示出空白说明。
import { riskExposureSourceOf, type RiskCheckResult } from './declarations'

describe('riskExposureSourceOf', () => {
  const base: RiskCheckResult = { checks: [], passed: false, gateLevel: 'L3', totalMwh: 0, maxMw: 0, evaluatedAt: '2026-09-29T00:00:00Z' }

  it('套保来源：原样返回服务端 note', () => {
    const note = '约束来源：套保服务（仅中长期口径，目标日 2026-10-01，生成于 2026-09-29T02:00:00Z）；已知 20/24 个时段，其余 4 个时段敞口未知（锁价分时未知 4），未施加约束'
    expect(riskExposureSourceOf({ ...base, inputs: { exposure: { available: true, note } } })).toEqual({ note, manual: false })
  })

  it('人工敞口：标注人工', () => {
    expect(riskExposureSourceOf({ ...base, inputs: { exposure: { manual: true, available: true } } }))
      .toEqual({ note: '人工填报的敞口，不回写套保结果', manual: true })
  })

  it('旧测算端点时代的结果、缺字段、空白 note → null（不显示）', () => {
    expect(riskExposureSourceOf({ ...base, inputs: { exposure: { available: true, hedgeRatio: 0.8, source: 'harness' } } })).toBeNull()
    expect(riskExposureSourceOf({ ...base, inputs: { exposure: { note: '   ' } } })).toBeNull()
    expect(riskExposureSourceOf({ ...base, inputs: {} })).toBeNull()
    expect(riskExposureSourceOf(null)).toBeNull()
    expect(riskExposureSourceOf(undefined)).toBeNull()
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

// ---------------------------------------------------------------------------
// 状态分组命名常量 + L3 双签提示（spot-trading-module-hygiene 收口）：
// 锚定成员与历史字面量逐一相同；双签文案与两处消费页历史文案一致。
import {
  EDITABLE_DRAFT_STATUSES,
  PRE_APPROVAL_STATUSES,
  secondSignatureNotice
} from './declarations'

describe('状态分组命名常量', () => {
  it('EDITABLE_DRAFT_STATUSES = 草稿/已风控检查/已驳回（可编辑草稿类）', () => {
    expect([...EDITABLE_DRAFT_STATUSES]).toEqual(['DRAFT', 'RISK_CHECKED', 'REJECTED'])
  })

  it('PRE_APPROVAL_STATUSES = 草稿/已风控检查/待审批（送审前候选）', () => {
    expect([...PRE_APPROVAL_STATUSES]).toEqual(['DRAFT', 'RISK_CHECKED', 'PENDING_APPROVAL'])
  })
})

describe('secondSignatureNotice', () => {
  it('双签第一签 → 提示等待第二位审批人，文案与历史一致', () => {
    expect(secondSignatureNotice({ awaitingSecondSignature: true })).toBe(
      'L3 双签：第一签已记录，需第二位审批人批准后本单才进入已审批'
    )
  })

  it('非双签场景 → null（调用方走普通成功提示）', () => {
    expect(secondSignatureNotice({})).toBeNull()
    expect(secondSignatureNotice({ awaitingSecondSignature: false })).toBeNull()
  })
})
