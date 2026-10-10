// 「合同入门」导引的示例值（dljy#3404）：全部按北京时间生成，不虚构官方单元编码；
// 名称前缀【教学演示】、来源命名空间 TEST-GUIDE（列表与详情会显示「教学演示」）。
// 分步 fill 用到的字段名与组件表单草稿一一对应（economicsDraft / FormDialog identity）。
import type { GuideCtx } from '../types'
import { beijingToday, monthFirstDay, monthLastDay } from '@/services/midlong/midlongTypes'
import { nextRowUid, type AllocationRow, type EconomicsDraft } from '@/services/midlong/economicsDraft'
import { ARTIFACT } from './anchors'

const pad = (n: number): string => String(n).padStart(2, '0')

/** 北京时间字段：所有导引示例值的时间口径（UTC 与北京跨零点场景见 examples.spec）。 */
export function beijingParts(now: Date = new Date()): { year: number; month: number; day: number; hour: number; minute: number } {
  const shifted = new Date(now.getTime() + 8 * 3600_000)
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
  }
}

/** 运行标签 GUIDE-MMddHHmm（北京时间）：同一次导引建的记录共用，再练一遍自然错开。 */
export function makeRunTag(now: Date = new Date()): string {
  const p = beijingParts(now)
  return `GUIDE-${pad(p.month)}${pad(p.day)}${pad(p.hour)}${pad(p.minute)}`
}

/** 名称里展示的 MMdd-HHmm 时钟段。 */
export function tagClock(runTag: string): string {
  const digits = runTag.replace(/^GUIDE-/, '')
  return `${digits.slice(0, 4)}-${digits.slice(4, 8)}`
}

/** 409 编码冲突重试：在干净编号后加 2 位随机字符（去掉易混淆的 I/O/0/1）。 */
export function withConflictSuffix(base: string): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let suffix = ''
  for (let i = 0; i < 2; i += 1) suffix += alphabet[Math.floor(Math.random() * alphabet.length)]
  return `${base}-${suffix}`
}

/**
 * 编码重试决策：表单现值已是本次要填的干净编号，说明照它提交过且没成功（成功会推进步骤），
 * 再点「帮我填」就换随机后缀，避免同一编号反复 409。
 */
export function retryCode(current: Record<string, unknown> | undefined, key: string, base: string): string {
  return current && current[key] === base ? withConflictSuffix(base) : base
}

/** 刷新恢复 / 完成判定用：编码是否属于本次运行（干净编号或它的冲突重试后缀变体）。 */
export function matchesRunTag(code: unknown, runTag: string): boolean {
  return typeof code === 'string' && (code === runTag || code.startsWith(`${runTag}-`))
}

/** 交割目标月 M+1..M+3（北京时间当月起算；11、12 月发起时自然跨年）。 */
export function guideMonths(now: Date = new Date()): [string, string, string] {
  const { year, month } = beijingParts(now)
  const at = (offset: number): string => {
    const total = year * 12 + (month - 1) + offset
    return `${Math.floor(total / 12)}-${pad((total % 12) + 1)}`
  }
  return [at(1), at(2), at(3)]
}

/** 交割期：下月 1 日 ~ 第三个月真实月末（含当日），落在月度持仓默认 12 个月窗口内。 */
export function deliveryRange(now: Date = new Date()): { deliveryStart: string; deliveryEnd: string } {
  return deliveryRangeForMonths(guideMonths(now))
}

/** 按给定的三个交割月算交割期（会话固定的月份传进来，跨月继续也不漂移）。 */
export function deliveryRangeForMonths([first, , third]: readonly [string, string, string]): { deliveryStart: string; deliveryEnd: string } {
  // 月份来自 guideMonths，恒合法；?? 兜底只是类型收窄（dates.mjs 对非法输入返回 null）。
  return { deliveryStart: monthFirstDay(first) ?? `${first}-01`, deliveryEnd: monthLastDay(third) ?? `${third}-28` }
}

// ---- 交易主体 ----

export type SubjectExample = {
  subjectKey: string
  displayName: string
  unitCode: string
  unitCodeSource: string
  stationIds: number[]
}

/** 主体示例：编码=运行标签；单元代码留空（不虚构官方编码，提示不阻断）；场站取练习公司的练习场站。 */
export function subjectExample(ctx: GuideCtx, current?: Record<string, unknown>): SubjectExample {
  const seeded = ctx.artifacts[ARTIFACT.practiceStationIds]
  return {
    subjectKey: retryCode(current, 'subjectKey', ctx.runTag),
    displayName: `【教学演示】交易单元 ${tagClock(ctx.runTag)}`,
    unitCode: '',
    unitCodeSource: '',
    stationIds: Array.isArray(seeded) ? (seeded as number[]).slice(0, 2) : [],
  }
}

// ---- 框架协议 / 电量合同（identity 字段与 MidlongContractFormDialog 的草稿一致）----

export type ContractIdentityExample = {
  documentKind: 'FRAMEWORK' | 'OBLIGATION'
  productKind: 'ANNUAL'
  tradeMethod: 'BILATERAL'
  marketScope: 'PROVINCIAL'
  energyAttribute: 'CONVENTIONAL'
  contractName: string
  externalContractNo: string
  sourceNamespace: 'TEST-GUIDE'
  counterpartyName: string
  signedDate: string
  subjectId: number | null
  stationId: number | null
  frameworkContractId: number | null
  remarks: string
}

/** 框架协议示例：年度双边省内常规；不填经济内容（框架协议无必填）。 */
export function frameworkExample(ctx: GuideCtx, current?: Record<string, unknown>): ContractIdentityExample {
  const base = `${ctx.runTag}-FW`
  return {
    documentKind: 'FRAMEWORK',
    productKind: 'ANNUAL',
    tradeMethod: 'BILATERAL',
    marketScope: 'PROVINCIAL',
    energyAttribute: 'CONVENTIONAL',
    contractName: '【教学演示】年度双边框架协议',
    externalContractNo: retryCode(current, 'externalContractNo', base),
    sourceNamespace: 'TEST-GUIDE',
    counterpartyName: '【教学演示】购电方',
    signedDate: '',
    subjectId: (ctx.artifacts[ARTIFACT.subjectId] as number | undefined) ?? null,
    stationId: null,
    frameworkContractId: null,
    remarks: '',
  }
}

/** 电量合同示例：编号 -01；主体同框架协议；场站留空（主体统签，只是提示不阻断）；挂刚建的框架协议。 */
export function obligationExample(ctx: GuideCtx, current?: Record<string, unknown>): ContractIdentityExample {
  const base = `${ctx.runTag}-01`
  return {
    documentKind: 'OBLIGATION',
    productKind: 'ANNUAL',
    tradeMethod: 'BILATERAL',
    marketScope: 'PROVINCIAL',
    energyAttribute: 'CONVENTIONAL',
    contractName: '【教学演示】年度双边电量合同',
    externalContractNo: retryCode(current, 'externalContractNo', base),
    sourceNamespace: 'TEST-GUIDE',
    counterpartyName: '【教学演示】购电方',
    signedDate: '',
    subjectId: (ctx.artifacts[ARTIFACT.subjectId] as number | undefined) ?? null,
    stationId: null,
    frameworkContractId: (ctx.artifacts[ARTIFACT.frameworkId] as number | undefined) ?? null,
    remarks: '',
  }
}

// ---- 经济内容（与 EconomicsDraft 字段一致，分步 fill 各取子集）----

export function deliveryExample(months?: readonly [string, string, string]): { deliveryStart: string; deliveryEnd: string } {
  return months ? deliveryRangeForMonths(months) : deliveryRange()
}

export function quantityPriceExample(): Pick<EconomicsDraft, 'totalQuantity' | 'quantityUnit' | 'sellerPrice' | 'priceUnit' | 'priceType' | 'taxBasis' | 'priceComponent'> {
  return {
    totalQuantity: '1000',
    quantityUnit: 'MWh',
    sellerPrice: '280',
    priceUnit: '元/MWh',
    priceType: 'FIXED',
    taxBasis: 'TAX_INCLUDED',
    priceComponent: 'ENERGY_ONLY',
  }
}

/** 月度分解 M+1=400 / M+2=300 / M+3=300，全部正式依据；合计与合同电量严格相等（不均摊）。 */
export function allocationExample(now: Date = new Date(), months?: readonly [string, string, string]): { allocations: AllocationRow[]; allocationDeclaredComplete: boolean } {
  const [m1, m2, m3] = months ?? guideMonths(now)
  return {
    allocations: [
      { uid: nextRowUid(), deliveryMonth: m1, quantity: '400', price: '280', evidenceBasis: 'FORMAL' },
      { uid: nextRowUid(), deliveryMonth: m2, quantity: '300', price: '280', evidenceBasis: 'FORMAL' },
      { uid: nextRowUid(), deliveryMonth: m3, quantity: '300', price: '280', evidenceBasis: 'FORMAL' },
    ],
    allocationDeclaredComplete: true,
  }
}

/** 合并版经济草稿（测试断言用：normalizeEconomics 无错、COMPLETE、质量缺口只剩缺依据）。 */
export function obligationEconomics(now: Date = new Date()): EconomicsDraft {
  return {
    ...deliveryRange(),
    ...quantityPriceExample(),
    environmentPrice: '',
    ...allocationExample(now),
  }
}

/** 教学演示口径的「今天」（北京时间）——文案与示例值统一用它。 */
export function exampleToday(now: Date = new Date()): string {
  return beijingToday(now.getTime())
}
