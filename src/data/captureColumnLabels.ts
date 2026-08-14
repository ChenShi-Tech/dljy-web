// 通用数据浏览器（UniversalCapturedBrowserView）列名 → 中文含义映射。
// ----------------------------------------------------------------------------
// 采集回放族（capture-families）的原始列多为拼音缩写或编号（jz/hj/drrq/p1..p96），
// 直接铺在表头对业务方不可读。此处集中登记列语义，DynamicTable 据此渲染中文表头，
// 并让 CSV 导出同样带中文列名。
//
// 语义权威来源：
//   - docs/data/mock-data-virtualization.md §4（每个 family/match 的 res.data 字段与量纲）
//   - shared/schema/entities/capture-families.mjs（ROW_SCHEMAS 各族列定义）
//   - shared/data-quality/rules.mjs（CAPTURE_QUALITY_RULES.expectedPointsPerDay：族声明的全天点数）
// 若上述来源调整字段口径，请同步维护本表。
// ----------------------------------------------------------------------------

import { getQualityRule } from 'shared/data-quality/rules.mjs'

// 数据族清单 re-export：视图层禁直接 import shared/schema/**（DEVELOPMENT.md 分层约定；
// 通用数据浏览器此前是唯一违例）。data 层是 schema 信息面向视图的合法出口——
// family 清单与列语义本就同源（ROW_SCHEMAS），在此一并取用零额外链路。
export { CAPTURE_FAMILIES, CAPTURE_FAMILY_CODES } from 'shared/schema/entities/capture-families.mjs'

// 固定字段：跨数据族语义基本一致的拼音缩写列。
const STATIC_LABELS: Record<string, string> = {
  // —— 日期 / 时间类 ——
  date: '日期',
  riqi: '日期',
  rq: '日期',
  jyrq: '交易日期',
  yxrq: '运行日期',
  drrq: '导入日期',
  scrq: '上传日期', // 平台文档（zptwd）：见 PlatformDocsView 表头
  bdrq1: '标的日期一', // 分时段交易（zfsdjy）：标的日期一/二，见 ZfsdjyTradesView
  bdrq2: '标的日期二',
  year: '年份',
  sj1: '申报窗口', // 交易月历（zjyap/calendar）：sj1=申报窗口、sj2=交易品种，见 TradeCalendarView
  sj2: '交易品种',
  czsj: '操作时间',

  // —— 统计汇总类 ——
  jz: '均值',
  hj: '合计',
  hjz: '合计值',
  pjz: '平均值',
  zxz: '最小值',
  zdz: '最大值',
  total: '合计',
  heji: '合计',

  // —— 类型 / 主体类 ——
  provId: '省份ID',
  type: '类型',
  jylx: '交易类型',
  sjlx: '数据类型',
  sdgs: '售电公司',
  czry: '操作人员',

  // —— 平台文档（zptwd） ——
  id: '编号',
  wdmc: '文档名称',
  wdjb: '文档级别',
  wddx: '文档大小',
  downloadPath: '下载路径',

  // —— 数据字典（system_dict） ——
  dictValue: '字典值',
  dictLabel: '字典标签',

  // —— ENSO ONI 三月滑动季（El Niño / La Niña，sdpt_elninolanina） ——
  djf: '12-1-2月', jfm: '1-2-3月', fma: '2-3-4月', mam: '3-4-5月',
  amj: '4-5-6月', mjj: '5-6-7月', jja: '6-7-8月', jas: '7-8-9月',
  aso: '8-9-10月', son: '9-10-11月', ond: '10-11-12月', ndj: '11-12-1月',
}

// 把从当天 00:00 起算的分钟数格式化为 HH:MM；整日末尾 1440 分钟显示为 24:00。
function toClock(totalMinutes: number): string {
  if (totalMinutes >= 1440) return '24:00'
  const mins = ((totalMinutes % 1440) + 1440) % 1440
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

// 判断是否为时序点列（p1、p2 … pN）。
const P_COLUMN = /^p(\d+)$/
// 已注册回放族只使用两种全天点数：24 点（每小时）与 96 点（每 15 分钟）。
// 见 shared/schema/entities/capture-families.mjs 的 P24 / P96。
const KNOWN_CADENCES = [24, 96]

/**
 * 依据实际列集合生成「列键 → 中文表头」映射。
 *
 * 时序点列 p1..pN 的时钟随全天点数推导：96 点=每 15 分钟一段，24 点=每 1 小时一段，
 * 表头形如「第1时段 00:00~00:15」，既保留时段序号又标出对应时刻区间，不再直接暴露 pN 编号。
 *
 * 全天点数（cadence）是「族的声明属性」而非可从数据观测的量：ROW_SCHEMAS 允许全部 p 列
 * 缺省（非 required），故稀疏的 96 点行可能只出现到 p24，用观测最大键无法与真正的 24 点族区分。
 * 因此优先用调用方传入的 declaredCadence（来自 CAPTURE_QUALITY_RULES.expectedPointsPerDay）；
 * 仅当族未知/无声明时，才退回按观测最大 pN 向已知点数（24/96）吸附的启发式兜底。
 */
export function buildColumnLabels(
  columns: string[],
  declaredCadence?: number
): Record<string, string> {
  const labels: Record<string, string> = {}

  // 先确定观测到的最大时序点序号。
  let maxPoint = 0
  for (const key of columns) {
    const m = P_COLUMN.exec(key)
    if (m) maxPoint = Math.max(maxPoint, Number(m[1]))
  }
  // cadence 优先取族声明值（>1 才是真正的日内点数，1=非时序族按无 cadence 处理）；
  // 无声明时退回按观测最大 pN 向已知全天点数吸附，避免尾部 p 列缺省导致的分数分钟/整点误判。
  let cadence = 0
  if (declaredCadence && declaredCadence > 1) {
    cadence = declaredCadence
  } else if (maxPoint > 0) {
    cadence = KNOWN_CADENCES.find((c) => maxPoint <= c) ?? maxPoint
  }
  const stepMinutes = cadence > 0 ? 1440 / cadence : 0

  for (const key of columns) {
    if (STATIC_LABELS[key]) {
      labels[key] = STATIC_LABELS[key]
      continue
    }
    const m = P_COLUMN.exec(key)
    if (m && stepMinutes > 0) {
      const idx = Number(m[1])
      const start = toClock((idx - 1) * stepMinutes)
      const end = toClock(idx * stepMinutes)
      labels[key] = `第${idx}时段 ${start}~${end}`
    }
    // 未登记的列不写入映射，DynamicTable 会回退显示原始列名（columnLabel 缺省用键名）。
  }

  return labels
}

// 解析族声明的全天点数：取 CAPTURE_QUALITY_RULES[family]（尊重 datasetOverrides）的
// expectedPointsPerDay；仅返回 >1 的日内 cadence（如 24/96），非时序族（1）或无规则返回 undefined。
function resolveDeclaredCadence(family?: string, match?: string): number | undefined {
  if (!family) return undefined
  const rule = getQualityRule(family, match ?? '') as { expectedPointsPerDay?: number } | null
  const points = rule?.expectedPointsPerDay
  return typeof points === 'number' && points > 1 ? points : undefined
}

/**
 * 从回放行数组直接推导列标签映射：取所有行键的并集（与 DynamicTable 的列生成口径一致），
 * 供通用数据浏览器一行接入。传入 family/match 以取族声明的全天点数（cadence 权威来源）。
 */
export function buildColumnLabelsFromRows(
  rows: Array<Record<string, unknown>>,
  family?: string,
  match?: string
): Record<string, string> {
  const seen = new Set<string>()
  const order: string[] = []
  for (const row of rows ?? []) {
    for (const key of Object.keys(row ?? {})) {
      if (!seen.has(key)) {
        seen.add(key)
        order.push(key)
      }
    }
  }
  return buildColumnLabels(order, resolveDeclaredCadence(family, match))
}

