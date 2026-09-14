// 当日公开披露总览：读取源记录日期，不把实际值、未知目标日或其他区域冒充模型预测。
// 与officialBaseline的“目标日对照曲线”分开：这里读D记录，新能源的targetDate可以是D+1。
import { fetchCaptured } from '@/services/captured'

/** 披露日期只接受真实日历日；不依赖会初始化模型目录的预测结果适配器。 */
export function isDisclosureDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00Z`)
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
}

export const DISCLOSURE_GROUPS = [
  { id: 'price', label: '结算价格' },
  { id: 'forecast', label: '系统预测' },
  { id: 'actual', label: '实际运行' },
  { id: 'balance', label: '跨省与供需' },
] as const

export interface DisclosureDatasetSpec {
  id: string
  family: 'yn_system_forecast' | 'yn_system_supply'
  title: string
  group: typeof DISCLOSURE_GROUPS[number]['id']
  nature: 'price' | 'forecast' | 'actual' | 'supply'
  unit: string
  slots: 24 | 96
}

// 原始导出没有unit字段，旧语义目录(100kW/MWh)与源适配器文档(MW)相互冲突。
// 总览保留原数，不在显示层擅自乘0.1/4；后续按源契约核实后单独校准。
const RAW_UNIT = '原始值'
const UNIT_NOTE = '功率类历史单位标注存在冲突；当前按采集原值展示，未缩放或换算为电量。'
const spec = (id: string, title: string, group: DisclosureDatasetSpec['group'], nature: DisclosureDatasetSpec['nature'], slots: 24 | 96 = 96): DisclosureDatasetSpec => ({
  id, title, group, nature, slots,
  family: nature === 'supply' ? 'yn_system_supply' : 'yn_system_forecast',
  unit: nature === 'price' ? '元/MWh' : RAW_UNIT,
})

export const DISCLOSURE_DATASETS: readonly DisclosureDatasetSpec[] = [
  spec('da_user_price', '用户侧日前结算价', 'price', 'price', 24),
  spec('rt_user_price', '用户侧实时结算价', 'price', 'price', 24),
  spec('load_forecast', '统调负荷预测', 'forecast', 'forecast'),
  spec('new_energy_forecast_d1', '新能源出力预测', 'forecast', 'forecast'),
  spec('total_generation_forecast', '总发电预测', 'forecast', 'forecast'),
  spec('non_market_forecast', '非市场机组出力预测', 'forecast', 'forecast'),
  spec('load_actual', '统调负荷', 'actual', 'actual'),
  spec('new_energy_actual', '新能源出力', 'actual', 'actual'),
  spec('hydro_actual', '水电出力', 'actual', 'actual'),
  spec('total_generation_actual', '总发电出力', 'actual', 'actual'),
  spec('non_market_actual', '非市场机组出力', 'actual', 'actual'),
  spec('inter_provincial_forecast', '跨省送受电预测', 'balance', 'forecast', 24),
  spec('yn_system_supply_demand', '供需实际', 'balance', 'supply'),
]

export interface DisclosureSeries {
  id: string
  label: string
  scope: string
  scopeLabel: string
  targetDate: string | null
  unit: string
  labels: string[]
  points: (number | null)[]
  previous: (number | null)[]
  validPoints: number
  expectedPoints: number
  conflicts: number
}

export interface DisclosureDatasetResult {
  spec: DisclosureDatasetSpec
  date: string
  status: 'ready' | 'partial' | 'empty' | 'error' | 'rejected'
  rows: Record<string, unknown>[]
  series: DisclosureSeries[]
  warnings: string[]
  error?: string
  sourceLabel: string
  capturedAt?: string
  ingestedAt?: string
}

const object = (value: unknown): Record<string, unknown> | null => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
const text = (value: unknown): string => typeof value === 'string' ? value.trim() : ''
function number(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value !== 'string' || !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value.trim())) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}
function clock(value: unknown): string | null {
  const match = /^(\d{1,2}):(\d{2})(?::00)?$/.exec(text(value))
  if (!match || +match[1] > 23 || +match[2] > 59) return null
  return `${match[1].padStart(2, '0')}:${match[2]}`
}
function dateOf(value: unknown): string | null {
  return typeof value === 'string' && isDisclosureDate(value) ? value : null
}
function labelsFor(slots: 24 | 96): string[] {
  return Array.from({ length: slots }, (_, i) => {
    const minute = i * (1440 / slots)
    return `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`
  })
}
function scopeLabel(scope: string, dataset: DisclosureDatasetSpec): string {
  if (dataset.nature === 'price' && scope === 'all') return '用户侧统一口径（源标记 all）'
  return ({ yn: '云南省内', all: '南网全网', gd: '广东', gx: '广西', gz: '贵州', hn: '海南', 云南: '云南省内' } as Record<string, string>)[scope] ?? scope
}
const SUPPLY_FIELDS = [
  ['loadMWh', '统调负荷', RAW_UNIT], ['newEnergyMWh', '新能源出力', RAW_UNIT],
  ['hydropowerMWh', '水电出力', RAW_UNIT], ['noMarketUnitMWh', '非市场机组出力', RAW_UNIT],
  ['frequencyHz', '电网频率', 'Hz'], ['price', '源价格字段', RAW_UNIT],
  ['volume', '源成交量字段', RAW_UNIT], ['deviation', '源偏差字段', RAW_UNIT],
] as const

/** 校验信封、保留全部当日原始字段，并按范围/目标日/指标拆曲线，不补零、不覆盖冲突。 */
export function normalizeDailyDisclosure(dataset: DisclosureDatasetSpec, date: string, input: unknown): DisclosureDatasetResult {
  const result: DisclosureDatasetResult = { spec: dataset, date, status: 'empty', rows: [], series: [], warnings: [], sourceLabel: '暂无真实数据' }
  if (!isDisclosureDate(date)) return { ...result, status: 'error', error: '请选择有效的披露记录日期' }
  const body = object(input)
  const provenance = object(body?.provenance)
  const source = text(provenance?.sourceType).toUpperCase()
  const rejected = body?.accessDenied === true || Number(body?.code) >= 400 || body?.mock === true || body?._mock === true
    || [body?.sourceType, body?._sourceType, provenance?.sourceType].some((v) => ['MOCK', 'SYNTHETIC', 'ILLUSTRATIVE'].includes(text(v).toUpperCase()))
    || provenance?.realDataConnected !== true || !['DB', 'IMPORT', 'CAPTURE', 'REAL'].includes(source)
    || text(provenance?.region) !== 'yunnan'
    || (!!provenance?.datasetKey && provenance.datasetKey !== dataset.id)
    || (!!provenance?.family && provenance.family !== dataset.family)
  if (rejected) return { ...result, status: 'rejected', error: body?.accessDenied ? '无权读取该披露数据' : '真实来源或地区校验未通过，未展示模拟/未知数据' }
  result.sourceLabel = '已导入披露 · 真实数据回放'
  result.capturedAt = text(provenance?.capturedAt) || undefined
  result.ingestedAt = text(provenance?.ingestedAt) || undefined
  const incoming = Array.isArray(body?.rows) ? body.rows : Array.isArray(body?.data) ? body.data : []
  const dateKey = dataset.nature === 'supply' ? 'date' : 'operateDate'
  result.rows = incoming.map(object).filter((r): r is Record<string, unknown> => r !== null && r[dateKey] === date)
  if (incoming.length !== result.rows.length) result.warnings.push('非当日或无效记录已排除；未将其他日期的值移到当日。')
  if (object(body?._filter)?.truncated === true) result.warnings.push('源接口已截断返回记录，本页不声称数据完整。')
  if (dataset.nature !== 'price') result.warnings.push(UNIT_NOTE)
  if (!result.rows.length) { result.error = '该日期没有已导入的披露记录'; return result }
  const labels = labelsFor(dataset.slots)
  const index = new Map(labels.map((label, i) => [label, i]))
  const groups = new Map<string, DisclosureSeries>()
  const seen = new Map<string, Set<number>>()
  const conflicts = new Map<string, Set<number>>()
  let invalidTimes = 0
  let missingTargets = 0
  for (const row of result.rows) {
    const rawScope = text(row.region) || text(row.area) || '未标明范围'
    const targetDate = dateOf(row.targetDate)
    if (dataset.nature === 'forecast' && !targetDate) missingTargets++
    const fields = dataset.nature === 'supply' ? SUPPLY_FIELDS : [['value', dataset.title, dataset.unit]] as const
    const time = clock(row.timePoint ?? row.time)
    const slot = time === null ? undefined : index.get(time)
    if (slot === undefined) { invalidTimes++; continue }
    for (const [field, label, unit] of fields) {
      const value = number(row[field])
      // 供需表的预留空列不能生成“空频率/空价格”占位图；原字段仍可在明细查看。
      if (dataset.nature === 'supply' && value === null) continue
      const metric = dataset.nature === 'supply' ? field : text(row.metric) || dataset.id
      const id = JSON.stringify([rawScope, targetDate, metric])
      let series = groups.get(id)
      if (!series) {
        series = { id, label, scope: rawScope, scopeLabel: scopeLabel(rawScope, dataset), targetDate, unit,
          labels: [...labels], points: Array(dataset.slots).fill(null), previous: Array(dataset.slots).fill(null),
          validPoints: 0, expectedPoints: dataset.slots, conflicts: 0 }
        groups.set(id, series); seen.set(id, new Set()); conflicts.set(id, new Set())
      }
      const occupied = seen.get(id)!
      const ambiguous = conflicts.get(id)!
      if (value === null || ambiguous.has(slot)) continue
      if (occupied.has(slot) && series.points[slot] !== value) {
        series.points[slot] = null; series.previous[slot] = null; ambiguous.add(slot)
      } else {
        series.points[slot] = value
        series.previous[slot] = number(row.valuePrev)
        occupied.add(slot)
      }
    }
  }
  result.series = [...groups.values()].map((s) => ({ ...s, validPoints: s.points.filter((v) => v !== null).length, conflicts: conflicts.get(s.id)!.size }))
  const conflictCount = result.series.reduce((sum, s) => sum + s.conflicts, 0)
  if (conflictCount) result.warnings.push(`${conflictCount} 个同范围、同目标日时段存在冲突，曲线断开；原始行保留供核查。`)
  if (invalidTimes) result.warnings.push(`${invalidTimes} 条时点不符合本数据集原生粒度，未绘图；原始行保留。`)
  if (missingTargets) result.warnings.push('预测目标日期未明确：仅按源记录日期展示，不认定它预测当天或次日。')
  if (!result.series.some((s) => s.validPoints > 0)) { result.status = 'partial'; result.error = '有原始记录，但没有可安全绘制的有效曲线'; return result }
  result.status = result.series.some((s) => s.validPoints < s.expectedPoints) || invalidTimes > 0 || object(body?._filter)?.truncated === true ? 'partial' : 'ready'
  return result
}

/** 查询当前已接云南公开披露的全部13集；3路并发上限，失败只影响本集，无训练/推理副作用。 */
export async function loadDailyDisclosure(regionId: string, date: string): Promise<DisclosureDatasetResult[]> {
  if (regionId !== 'yunnan') throw new Error('当日披露全量总览当前仅接入云南公开数据；不会串读云南或模拟其他地区。')
  if (!isDisclosureDate(date)) throw new Error('请选择有效的披露记录日期')
  const results: DisclosureDatasetResult[] = new Array(DISCLOSURE_DATASETS.length)
  let cursor = 0
  await Promise.all(Array.from({ length: 3 }, async () => {
    while (cursor < DISCLOSURE_DATASETS.length) {
      const i = cursor++
      const dataset = DISCLOSURE_DATASETS[i]
      try {
        const body: unknown = await fetchCaptured(dataset.family, dataset.id, { region: regionId, dateFrom: date, dateTo: date, limit: 4096 })
        results[i] = normalizeDailyDisclosure(dataset, date, body)
      } catch (e) {
        results[i] = { spec: dataset, date, status: 'error', rows: [], series: [], warnings: [], sourceLabel: '读取失败', error: e instanceof Error ? e.message : '读取失败，请重试' }
      }
    }
  }))
  return results
}
