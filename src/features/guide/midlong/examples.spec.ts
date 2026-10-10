// 「合同入门」导引示例值（examples）的口径不变量（ChenShi-Tech/dljy#3404）。
// 守什么：所有日期按北京时间计算（跨零点 / 跨年不漂移）；运行标签与 409 重试后缀的
// 形状与「属于本次运行」判定一致；月度分解合计与合同电量严格相等（导引反复强调的不均摊规则，
// 示例值自己必须先守住）；示例来源命名空间固定 TEST-GUIDE（列表「教学演示」标记依赖它）。
// 坏掉的症状：UTC 场景下交割月算错一个月；重试编号不再被 matchesRunTag 认领导致刷新恢复
// 找不回刚建的合同；示例分解合计 ≠ 合同电量，用户照抄却保存失败。
import { describe, expect, it } from 'vitest'
import type { GuideCtx } from '../types'
import {
  allocationExample, beijingParts, deliveryRange, exampleToday, frameworkExample, guideMonths,
  makeRunTag, matchesRunTag, obligationEconomics, obligationExample, quantityPriceExample,
  retryCode, subjectExample, tagClock, withConflictSuffix,
} from './examples'
import { ARTIFACT } from './anchors'

function ctx(artifacts: Record<string, unknown> = {}): GuideCtx {
  return { runTag: 'GUIDE-01020304', regionId: 'yunnan', practiceCompanyId: 'c-practice', artifacts, go: () => {} }
}

describe('北京时间口径', () => {
  it('beijingParts：UTC 跨零点后落到北京次日', () => {
    expect(beijingParts(new Date('2026-01-01T18:30:00Z'))).toMatchObject({ year: 2026, month: 1, day: 2, hour: 2, minute: 30 })
  })

  it('makeRunTag / tagClock：GUIDE-MMddHHmm 与 MMdd-HHmm 时钟段', () => {
    expect(makeRunTag(new Date('2026-01-01T18:30:00Z'))).toBe('GUIDE-01020230')
    expect(tagClock('GUIDE-01020304')).toBe('0102-0304')
  })

  it('exampleToday 与 beijingParts 同源：跨零点取北京日期', () => {
    expect(exampleToday(new Date('2026-01-01T18:30:00Z'))).toBe('2026-01-02')
  })
})

describe('409 编码冲突重试', () => {
  it('withConflictSuffix：干净编号 + 2 位随机后缀，剔除易混淆的 I/O/0/1', () => {
    for (let i = 0; i < 20; i += 1) {
      expect(withConflictSuffix('G-1')).toMatch(/^G-1-[A-HJ-NP-Z2-9]{2}$/)
    }
  })

  it('retryCode：表单现值不是目标编号时用干净编号；已经是（说明提交过没成功）则换后缀', () => {
    expect(retryCode(undefined, 'subjectKey', 'G-1')).toBe('G-1')
    expect(retryCode({ subjectKey: 'other' }, 'subjectKey', 'G-1')).toBe('G-1')
    const retried = retryCode({ subjectKey: 'G-1' }, 'subjectKey', 'G-1')
    expect(retried).not.toBe('G-1')
    expect(retried.startsWith('G-1-')).toBe(true)
  })

  it('matchesRunTag：干净编号与冲突后缀变体都属于本次运行，其它不属于', () => {
    expect(matchesRunTag('GUIDE-X', 'GUIDE-X')).toBe(true)
    expect(matchesRunTag('GUIDE-X-AB', 'GUIDE-X')).toBe(true)
    expect(matchesRunTag('GUIDE-XY', 'GUIDE-X')).toBe(false)
    expect(matchesRunTag('OTHER', 'GUIDE-X')).toBe(false)
    expect(matchesRunTag(undefined, 'GUIDE-X')).toBe(false)
  })
})

describe('交割月与交割期', () => {
  it('guideMonths：M+1..M+3，11 / 12 月发起自然跨年', () => {
    expect(guideMonths(new Date('2026-11-15T04:00:00Z'))).toEqual(['2026-12', '2027-01', '2027-02'])
    expect(guideMonths(new Date('2026-12-31T18:00:00Z'))).toEqual(['2027-02', '2027-03', '2027-04'])
  })

  it('deliveryRange：下月 1 日 ~ 第三个月真实月末（2027-02 是 28 天）', () => {
    expect(deliveryRange(new Date('2026-11-15T04:00:00Z'))).toEqual({ deliveryStart: '2026-12-01', deliveryEnd: '2027-02-28' })
  })
})

describe('示例值与产物衔接', () => {
  it('subjectExample：编码取运行标签、场站取练习场站前两个、单元代码不虚构', () => {
    const example = subjectExample(ctx({ [ARTIFACT.practiceStationIds]: [11, 22, 33] }))
    expect(example.subjectKey).toBe('GUIDE-01020304')
    expect(example.stationIds).toEqual([11, 22])
    expect(example.unitCode).toBe('')
    expect(example.displayName).toContain('【教学演示】')
  })

  it('框架 / 电量合同示例：编号错开、来源固定 TEST-GUIDE、挂接产物 id', () => {
    const c = ctx({ [ARTIFACT.subjectId]: 7, [ARTIFACT.frameworkId]: 9 })
    const fw = frameworkExample(c)
    const ob = obligationExample(c)
    expect(fw.externalContractNo).toBe('GUIDE-01020304-FW')
    expect(ob.externalContractNo).toBe('GUIDE-01020304-01')
    expect(fw.externalContractNo).not.toBe(ob.externalContractNo)
    expect(fw.sourceNamespace).toBe('TEST-GUIDE')
    expect(ob.sourceNamespace).toBe('TEST-GUIDE')
    expect(ob.subjectId).toBe(7)
    expect(ob.frameworkContractId).toBe(9)
    expect(fw.frameworkContractId).toBeNull()
  })

  it('月度分解示例：400/300/300 全部正式依据、合计与合同电量严格相等', () => {
    const now = new Date('2026-11-15T04:00:00Z')
    const { allocations, allocationDeclaredComplete } = allocationExample(now)
    expect(allocations.map((r) => r.quantity)).toEqual(['400', '300', '300'])
    expect(allocations.every((r) => r.evidenceBasis === 'FORMAL')).toBe(true)
    expect(allocationDeclaredComplete).toBe(true)
    expect(allocations.map((r) => r.deliveryMonth)).toEqual(guideMonths(now))

    const merged = obligationEconomics(now)
    const total = merged.allocations.reduce((sum, row) => sum + Number(row.quantity), 0)
    expect(String(total)).toBe(merged.totalQuantity)
    expect(merged.priceType).toBe(quantityPriceExample().priceType)
  })
})
