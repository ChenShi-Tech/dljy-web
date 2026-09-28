// 中长期售电合同页面的展示口径（dljy#2939）：纯函数，页面与单测共用。
//
// 红线（specs MC-02/MC-03/MP-02/MP-03）：
// - 未知就显示「未知/待核对」，不显示 0；已知 0 显示 0。
// - 售电价格只看售电价，不回退买方价（本模块根本不接收买方价）。
// - 交割期结束 ≠ 逾期/违约；没有结清凭证时不出现「逾期」字样。
// - 金额只称「名义金额」，不称收入或结算金额。
import type {
  ConfirmationStatus, DeliveryProgress, MidlongPositionMonth, MidlongPriceSummary, QualityFlag,
} from './midlongTypes'
import { CONFIRMATION_STATUS_LABELS, DELIVERY_PROGRESS_LABELS, QUALITY_FLAG_LABELS } from './midlongTypes'

type TagType = 'success' | 'warning' | 'danger' | 'info' | 'primary'

/** 十进制字符串 → 千分位展示（展示层舍入，不参与计算）。null/空 → 占位文本。 */
export function fmtDecimal(value: string | null | undefined, digits = 3, placeholder = '未知'): string {
  if (value === null || value === undefined || value === '') return placeholder
  const n = Number(value)
  if (!Number.isFinite(n)) return placeholder
  return n.toLocaleString('zh-CN', { minimumFractionDigits: 0, maximumFractionDigits: digits })
}

export function fmtQuantity(value: string | null | undefined): string {
  return fmtDecimal(value, 3, '未知')
}

export function fmtPrice(value: string | null | undefined): string {
  return fmtDecimal(value, 2, '待核对')
}

export function fmtAmount(value: string | null | undefined): string {
  return fmtDecimal(value, 0, '不完整')
}

/** 比例字符串（0.5）→ 50%；分母为零（null）→ 「无分母」。 */
export function fmtRatio(value: string | null | undefined): string {
  if (value === null || value === undefined || value === '') return '无分母'
  const n = Number(value)
  if (!Number.isFinite(n)) return '无分母'
  return `${(n * 100).toLocaleString('zh-CN', { maximumFractionDigits: 1 })}%`
}

export function confirmationTag(status: ConfirmationStatus): { label: string; type: TagType } {
  const type: Record<ConfirmationStatus, TagType> = { DRAFT: 'info', PENDING_VERIFICATION: 'warning', CONFIRMED: 'success', VOIDED: 'info' }
  return { label: CONFIRMATION_STATUS_LABELS[status] ?? status, type: type[status] ?? 'info' }
}

export function progressTag(progress: DeliveryProgress): { label: string; type: TagType } {
  // 「交割期已结束」用中性色：它不是风险信号，不能暗示逾期或违约。
  const type: Record<DeliveryProgress, TagType> = { NOT_STARTED: 'primary', IN_DELIVERY: 'success', DELIVERY_ENDED: 'info', UNKNOWN: 'warning' }
  return { label: DELIVERY_PROGRESS_LABELS[progress] ?? progress, type: type[progress] ?? 'info' }
}

const BLOCKING_FLAGS: QualityFlag[] = ['MISSING_SUBJECT', 'MISSING_EVIDENCE', 'MISSING_QUANTITY', 'MISSING_DELIVERY_PERIOD']

/** 质量缺口：会阻止核验确认的标为警示色，其余为提示色。 */
export function qualityTags(flags: QualityFlag[]): Array<{ flag: QualityFlag; label: string; type: TagType; blocksVerification: boolean }> {
  return flags.map((flag) => {
    const blocksVerification = BLOCKING_FLAGS.includes(flag)
    return { flag, label: QUALITY_FLAG_LABELS[flag] ?? flag, type: blocksVerification ? 'danger' : 'warning', blocksVerification }
  })
}

/** 月度持仓单元格：不完整的月份在数值旁提示，不把 0 当成真实零。 */
/** 测试类来源的展示口径（dljy#3404）：TEST-GUIDE 是操作导引在练习空间生成的教学演示数据，
 *  与工程测试夹具分开标注；非 TEST 开头的真实来源返回 null（页面不显示任何标记）。 */
export function testDataKind(sourceNamespace: string): { label: string; title: string } | null {
  if (sourceNamespace === 'TEST-GUIDE') {
    return {
      label: '教学演示',
      title: '该合同是操作导引在练习空间生成的教学演示数据，不代表真实合同，不计入集团汇总。',
    }
  }
  if (/^TEST/i.test(sourceNamespace)) {
    return {
      label: '测试数据',
      title: `该合同来源为 ${sourceNamespace}，是工程测试数据，不代表真实合同，不作为业务验收依据。`,
    }
  }
  return null
}

export function monthQuantityLabel(month: MidlongPositionMonth): string {
  const qty = fmtQuantity(month.formalQuantity)
  if (!month.incomplete) return qty
  return month.formalQuantity === '0' ? '未分解（非零持仓）' : `${qty}（另有未分解）`
}

/** 均价展示：多组口径不可比时不给统一均价。 */
export function averagePriceLabel(price: MidlongPriceSummary): string {
  if (!price.comparable) return '口径不可比（见分组）'
  if (price.averagePrice === null) return price.knownPriceQuantity === '0' ? '无已知价格' : '待核对'
  return `${fmtPrice(price.averagePrice)} 元/MWh`
}

export function notionalAmountLabel(price: MidlongPriceSummary): string {
  if (!price.comparable) return '口径不可比（见分组）'
  if (price.knownNotionalAmount === null) return '无已知价格'
  return `${fmtAmount(price.knownNotionalAmount)} 元${price.notionalAmountComplete ? '' : '（仅已知部分，总额不完整）'}`
}

/**
 * 取数代次守卫：切换公司/地区/筛选后，旧请求迟到返回不得覆盖新状态。
 * begin() 在发请求前调用并记住返回的 token；结果回来时 isCurrent(token) 为 false 就丢弃。
 */
export function createLoadGuard() {
  let generation = 0
  let context = ''
  return {
    begin(contextKey: string) {
      generation += 1
      context = contextKey
      return { generation, contextKey }
    },
    isCurrent(token: { generation: number; contextKey: string }, currentContextKey: string) {
      return token.generation === generation && token.contextKey === context && context === currentContextKey
    },
  }
}

/** 浏览器下载服务端生成的 CSV（内容已带 BOM）。 */
export function downloadCsv(fileName: string, content: string) {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  a.click()
  URL.revokeObjectURL(url)
}

export function downloadBase64(fileName: string, contentBase64: string, mediaType = 'application/octet-stream') {
  const bytes = Uint8Array.from(atob(contentBase64), (c) => c.charCodeAt(0))
  const blob = new Blob([bytes], { type: mediaType })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  a.click()
  URL.revokeObjectURL(url)
}

/** 单个上传文件上限，与后端解码上限一致（资料与导入文件都受此限）。 */
export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024

/** 超限文件在读入内存之前就拒绝，避免误选大文件时整份读入并膨胀成 base64 把页面拖死。 */
export function oversizeUploadMessage(file: { name: string; size: number }): string | null {
  if (file.size <= MAX_UPLOAD_BYTES) return null
  return `文件「${file.name}」大小 ${(file.size / 1024 / 1024).toFixed(1)} MB，超过 ${MAX_UPLOAD_BYTES / 1024 / 1024} MB 上限，未读取也未上传`
}

/** File → base64（不含 data: 前缀）。 */
export async function fileToBase64(file: Blob): Promise<string> {
  const buffer = new Uint8Array(await file.arrayBuffer())
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < buffer.length; i += chunk) binary += String.fromCharCode(...buffer.subarray(i, i + chunk))
  return btoa(binary)
}
