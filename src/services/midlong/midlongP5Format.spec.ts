// 中长期售电 P5 展示口径（dljy#3016，MR-01..06）。
// 守什么：三种金额分离（无凭证不显示到账、不显示 0；未独立复算绝不显示「复算通过」）；
//         综合账单只归档标未分项；差值「外部 − 台账」如实（-20 就是 -20）；错误信封给可操作引导；
//         全部输出不出现 FORBIDDEN_REVIEW_TERMS / FORBIDDEN_SETTLEMENT_TERMS（口径红线）。
// 坏掉的症状：无凭证账单显示 0 元到账；NOT_PERFORMED 被展示成复算通过；量差取绝对值或被前端改写。
import { describe, expect, it } from 'vitest'
import {
  billAmountText, billKindTag, billPeriodLabel, coverageLabel, discrepancySidesLines, discrepancyStatusTag,
  greenCompositionLabel, greenUnitLine, priceDeltaText, recomputeStatusLabel, reportChangeLine, reportScopeLabel,
  settlementAmountRows, settlementFailureText, signedDeltaLabel, voucherText,
} from './midlongP5Format'
import { FORBIDDEN_REVIEW_TERMS, FORBIDDEN_SETTLEMENT_TERMS, SETTLEMENT_NOTICES, type SettlementAmounts } from './midlongP5Types'

const settlement = (overrides: Partial<SettlementAmounts> = {}): SettlementAmounts => ({
  month: '2026-08',
  nominalAmount: {
    amount: '294000', source: 'CONTRACT_LEDGER', sourceLabel: '中长期合同量价（持仓口径，名义金额）', coverage: 'COMPLETE',
    groups: [{ currency: 'CNY', taxBasis: 'TAX_INCLUDED', priceComponent: 'ENERGY_ONLY', knownQuantity: '980', notionalAmount: '294000' }],
    notice: SETTLEMENT_NOTICES.nominalNotSettlement,
  },
  billedAmount: {
    amount: '294000', quantity: '980', source: 'EXTERNAL_BILL', sourceLabel: '外部中长期账单（当前有效版本分项）', coverage: 'PARTIAL',
    unitemizedBillCount: 0, currentRevisionOnly: true, notice: SETTLEMENT_NOTICES.billedCurrentRevision,
  },
  receivedAmount: {
    amount: null, voucherCount: 0, source: 'PAYMENT_VOUCHER', sourceLabel: '收款凭证（编号 + 金额 + 日期 + 文件）', coverage: 'MISSING',
    notice: SETTLEMENT_NOTICES.noVoucherNoReceipt,
  },
  independentlyRecomputed: { status: 'NOT_PERFORMED', reason: 'NO_INDEPENDENT_SETTLEMENT_BASIS' },
  notice: SETTLEMENT_NOTICES.threeAmounts,
  ...overrides,
})

describe('三种金额分离（MR-02）', () => {
  it('无凭证收款显示「未显示到账」而不是 0；逐项附来源与覆盖状态', () => {
    const rows = settlementAmountRows(settlement())
    expect(rows.map((r) => r.key)).toEqual(['nominal', 'billed', 'received'])
    const received = rows.find((r) => r.key === 'received')!
    expect(received.amountText).toBe('无凭证（未显示到账）')
    expect(received.amountText).not.toContain('0')
    expect(received.coverageText).toBe('缺资料')
    expect(received.sourceLabel).toContain('收款凭证')
    expect(rows.find((r) => r.key === 'billed')!.amountText).toContain('294,000')
  })

  it('未分项综合账单只计数、不产生中长期金额；多口径不可比不给名义汇总', () => {
    const rows = settlementAmountRows(settlement({
      nominalAmount: {
        amount: null, source: 'CONTRACT_LEDGER', sourceLabel: '中长期合同量价（持仓口径，名义金额）', coverage: 'PARTIAL',
        groups: [
          { currency: 'CNY', taxBasis: 'TAX_INCLUDED', priceComponent: 'ENERGY_ONLY', knownQuantity: '500', notionalAmount: '150000' },
          { currency: 'CNY', taxBasis: 'TAX_EXCLUDED', priceComponent: 'ENERGY_ONLY', knownQuantity: '480', notionalAmount: '134400' },
        ],
        notice: SETTLEMENT_NOTICES.nominalNotSettlement,
      },
      billedAmount: {
        amount: null, quantity: null, source: 'EXTERNAL_BILL', sourceLabel: '外部中长期账单（当前有效版本分项）', coverage: 'MISSING',
        unitemizedBillCount: 2, currentRevisionOnly: true, notice: SETTLEMENT_NOTICES.billedCurrentRevision,
      },
    }))
    expect(rows.find((r) => r.key === 'nominal')!.amountText).toContain('口径不可比（见分组，不给汇总）')
    const billed = rows.find((r) => r.key === 'billed')!
    expect(billed.amountText).toBe('缺资料（未登记分项）')
    expect(billed.extra).toContain('另有 2 张综合账单仅归档（未分项）')
  })

  it('复算状态恒为未独立复算：不出现「复算通过」类结论', () => {
    const label = recomputeStatusLabel({ status: 'NOT_PERFORMED', reason: 'NO_INDEPENDENT_SETTLEMENT_BASIS' })
    expect(label).toContain('未独立复算')
    for (const term of FORBIDDEN_SETTLEMENT_TERMS) expect(label).not.toContain(term)
  })
})

describe('账单展示（MR-03）', () => {
  it('综合账单标未分项（警示色）；整单归档金额不进中长期金额', () => {
    expect(billKindTag('UNITEMIZED')).toMatchObject({ type: 'warning' })
    expect(billKindTag('UNITEMIZED').label).toContain('未分项')
    expect(billAmountText({ billKind: 'UNITEMIZED', amount: '500000', lineItemAmount: null })).toContain('整单归档，未分项不进中长期金额')
    expect(billAmountText({ billKind: 'ITEMIZED', amount: '500000', lineItemAmount: '294000' })).toBe('294,000 元分项 / 整单 500,000 元')
  })

  it('凭证状态：0 张凭证不显示到账；有凭证给金额与张数', () => {
    expect(voucherText({ voucherCount: 0, voucherAmount: null })).toBe('无凭证（未显示到账）')
    expect(voucherText({ voucherCount: 2, voucherAmount: '150000' })).toBe('150,000 元 / 2 张')
  })

  it('期间标签：单月显示一个月，跨月显示区间', () => {
    expect(billPeriodLabel('2026-08', '2026-08')).toBe('2026-08')
    expect(billPeriodLabel('2026-07', '2026-09')).toBe('2026-07 — 2026-09')
    expect(billPeriodLabel(null, '2026-09')).toBe('期间未知')
  })
})

describe('差异展示（MR-04）', () => {
  it('量差「外部 − 台账」如实：-20 就显示 -20，不取绝对值', () => {
    expect(signedDeltaLabel('-20')).toBe('-20 MWh')
    expect(signedDeltaLabel('20')).toBe('+20 MWh')
    expect(signedDeltaLabel(null)).toBe('未知')
  })

  it('价格不可比只标原因、不算价差；两侧快照各自展示不互相覆盖', () => {
    expect(priceDeltaText({ priceComparable: false, priceDelta: null })).toContain('价格不可比')
    expect(priceDeltaText({ priceComparable: true, priceDelta: '-5' })).toBe('-5 元/MWh')
    const lines = discrepancySidesLines({
      ledger: { quantity: '1000', price: '300', notional: '300000' },
      external: { quantity: '980', price: '300', amount: '294000' },
    })
    expect(lines[0]).toContain('台账侧')
    expect(lines[0]).toContain('1,000')
    expect(lines[1]).toContain('外部侧')
    expect(lines[1]).toContain('980')
  })

  it('状态标签：待处理/需重新核对/已解决三态', () => {
    expect(discrepancyStatusTag('OPEN')).toMatchObject({ type: 'warning' })
    expect(discrepancyStatusTag('RECHECK_REQUIRED').label).toContain('需重新核对')
    expect(discrepancyStatusTag('RESOLVED')).toMatchObject({ type: 'success' })
  })
})

describe('绿电组成与报告（MR-05/06）', () => {
  it('组成形态标签与分项一行（总价已含时不再次相加）', () => {
    expect(greenCompositionLabel('TOTAL_INCLUDES_ENVIRONMENT')).toBe('总价已含环境价值')
    const line = greenUnitLine({ unitTotal: '310', energyUnit: '300', environmentUnit: '10' })
    expect(line).toContain('合计 310')
    expect(line).toContain('电能量 300')
    expect(line).toContain('环境价值 10')
  })

  it('报告范围与版本差异行', () => {
    expect(reportScopeLabel('SUBJECT', '云南中广核一号')).toBe('按交易主体 · 云南中广核一号')
    expect(reportScopeLabel('COMPANY')).toBe('全公司')
    expect(reportChangeLine({ kind: 'PLAN', id: 7, from: 1, to: 2 })).toBe('PLAN#7 v1→v2')
  })
})

describe('错误信封翻译', () => {
  it('P5 专属错误码给可操作引导（修订/归档/闭环/报告版本）', () => {
    expect(settlementFailureText('DUPLICATE_BILL_CONTENT', '', { billId: 9, currentRevisionNo: 2 })).toContain('请以修订版本提交')
    expect(settlementFailureText('DUPLICATE_BILL_CONTENT', '', { billId: 9, currentRevisionNo: 2 })).toContain('#9')
    expect(settlementFailureText('UNITEMIZED_BILL_NO_SPLIT', '', {})).toContain('不能携带或推算分项')
    expect(settlementFailureText('DISCREPANCY_ALREADY_OPEN', '', { discrepancyId: 5 })).toContain('#5')
    expect(settlementFailureText('DISCREPANCY_RESOLUTION_NOTE_REQUIRED', '', {})).toContain('关闭差异必须填写处理说明')
    expect(settlementFailureText('REPORT_INPUTS_UNCHANGED', '', { reportId: 7, currentVersionNo: 1 })).toContain('未生成新版本')
    expect(settlementFailureText('INCOMPLETE_BASIS', '', { billKind: 'UNITEMIZED' })).toContain('综合账单')
    expect(settlementFailureText('VERSION_CONFLICT', '', { reason: 'ROW_VERSION_CHANGED', currentRowVersion: 5 })).toContain('请刷新核对后再提交')
  })

  it('覆盖状态三态中文标签', () => {
    expect(coverageLabel('COMPLETE')).toBe('覆盖完整')
    expect(coverageLabel('PARTIAL')).toBe('部分覆盖')
    expect(coverageLabel('MISSING')).toBe('缺资料')
  })
})

describe('口径红线（FORBIDDEN 词汇）', () => {
  it('P5 展示层全部输出不出现禁用口径词汇', () => {
    const outputs = [
      ...settlementAmountRows(settlement()).flatMap((r) => [r.amountText, r.extra, r.coverageText, r.sourceLabel]),
      recomputeStatusLabel({ status: 'NOT_PERFORMED', reason: 'NO_INDEPENDENT_SETTLEMENT_BASIS' }),
      billAmountText({ billKind: 'UNITEMIZED', amount: '1', lineItemAmount: null }),
      voucherText({ voucherCount: 0, voucherAmount: null }),
      priceDeltaText({ priceComparable: false, priceDelta: null }),
      settlementFailureText('UNITEMIZED_BILL_NO_SPLIT', '', {}),
      ...Object.values(SETTLEMENT_NOTICES),
    ]
    for (const output of outputs) {
      for (const term of [...FORBIDDEN_REVIEW_TERMS, ...FORBIDDEN_SETTLEMENT_TERMS]) {
        expect(output).not.toContain(term)
      }
    }
  })
})
