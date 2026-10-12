<script setup lang="ts">
// S2 早间分析（08:30–09:30）， 判断链真正的起点
//
// 交易员早上要回答的第一个业务问题不是「数据齐不齐」，而是「今天这个市场是松还是紧」。
// 本面板把四个基本面量（可调机组 / 新能源 / 外送 / 负荷）压成供需比，映射到边际机组与
// 价格中枢区间，输出一句可执行的市场判断，它是 S3 方向判断的输入。
//
// 三个刻意的设计点：
// ① 外送是分母项。外送计划是省内出清的硬边界而非竞价标的，外送增加等价于省内净
//      负荷增加。放错位置会让松紧判断整个反向，故面板单独给外送耦合推演。
// ② 主导态势取众数而非平均。平均会把「多数时段偏紧 + 个别时段极松」抹成「宽松」，
//      恰好抹掉当天最该防的那几个小时。
// ③ 八源验签是本步的异常分支（v1.0："数据缺失→标注低可信并人工补判"），收进折叠
// 区块：验签结论参与写回，但只要基本面仍由使用者给定，门禁上限就压在「可参考」，
//      验签打满分也不放开，防止「表格里都勾了 A」伪装成实测口径。
//
// slim-s2-market-analysis：主任务轴重排（纯呈现层）——状态行 + 判断卡 + 基本面/供需比
// 双栏为主脸，日内要素 / 24 时段表默认折叠；二轮收紧如实下线三项：预置示例形态（演示
// 脚手架，采集拉取已覆盖）、外送耦合推演 UI（默认情景计算保留仅供 AI 上下文）、八源验签
// 手动清单（全默认下恒满分，门禁由自建口径封顶决定，探针接入时恢复异常分支 UI）。
// 写回 payload 与 AI 上下文字段集合一字未动。
import { computed, ref } from 'vue'
import { Save } from 'lucide-vue-next'
import {
  assessSlots,
  coalPriceToThermalAnchor,
  exportCouplingImpact,
  provincePriceCompare,
  REGIME_LABEL,
  summarizeDay,
  thermalAnchorVsPriceCenter,
  type SupplyDemandInput
} from 'shared/trading-rules/supply-demand.mjs'
import {
  assessIntegrity,
  REQUIRED_SOURCES,
  USAGE_GATE_LABEL
} from 'shared/trading-rules/data-integrity.mjs'
import { savePreflight, type DeclarationOrder } from '@/services/declarations'
import { useSaveState } from '@/composables/useSaveState'
import { fetchCaptured } from '@/services/captured'
import {
  fetchFundamentals,
  isTrustedSource,
  saveFundamentals,
  SOURCE_KIND_LABEL,
  type FundamentalField,
  type SourceKind
} from '@/services/trading/fundamentalsClient'
import { currentRegion } from '@/services/region/regionContext'
import { reviewFocusOf } from 'shared/trading-rules/position-review.mjs'
import { activeStanceType } from '@/services/stance/stanceContext'
import AgentChatPanel from '@/components/agent/AgentChatPanel.vue'
import DataStatusLine from './DataStatusLine.vue'
import type { DataStatusItem } from './DataStatusLine.vue'
import type { StageId } from '@/data/workflowStages'

const props = defineProps<{ declaration: DeclarationOrder | null; targetDate: string }>()
const emit = defineEmits<{ updated: [d: DeclarationOrder]; go: [stage: StageId] }>()

type SlotRow = SupplyDemandInput & { label: string }

/** 初始表值（原「常规」预置；slim-s2 二轮起预置示例形态 UI 下线，仅作为开局默认数据）。 */
const INITIAL_SLOTS: SlotRow[] = [
  { label: '低谷 00–08', dispatchableMaxMw: 20000, renewableForecastMw: 9000, netImportMw: 0, systemLoadMw: 14000, exportPlanMw: 6000, reserveMw: 1000 },
  { label: '平段 08–17', dispatchableMaxMw: 20000, renewableForecastMw: 8000, netImportMw: 0, systemLoadMw: 18000, exportPlanMw: 6000, reserveMw: 1000 },
  { label: '高峰 17–21', dispatchableMaxMw: 20000, renewableForecastMw: 4000, netImportMw: 0, systemLoadMw: 21000, exportPlanMw: 6500, reserveMw: 1200 },
  { label: '晚谷 21–24', dispatchableMaxMw: 20000, renewableForecastMw: 7000, netImportMw: 0, systemLoadMw: 16000, exportPlanMw: 6000, reserveMw: 1000 }
]

const slots = ref<SlotRow[]>(INITIAL_SLOTS.map((s) => ({ ...s })))

// 逐格来源跟踪（可信链）
// 六列 × 四段，每格一个来源标记。预置示例=manual（人工假设），采集拉取=capture，
// 基本面库载入=库里存的来源。展示徽章 + 注入 AI 上下文时按来源区分"数据/假设"。
type FieldKey = keyof Omit<SlotRow, 'label'>
const FIELD_TO_DB: Record<FieldKey, FundamentalField> = {
  dispatchableMaxMw: 'dispatchable_max_mw',
  renewableForecastMw: 'renewable_forecast_mw',
  netImportMw: 'net_import_mw',
  systemLoadMw: 'system_load_mw',
  exportPlanMw: 'export_plan_mw',
  reserveMw: 'reserve_mw'
}
const FIELD_KEYS = Object.keys(FIELD_TO_DB) as FieldKey[]
const SLOT_DB_LABELS = ['00-08', '08-17', '17-21', '21-24']

function blankSources(): Record<string, SourceKind> {
  const out: Record<string, SourceKind> = {}
  for (let i = 0; i < 4; i += 1) for (const f of FIELD_KEYS) out[`${i}:${f}`] = 'manual'
  return out
}
/** 格来源表，键 `${slotIndex}:${field}`。手改任一格即打回 manual（见模板 @input）。 */
const cellSources = ref<Record<string, SourceKind>>(blankSources())
function markManual(slotIndex: number, field: FieldKey) {
  cellSources.value[`${slotIndex}:${field}`] = 'manual'
}
function sourceOf(slotIndex: number, field: FieldKey): SourceKind {
  return cellSources.value[`${slotIndex}:${field}`] ?? 'manual'
}

// 基本面库（PG · 迁移 012）：保存/载入，缺什么录什么
const dbBusy = ref(false)
const dbMsg = ref('')
const dbError = ref('')

async function loadFromDb() {
  dbBusy.value = true
  dbMsg.value = ''
  dbError.value = ''
  try {
    const entries = await fetchFundamentals(currentRegion.value.id, props.targetDate)
    if (!entries.length) {
      dbMsg.value = `基本面库无 ${props.targetDate} 记录——可在下表录入后「保存到库」`
      return
    }
    let applied = 0
    for (const e of entries) {
      // 煤价（日级）与小时持仓（24 槽）单独落位，其余按四代表时段落格
      if (e.slot_label === 'all-day' && e.field === 'coal_price_yuan_per_ton') {
        coalPrice.value = e.value_mw
        coalSource.value = e.source_kind
        applied += 1
        continue
      }
      const hourMatch = /^h(\d{2})$/.exec(e.slot_label)
      if (hourMatch && e.field === 'mlt_position_mwh') {
        const h = Number(hourMatch[1])
        if (h >= 0 && h < 24) {
          hourlyPosition.value[h] = e.value_mw
          applied += 1
        }
        continue
      }
      const slotIndex = SLOT_DB_LABELS.indexOf(e.slot_label)
      const field = (Object.entries(FIELD_TO_DB).find(([, db]) => db === e.field)?.[0] ?? null) as FieldKey | null
      if (slotIndex < 0 || !field) continue
      ;(slots.value[slotIndex][field] as number) = e.value_mw
      cellSources.value[`${slotIndex}:${field}`] = e.source_kind
      applied += 1
    }
    dbMsg.value = `已载入 ${applied} 格（${currentRegion.value.id} · ${props.targetDate}），来源随库`
  } catch (e) {
    dbError.value = e instanceof Error ? e.message : '基本面库读取失败'
  } finally {
    dbBusy.value = false
  }
}

async function saveToDb() {
  dbBusy.value = true
  dbMsg.value = ''
  dbError.value = ''
  try {
    const entries = slots.value.flatMap((slot, i) =>
      FIELD_KEYS.map((f) => ({
        slot: SLOT_DB_LABELS[i],
        field: FIELD_TO_DB[f],
        valueMw: Number(slot[f]),
        sourceKind: sourceOf(i, f),
        credibility: (isTrustedSource(sourceOf(i, f)) ? 'B' : 'C') as 'B' | 'C'
      }))
    ).filter((e) => Number.isFinite(e.valueMw))
    if (coalPrice.value !== null && Number.isFinite(coalPrice.value)) {
      entries.push({
        slot: 'all-day',
        field: 'coal_price_yuan_per_ton',
        valueMw: coalPrice.value,
        sourceKind: coalSource.value,
        credibility: isTrustedSource(coalSource.value) ? ('B' as const) : ('C' as const)
      })
    }
    hourlyPosition.value.forEach((v, h) => {
      if (v !== null && Number.isFinite(v)) {
        entries.push({
          slot: `h${String(h).padStart(2, '0')}`,
          field: 'mlt_position_mwh',
          valueMw: v,
          sourceKind: 'company',
          credibility: 'C' as const
        })
      }
    })
    const saved = await saveFundamentals(currentRegion.value.id, props.targetDate, entries)
    dbMsg.value = `已保存 ${saved} 格到基本面库（含来源与录入人留痕）`
  } catch (e) {
    dbError.value = e instanceof Error ? e.message : '保存失败（基本面库需 PG 在线）'
  } finally {
    dbBusy.value = false
  }
}

// 从采集库自动拉取基本面（云南 yn_system_forecast 族，真实采集回放）
// 该族按 metric 分文件：load_forecast / new_energy_forecast_d1 / inter_provincial_forecast /
// non_market_forecast，均为 (operateDate, targetDate, timePoint) 96 点时序。拉到什么标什么：
// 负荷/新能源/外送三项来自调度预测（B 级），可调机组与备用该族没有，保留手工值并如实提示。
const pulling = ref(false)
const pullMsg = ref('')
const pullError = ref('')
/** 采集源只有云南调度预测：非云南禁用「采集拉取」（跨省串数红线，见 pullFundamentals）。 */
const isYunnanRegion = computed(() => currentRegion.value.id === 'yunnan')
/** 拉到的口径说明（哪些字段来自采集、哪些仍是手工），随写回一并留痕。 */
const pulledFields = ref<string[]>([])

const SLOT_RANGES: Array<[number, number]> = [[0, 8], [8, 17], [17, 21], [21, 24]] // 对应四个代表时段

function avgInRange(rows: Array<{ timePoint: string; value: number }>, range: [number, number]): number | null {
  const vals = rows
    .filter((r) => {
      const h = Number(r.timePoint.slice(0, 2))
      return h >= range[0] && h < range[1]
    })
    .map((r) => r.value)
    .filter((v) => Number.isFinite(v))
  if (!vals.length) return null
  return Math.round(vals.reduce((a, b) => a + b, 0) / vals.length)
}

async function pullFundamentals() {
  // 现货审计二轮 P2：采集源只有云南调度预测（yn_system_forecast），非云南地区拉取
  // 会把云南数值灌进当前地区的基本面格子、还以可信 capture 口径落库——跨省串读
  // 踩「非本地区缺数据只能诚实为空」红线。非云南直接拒绝并说明，不拉取。
  if (currentRegion.value.id !== 'yunnan') {
    pullError.value = `采集库只有云南调度预测；${currentRegion.value.name}无本省采集源，基本面请手工填写（来源标人工）。`
    pullMsg.value = ''
    return
  }
  pulling.value = true
  pullMsg.value = ''
  pullError.value = ''
  pulledFields.value = []
  try {
    const metricFiles: Array<{ match: string; field: FieldKey; label: string }> = [
      { match: 'load_forecast', field: 'systemLoadMw', label: '统调负荷' },
      { match: 'new_energy_forecast_d1', field: 'renewableForecastMw', label: '新能源' },
      { match: 'inter_provincial_forecast', field: 'exportPlanMw', label: '外送计划' }
    ]
    const applied: string[] = []
    for (const mf of metricFiles) {
      const body = await fetchCaptured<{ data?: Array<{ targetDate?: string; operateDate: string; timePoint: string; value: number; region?: string }> }>(
        'yn_system_forecast', mf.match, { region: 'yunnan', limit: 4000 }
      )
      let rows = (body.data ?? []) as Array<{ targetDate?: string; operateDate: string; timePoint: string; value: number; region?: string }>
      // ⚠️ 同一时点可能存两套口径：region='all'（南网全网五省）与省内标签（负荷/新能源
      // 是 'yn'，外送是 '云南总送出'）。省内供需判断必须排除 'all'，混算会把全网量
      // 平均进来，数值面目全非（实测：混算 13367 vs 省内真值 4426 MW）。
      const provincial = rows.filter((r) => r.region !== 'all')
      if (provincial.length) rows = provincial
      if (!rows.length) continue
      // 取标的日切片；标的日无数据则取最近一个目标日（并在口径里说明）
      let dayRows = rows.filter((r) => (r.targetDate ?? r.operateDate) === props.targetDate)
      let usedDate = props.targetDate
      if (!dayRows.length) {
        const latest = rows.map((r) => r.targetDate ?? r.operateDate).sort().at(-1)!
        dayRows = rows.filter((r) => (r.targetDate ?? r.operateDate) === latest)
        usedDate = latest
      }
      let hit = 0
      slots.value.forEach((slot, i) => {
        const v = avgInRange(dayRows, SLOT_RANGES[i])
        if (v !== null) {
          ;(slot[mf.field] as number) = v
          cellSources.value[`${i}:${mf.field}`] = 'capture'
          hit += 1
        }
      })
      if (hit > 0) applied.push(`${mf.label}（${usedDate === props.targetDate ? '标的日' : `最近日 ${usedDate}`}）`)
    }
    if (!applied.length) {
      pullError.value = '采集库无可用切片——基本面维持手工值'
      return
    }
    pulledFields.value = applied
    pullMsg.value = `已拉取：${applied.join('、')}；可调机组与备用该族不含，仍需人工核定`
  } catch (e) {
    pullError.value = e instanceof Error ? e.message : '采集库拉取失败'
  } finally {
    pulling.value = false
  }
}

// 煤价维度（手册 S2 基本面第四项：火电边际成本的锚）
// 煤价不进供需比公式（它是价格侧的锚，不是量的侧的量），换算成火电边际成本后与
// 分档价格中枢对照，中枢是季度拟合的经验值，煤价逐日变，二者脱节即提示修正。
const coalPrice = ref<number | null>(null)
const coalSource = ref<SourceKind>('manual')
const coalAnchor = computed(() => coalPriceToThermalAnchor(coalPrice.value))
const anchorVerdict = computed(() =>
  thermalAnchorVsPriceCenter(
    coalAnchor.value?.totalYuanPerMwh ?? null,
    daySummary.value.priceCenterLow !== null && daySummary.value.priceCenterHigh !== null
      ? [daySummary.value.priceCenterLow, daySummary.value.priceCenterHigh]
      : null
  )
)

// 昨日偏差 → 今日判断（手册 S2 步骤④：评估昨日偏差是否影响今日判断）
// S1 的复盘结论写在同一张单据的 morningReview 段，本面板读它并要求显式表态：
// 昨日偏差是否改变今日判断。不表态（not_reviewed）写回时留 null，不默认「无影响」。
type YesterdayImpact = 'unchanged' | 'reinforce' | 'weaken'
const yesterdayReview = computed(() => props.declaration?.preflight?.morningReview ?? null)
const yesterdayImpact = ref<YesterdayImpact | 'not_reviewed'>('not_reviewed')
const yesterdayNote = ref('')

// 24 时段聚合视图（2026-08-13 会议拍板：底层 96 点存储，24 时段仅作聚合展示）
// 三列：需求电量（采集负荷预测 96 点聚到小时，无采集则人工）/ 中长期持仓（人工或
// 合约库，未接前人工）/ 差额（需求−持仓 = 现货敞口）。聚合只做展示，不改存储。
const HOURLY_LABELS = Array.from({ length: 24 }, (_, h) => `${String(h).padStart(2, '0')}:00`)
const hourlyDemand = ref<Array<number | null>>(Array(24).fill(null))
const hourlyDemandSource = ref<'capture' | 'manual'>('manual')
const hourlyDemandDate = ref('')
const hourlyPosition = ref<Array<number | null>>(Array(24).fill(null))
const hourlyGap = computed(() =>
  hourlyDemand.value.map((d, h) =>
    d !== null && hourlyPosition.value[h] !== null
      ? Math.round((d - (hourlyPosition.value[h] as number)) * 10) / 10
      : null
  )
)
const hourlyTotals = computed(() => {
  const sum = (a: Array<number | null>) => a.reduce<number>((acc, v) => acc + (v ?? 0), 0)
  const demandKnown = hourlyDemand.value.some((v) => v !== null)
  const positionKnown = hourlyPosition.value.some((v) => v !== null)
  return {
    demandMwh: demandKnown ? Math.round(sum(hourlyDemand.value) * 10) / 10 : null,
    positionMwh: positionKnown ? Math.round(sum(hourlyPosition.value) * 10) / 10 : null,
    gapMwh: demandKnown && positionKnown ? Math.round((sum(hourlyDemand.value) - sum(hourlyPosition.value)) * 10) / 10 : null
  }
})

/** 从采集库拉标的日负荷预测 96 点 → 聚合为 24 小时需求电量（MWh，每小时均值 MW×1h）。 */
const hourlyPulling = ref(false)
const hourlyPullMsg = ref('')
const hourlyPullError = ref('')
async function pullHourlyDemand() {
  hourlyPulling.value = true
  hourlyPullMsg.value = ''
  hourlyPullError.value = ''
  try {
    const body = await fetchCaptured<{ data?: Array<{ targetDate?: string; operateDate: string; timePoint: string; value: number; region?: string }> }>(
      'yn_system_forecast', 'load_forecast', { region: 'yunnan', limit: 4000 }
    )
    let rows = (body.data ?? []) as Array<{ targetDate?: string; operateDate: string; timePoint: string; value: number; region?: string }>
    rows = rows.filter((r) => r.region !== 'all') // 省内口径（同上：排除南网全网 'all'）
    if (!rows.length) throw new Error('采集库无负荷预测切片')
    let dayRows = rows.filter((r) => (r.targetDate ?? r.operateDate) === props.targetDate)
    let usedDate = props.targetDate
    if (!dayRows.length) {
      const latest = rows.map((r) => r.targetDate ?? r.operateDate).sort().at(-1)!
      dayRows = rows.filter((r) => (r.targetDate ?? r.operateDate) === latest)
      usedDate = latest
    }
    const next: Array<number | null> = Array(24).fill(null)
    for (let h = 0; h < 24; h += 1) {
      const vals = dayRows
        .filter((r) => Number(r.timePoint.slice(0, 2)) === h)
        .map((r) => r.value)
        .filter((v) => Number.isFinite(v))
      if (vals.length) next[h] = Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10
    }
    if (!next.some((v) => v !== null)) throw new Error('切片无可聚合时点')
    hourlyDemand.value = next
    hourlyDemandSource.value = 'capture'
    hourlyDemandDate.value = usedDate
    hourlyPullMsg.value = `需求电量已按 ${usedDate === props.targetDate ? '标的日' : `最近日 ${usedDate}`} 负荷预测聚到 24 小时`
  } catch (e) {
    hourlyPullError.value = e instanceof Error ? e.message : '聚合拉取失败——需求电量可逐时人工填'
  } finally {
    hourlyPulling.value = false
  }
}

// 省内 vs 省外比价（会议 §4：判断「先做省内还是省外」）
const domesticPrice = ref<number | null>(null)
const externalPrice = ref<number | null>(null)
const externalPriceSource = ref<SourceKind>('manual')
const priceCompare = computed(() => provincePriceCompare(domesticPrice.value, externalPrice.value))

// 外送公告（会议 §4：外送有无可做交易作为基本面因素）
const exportNotice = ref('')

/** 日内要素短结论（判断卡单行展示）：锚对照与比价方向各给一枚结论 chip。 */
const anchorHintShort = computed(() => {
  if (!anchorVerdict.value) return null
  return anchorVerdict.value.verdict === 'anchor_within'
    ? '锚在中枢内'
    : anchorVerdict.value.verdict === 'anchor_above_center'
      ? '锚高于中枢'
      : '锚低于中枢'
})
const compareHintShort = computed(() => {
  if (!priceCompare.value) return null
  return priceCompare.value.side === 'domestic'
    ? '先省内'
    : priceCompare.value.side === 'external'
      ? '先省外'
      : '省内外无显著差异'
})

// AI 晨间分析（L1 简报 + L2 追问，共用一个面板）
// 把当前面板的全部推演结果注入为上下文：AI 拿到的是"人已经算出来的东西"，
// 它的职责是给出态势判断的理由、挑出规则表结论可疑的地方、提示最该防的时段，
// 产出是分析初稿与反对意见，不替人拍板；写回仍走人确认的「写回」按钮。
const aiOpen = ref(false)
/**
 * 注入 AI 的基本面逐格带来源（trusted = dispatch/capture 采集口径，
 * untrusted = company/manual 假设口径）。AI 无法验证数字真伪，可信链的做法是：
 * ① 录入侧强制来源（服务端 400 拒无来源数字）+ 录入人留痕；
 * ② 注入侧逐格标注，简报里强制 AI 把"基于数据的判断"与"基于假设的推演"分开写。
 */
const aiContext = computed(() => ({
  targetDate: props.targetDate,
  region: currentRegion.value.id,
  fundamentals: slots.value.map((s, i) => ({
    slot: s.label,
    fields: FIELD_KEYS.map((f) => ({
      field: FIELD_TO_DB[f],
      valueMw: s[f],
      source: sourceOf(i, f),
      trusted: isTrustedSource(sourceOf(i, f))
    }))
  })),
  slotAssessments: assessments.value,
  daySummary: daySummary.value,
  exportCoupling: coupling.value,
  coal: {
    priceYuanPerTon: coalPrice.value,
    source: coalSource.value,
    anchorYuanPerMwh: coalAnchor.value?.totalYuanPerMwh ?? null,
    anchorAssumptions: coalAnchor.value?.assumptions ?? null,
    anchorVsPriceCenter: anchorVerdict.value?.verdict ?? null
  },
  yesterdayImpact:
    yesterdayImpact.value === 'not_reviewed'
      ? null
      : { impact: yesterdayImpact.value, note: yesterdayNote.value || null, yesterdayReview: yesterdayReview.value },
  provincePriceCompare: priceCompare.value
    ? { domesticYuanPerMwh: domesticPrice.value, externalYuanPerMwh: externalPrice.value, ...priceCompare.value }
    : null,
  exportNotice: exportNotice.value || null,
  hourlyExposure: hourlyTotals.value,
  integrityGate: {
    gate: integrityVerdict.value.gate,
    completenessRate: integrityVerdict.value.completenessRate,
    weakest: integrityVerdict.value.weakestCredibility
  },
  yesterdayReview: props.declaration?.preflight?.morningReview ?? null
}))
const trustedCellCount = computed(() =>
  Object.values(cellSources.value).filter((s) => isTrustedSource(s)).length
)
const aiQuestion = computed(() =>
  `请基于注入的 S2 早间分析上下文出一份晨间分析简报。` +
  `注意：基本面逐格带 source/trusted 标注（trusted=采集或调度口径的数据，untrusted=人工假设或公司自报口径），` +
  `当前 ${trustedCellCount.value}/24 格为可信数据——**凡建立在 untrusted 格上的结论必须明确标注"基于假设"**，不得当数据陈述。` +
  `简报结构：① 逐时段供需态势判断是否合理及理由；` +
  `② 规则表结论的可疑点（分档表是经验值，供需比贴近档位边界时要提示）；` +
  `③ 今天最该防的时段与原因；④ 给 S3 方向判断的倾向建议（增持/减持/观望）及置信度理由；` +
  `⑤ 无法判断的部分与需要补的数据。`
)

const assessments = computed(() => assessSlots(slots.value))
const daySummary = computed(() => summarizeDay(assessments.value))

// 外送耦合推演（slim-s2 二轮起 UI 下线）：默认情景计算保留——高峰段 +2000MW 的档位
// 影响仅供 aiContext.exportCoupling，字段集合与下线前一致；UI 回补走 git 历史。
const exportDelta = ref(2000)
const couplingSlotIndex = ref(2) // 默认看高峰段
const coupling = computed(() =>
  exportCouplingImpact(slots.value[couplingSlotIndex.value], exportDelta.value)
)

function regimeClass(regime: string | null) {
  if (!regime) return 'r-unknown'
  if (regime === 'extreme_surplus' || regime === 'surplus') return 'r-loose'
  if (regime === 'balanced') return 'r-mid'
  return 'r-tight'
}

// 八源验签（自动探针未接期间的静态默认口径）：slim-s2 二轮起手动勾验清单下线——
// 八源默认全到位/B 级时验签恒满分，写回门禁实际由下方「自建口径封顶」决定，
// 手动表格不产生任何信息增量。自动验签探针接入后由其产出逐源状态并恢复异常分支 UI。
const DEFAULT_SOURCES = REQUIRED_SOURCES.map((s) => ({
  ...s,
  present: true,
  credibility: 'B' as const,
  timestamp: '07:30',
  completeness: 1,
  mock: false
}))
const integrityVerdict = computed(() => assessIntegrity(DEFAULT_SOURCES))

/**
 * 写回口径的封顶：基本面由使用者给定期间，门禁上限「可参考」、可信度上限 C。
 * 验签结果只能把口径压得更低（缺源→仅展示、含 D 级→降级），不能抬得更高，
 * 表格里全勾 A 不等于接上了调度边界条件包。
 */
const GATE_ORDER = ['declarable', 'reference', 'display_only'] as const
const CRED_ORDER = ['A', 'B', 'C', 'D'] as const
const effectiveGate = computed(() => {
  const fromIntegrity = GATE_ORDER.indexOf(integrityVerdict.value.gate as (typeof GATE_ORDER)[number])
  const cap = GATE_ORDER.indexOf('reference')
  return GATE_ORDER[Math.max(fromIntegrity, cap)]
})
const effectiveCredibility = computed(() => {
  const fromIntegrity = CRED_ORDER.indexOf(integrityVerdict.value.weakestCredibility as (typeof CRED_ORDER)[number])
  const cap = CRED_ORDER.indexOf('C')
  return CRED_ORDER[Math.max(fromIntegrity, cap)]
})

/** 数据与口径状态行（slim-s2）：原脚注与封顶说明收进一行摘要。诚实边界——阻断提示
 * （S1 未写回）与采集/库操作三态不进 items，仍在卡内直显；Mock/原型态标识同理。 */
const statusItems = computed<DataStatusItem[]>(() => [
  {
    tone: 'info',
    text: pulledFields.value.length
      ? `基本面口径：负荷/新能源/外送已接云南采集库调度预测（${pulledFields.value.join('、')}），可调机组与备用仍为人工核定`
      : '基本面口径：当前由使用者给定，可从基本面卡头「采集拉取」接入云南调度预测（负荷/新能源/外送）'
  },
  {
    tone: 'info',
    text: `可信数据 ${trustedCellCount.value}/24 格（采集/调度口径），其余为人工或公司假设；AI 简报对假设上的结论强制标注「基于假设」`
  },
  {
    tone: 'caveat',
    text: `写回口径如实封顶：自建模型（C 级）、门禁「${USAGE_GATE_LABEL[effectiveGate.value]}」（自动验签探针未接，接前不放开）——申报暴露系数会因此减半`
  }
])

// 立场目标（#2005）：同一态势判断，三类身份的策略方向相反
const positionGoal = computed(() => reviewFocusOf(activeStanceType.value)?.goal ?? null)

// 写回
// 写回三态走 useSaveState 单源（spot-trading-module-hygiene 收口六份逐字副本）
const { saving, saveMsg, saveError, runSave } = useSaveState()
const written = computed(() => props.declaration?.preflight?.dataGate ?? null)

async function writeBack() {
  if (!props.declaration || !daySummary.value.dominantRegime) return
  const declaration = props.declaration
  const dominantRegime = daySummary.value.dominantRegime
  await runSave(async () => {
    const s = daySummary.value
    const updated = await savePreflight(
      declaration.id,
      'dataGate',
      {
        // 市场判断（S2 的主产出）
        regime: dominantRegime,
        coverage: s.coverage,
        priceCenterLow: s.priceCenterLow,
        priceCenterHigh: s.priceCenterHigh,
        tightestSlot: s.tightestSlot,
        loosestSlot: s.loosestSlot,
        // 数据口径：验签结论参与，但被自建口径封顶（见 effectiveGate 注释）
        gate: effectiveGate.value,
        completenessRate: integrityVerdict.value.completenessRate,
        weakestCredibility: effectiveCredibility.value,
        degradeLevel: integrityVerdict.value.degradeLevel,
        // 煤价维度与中枢对照（手册 S2 基本面第四项）
        coalPriceYuanPerTon: coalPrice.value,
        coalAnchorYuanPerMwh: coalAnchor.value?.totalYuanPerMwh ?? null,
        coalAnchorVerdict: anchorVerdict.value?.verdict ?? null,
        // 昨日偏差是否影响今日判断（手册 S2 步骤④；未表态留 null 不默认无影响）
        yesterdayImpact:
          yesterdayImpact.value === 'not_reviewed'
            ? null
            : { impact: yesterdayImpact.value, note: yesterdayNote.value || null },
        // 省内外比价与外送公告（会议 §4 要素）
        provinceCompare: priceCompare.value
          ? { domesticYuanPerMwh: domesticPrice.value, externalYuanPerMwh: externalPrice.value, diffPct: priceCompare.value.diffPct, side: priceCompare.value.side }
          : null,
        exportNotice: exportNotice.value || null,
        // 24 时段聚合汇总（逐时明细在基本面库 h00–h23 槽，payload 只带总数）
        hourlyExposure: hourlyTotals.value
      },
      `S2 早间分析：${REGIME_LABEL[dominantRegime]}，中枢 ${s.priceCenterLow}–${s.priceCenterHigh} 元/MWh`
    )
    emit('updated', updated)
    return '市场判断已写回，S3 方向判断可直接读取'
  })
}
</script>

<template>
  <div class="ma">
    <DataStatusLine :items="statusItems" />

    <!-- 今日市场判断（S2 主产出，视觉主角）：整行呈现 -->
    <section class="ma-verdict" :class="regimeClass(daySummary.dominantRegime)">
      <div class="ma-verdict-main">
        <span class="ma-regime">
          {{ daySummary.dominantRegime ? REGIME_LABEL[daySummary.dominantRegime] : '无法判断' }}
        </span>
        <el-tooltip placement="top" :show-after="150">
          <template #content>
            <p>主导态势取<strong>时段数最多</strong>的档位而非平均供需比——平均会把「多数偏紧 + 个别极松」抹成宽松，恰好抹掉当天最该防的时段。</p>
          </template>
          <span class="ma-info" tabindex="0">ⓘ</span>
        </el-tooltip>
        <span v-if="daySummary.priceCenterLow !== null" class="ma-center">
          均价指引 {{ daySummary.priceCenterLow }}–{{ daySummary.priceCenterHigh }} 元/MWh
        </span>
        <span v-if="daySummary.coverage" class="ma-cov">主导档覆盖 {{ (daySummary.coverage * 100).toFixed(0) }}% 时段</span>
      </div>
      <p class="ma-summary">{{ daySummary.summary }}</p>

      <!-- 日内要素一行（slim-s2 三轮：由折叠行升入判断卡，与判断同屏——煤价锚对照的正是
           上方价格中枢，比价答的正是给 S3 的方向倾向；说明文字收进行头 ⓘ） -->
      <div class="ma-dayline">
        <el-tooltip placement="top" :show-after="150">
          <template #content>
            <p>煤价是火电边际成本的锚（换算式可复核）；比价答「先做省内还是省外」；外送公告作为基本面要素留痕。</p>
          </template>
          <span class="ma-dayline-label">日内要素 <span class="ma-info">ⓘ</span></span>
        </el-tooltip>
        <label>
          煤价
          <span class="ma-cell">
            <input v-model.number="coalPrice" type="number" min="0" placeholder="元/吨" @input="coalSource = 'manual'" />
            <i class="ma-src" :class="`src-${coalSource}`">{{ SOURCE_KIND_LABEL[coalSource] }}</i>
          </span>
        </label>
        <template v-if="coalAnchor">
          <span class="ma-dayline-calc">→ 锚 <strong>{{ coalAnchor.totalYuanPerMwh }}</strong></span>
          <el-tooltip placement="top" :show-after="150" :content="`燃料 ${coalAnchor.fuelYuanPerMwh} + 其它变动；标煤 ${coalAnchor.standardCoalYuanPerTon} 元/吨标煤。${coalAnchor.assumptions}`">
            <em v-if="anchorHintShort" class="ma-chip" :class="anchorVerdict?.verdict">{{ anchorHintShort }}</em>
          </el-tooltip>
        </template>
        <span class="ma-dayline-sep" aria-hidden="true" />
        <label>省内 <input v-model.number="domesticPrice" type="number" min="0" placeholder="元/MWh" /></label>
        <el-tooltip placement="top" :show-after="150" content="取供需分档价格中枢的中值作省内参考（来源=本页 S2 推演）">
          <button
            type="button"
            class="ma-compare-fill"
            :disabled="daySummary.priceCenterLow === null || daySummary.priceCenterHigh === null"
            @click="domesticPrice = daySummary.priceCenterLow !== null && daySummary.priceCenterHigh !== null
              ? Math.round((daySummary.priceCenterLow + daySummary.priceCenterHigh) / 2)
              : null"
          >
            取中枢中值
          </button>
        </el-tooltip>
        <label>省外
          <span class="ma-cell">
            <input
              v-model.number="externalPrice"
              type="number"
              min="0"
              placeholder="元/MWh"
              @input="externalPriceSource = 'manual'"
            />
            <i class="ma-src" :class="`src-${externalPriceSource}`">{{ SOURCE_KIND_LABEL[externalPriceSource] }}</i>
          </span>
        </label>
        <em v-if="compareHintShort" class="ma-chip" :class="priceCompare?.side">{{ compareHintShort }}</em>
        <span class="ma-dayline-sep" aria-hidden="true" />
        <label class="ma-dayline-notice">公告
          <input v-model="exportNotice" type="text" placeholder="如：华东通道 11:00–13:00 有余量窗口" />
        </label>
      </div>

      <!-- 昨日偏差 → 今日判断（手册 S2 步骤④）：文档要求的唯一主任务输入；S1 未写回为阻断态直显 -->
      <div class="ma-yday">
        <template v-if="yesterdayReview">
          <div class="ma-yday-facts">
            <span>S1 复盘（{{ yesterdayReview.reviewedDate }}）：主因
              <strong>{{ yesterdayReview.causeLabel ?? '—' }}</strong>
              <em v-if="yesterdayReview.pendingAnalysis" class="ma-yday-pending">待分析</em>
            </span>
            <span v-if="yesterdayReview.clearRate !== null && yesterdayReview.clearRate !== undefined">中标率 {{ (yesterdayReview.clearRate * 100).toFixed(1) }}%</span>
            <span v-if="yesterdayReview.executionDeviationMwh !== null && yesterdayReview.executionDeviationMwh !== undefined">执行偏差 {{ yesterdayReview.executionDeviationMwh }} MWh</span>
          </div>
          <div v-if="yesterdayReview.lessons" class="ma-yday-lessons">要点：{{ yesterdayReview.lessons }}</div>
          <div class="ma-yday-input">
            <label>
              昨日偏差是否影响今日判断
              <select v-model="yesterdayImpact">
                <option value="not_reviewed">（未表态）</option>
                <option value="unchanged">不改变今日判断</option>
                <option value="reinforce">强化今日判断</option>
                <option value="weaken">削弱/推翻今日判断</option>
              </select>
            </label>
            <input
              v-model="yesterdayNote"
              type="text"
              class="ma-yday-note"
              placeholder="影响说明（选了「削弱/推翻」时必填：哪个判断要重估）"
              :required="yesterdayImpact === 'weaken'"
            />
          </div>
        </template>
        <p v-else class="ma-warn-inline">
          S1 晨会复盘未写回——无法评估昨日偏差对今日判断的影响。
          <button type="button" class="ma-jump" @click="emit('go', 'morning-review')">回 S1 补复盘</button>
        </p>
      </div>

      <p v-if="positionGoal" class="ma-pos-goal">
        当前立场目标：{{ positionGoal }}——下方建议按此立场解读。
        <el-tooltip placement="top" :show-after="150" content="同一态势判断，三类身份的策略方向相反（#2005）">
          <span class="ma-info" tabindex="0">ⓘ</span>
        </el-tooltip>
      </p>
      <div class="ma-actions">
        <button type="button" class="primary" :disabled="!declaration || !daySummary.dominantRegime || saving" @click="writeBack">
          <Save :size="13" /> {{ written?.regime ? '更新写回' : '写回并进入 S3 方向判断' }}
        </button>
        <button type="button" class="ghost" @click="emit('go', 'direction')">跳到 S3 方向判断</button>
        <span v-if="saveMsg" class="ma-ok">{{ saveMsg }}</span>
        <span v-if="saveError" class="ma-err">{{ saveError }}</span>
        <span v-if="written?.regime" class="ma-written">
          已写回：{{ REGIME_LABEL[written.regime as keyof typeof REGIME_LABEL] }}（{{ written.writtenBy }}）
        </span>
      </div>
    </section>

    <!-- 主区一行两列：基本面（左，输入）∥ 供需比与边际机组（右，推演）；窄屏（≤1240px）单列 -->
    <div class="ma-row">
      <!-- 基本面输入：逐格带来源徽章（可信链的展示端） -->
      <section class="ma-panel">
        <h3>
          基本面（分时段 · 逐格标来源）
          <el-tooltip placement="top" :show-after="150">
            <template #content>
              <p>单位 MW；外送计入分母（外送增加等价于省内净负荷增加）。</p>
              <p>采集 = 调度预测采集；人工 = 估计/假设，AI 只当假设用。</p>
            </template>
            <span class="ma-info" tabindex="0">ⓘ</span>
          </el-tooltip>
        </h3>
        <div class="ma-tools">
          <el-tooltip placement="top" :show-after="150" :content="isYunnanRegion ? '从采集库拉取云南调度预测（yn_system_forecast 族：负荷/新能源/外送三项按标的日聚合；可调机组与备用该族不含，维持人工值）' : '采集库只有云南调度预测，当前地区无本省采集源；基本面请手工填写'">
            <button type="button" :disabled="pulling || !isYunnanRegion" @click="pullFundamentals">
              {{ pulling ? '拉取中…' : '采集拉取' }}
            </button>
          </el-tooltip>
          <el-tooltip placement="top" :show-after="150" content="从 PG 基本面库载入本日记录（含逐格来源与煤价、小时持仓）；无记录时提示先录入">
            <button type="button" :disabled="dbBusy" @click="loadFromDb">库载入</button>
          </el-tooltip>
          <button type="button" :disabled="dbBusy" @click="saveToDb">保存到库</button>
        </div>
        <!-- 采集/库操作三态直显（诚实边界：不折叠、不进状态行） -->
        <p v-if="pullMsg" class="ma-pipe-ok">{{ pullMsg }}</p>
        <p v-if="pullError" class="ma-pipe-err">{{ pullError }}</p>
        <p v-if="dbMsg" class="ma-pipe-ok">{{ dbMsg }}</p>
        <p v-if="dbError" class="ma-pipe-err">{{ dbError }}</p>
        <table class="ma-table">
          <thead>
            <tr>
              <th>时段</th>
              <th>
                <el-tooltip placement="top" :show-after="150">
                  <template #content>
                    <p>全网口径（调度侧数据，市场成员通常拿不到全量）——注意与「公司代理机组容量」是两个不同的量，不可混填。</p>
                    <p>采集库没有此口径——从调度渠道拿到后在此录入并「保存到库」，手改任一格来源即打回「人工」。</p>
                  </template>
                  <span>全网可调机组 <span class="ma-info">ⓘ</span></span>
                </el-tooltip>
              </th>
              <th>新能源</th><th>净外购</th><th>统调负荷</th><th>外送计划</th><th>备用</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(row, i) in slots" :key="row.label">
              <td class="ma-slot">{{ row.label }}</td>
              <td v-for="f in FIELD_KEYS" :key="f" :class="{ 'ma-export': f === 'exportPlanMw' }">
                <span class="ma-cell">
                  <input v-model.number="row[f]" type="number" @input="markManual(i, f)" />
                  <i class="ma-src" :class="`src-${sourceOf(i, f)}`">{{ SOURCE_KIND_LABEL[sourceOf(i, f)] }}</i>
                </span>
              </td>
            </tr>
          </tbody>
        </table>
      </section>

      <!-- 逐时段供需比与档位 -->
      <section class="ma-panel">
        <h3>供需比与边际机组</h3>
        <table class="ma-table">
          <thead><tr><th>时段</th><th>供需比</th><th>市场态势</th><th>边际机组</th><th>
            <el-tooltip placement="top" :show-after="150">
              <template #content>
                <p>供需比 → 历史价格区间映射：规则层已实现（supply-demand.mjs::historicalPriceBand），但「历史供需比 × 价格」配对数据尚无活源（#1968 / Epic #1981）——不给编造的区间，暂显示「—」。</p>
              </template>
              <span>价格中枢 <span class="ma-info">ⓘ</span></span>
            </el-tooltip>
          </th></tr></thead>
          <tbody>
            <tr v-for="(a, i) in assessments" :key="a.slot" :class="regimeClass(a.regime)">
              <td class="ma-slot">{{ slots[i].label }}</td>
              <td><strong>{{ a.ratio ?? '—' }}</strong></td>
              <td>{{ a.regime ? REGIME_LABEL[a.regime] : '无法判断' }}</td>
              <td>{{ a.marginalUnit }}</td>
              <td>{{ a.priceCenter ? `${a.priceCenter[0]}–${a.priceCenter[1]}` : '—' }}</td>
            </tr>
          </tbody>
        </table>
      </section>
    </div>

    <!-- 24 时段聚合视图（底层 96 点存储，24 时段仅作聚合展示 · 会议拍板） -->
    <details class="ma-fold ma-hourly">
      <summary>
        24 时段聚合视图：需求电量 / 中长期持仓 / 差额（现货敞口）
        <em v-if="hourlyTotals.gapMwh !== null" class="ma-fold-hint">合计 需求 {{ hourlyTotals.demandMwh }} · 持仓 {{ hourlyTotals.positionMwh }} · 差额 {{ hourlyTotals.gapMwh }} MWh</em>
        <em v-else class="ma-fold-hint">需求与持仓至少填一侧后出合计</em>
      </summary>
      <div class="ma-hourly-bar">
        <button type="button" class="pull" :disabled="hourlyPulling" @click="pullHourlyDemand">
          {{ hourlyPulling ? '聚合中…' : '需求电量按采集负荷预测聚合（96 点 → 24 小时）' }}
        </button>
        <span v-if="hourlyPullMsg" class="ma-pipe-ok">{{ hourlyPullMsg }}</span>
        <span v-if="hourlyPullError" class="ma-pipe-err">{{ hourlyPullError }}</span>
        <span class="ma-tip" style="margin: 0">
          来源：{{ hourlyDemandSource === 'capture' ? `采集（${hourlyDemandDate}）` : '人工' }}；差额 = 需求 − 持仓，正数即需现货补买的敞口；持仓随「保存到库」存档（合约库联动见 S6）。
        </span>
      </div>
      <table class="ma-table ma-hourly-table">
        <thead>
          <tr><th>时刻</th><th>需求电量 MWh</th><th>中长期持仓 MWh</th><th>差额（敞口）MWh</th></tr>
        </thead>
        <tbody>
          <tr v-for="(h, i) in HOURLY_LABELS" :key="h" :class="{ 'row-bad': hourlyGap[i] !== null && (hourlyGap[i] as number) > 0 }">
            <td class="ma-slot">{{ h }}</td>
            <td>
              <span class="ma-cell">
                <input v-model.number="hourlyDemand[i]" type="number" @input="hourlyDemandSource = 'manual'" />
                <i v-if="hourlyDemandSource === 'capture'" class="ma-src src-capture">采集</i>
              </span>
            </td>
            <td><input v-model.number="hourlyPosition[i]" type="number" placeholder="持仓" /></td>
            <td><strong>{{ hourlyGap[i] ?? '—' }}</strong></td>
          </tr>
        </tbody>
      </table>
    </details>

    <!-- AI 晨间分析：面板末行——空闲态为一条 invite 横条，展开后为完整面板（写回仍走判断卡「写回」按钮） -->
    <section v-if="!aiOpen" class="ma-ai-invite">
      <p><b>AI 晨间简报</b>——态势理由 · 规则表可疑点 · 最该防时段 · 给 S3 的方向倾向</p>
      <button type="button" class="ma-ai-start" @click="aiOpen = true">生成晨间简报</button>
    </section>
    <section v-else class="ma-panel">
      <h3>
        AI 晨间分析
        <em>产出分析初稿与反对意见，不替人拍板；写回仍走判断卡「写回」按钮</em>
      </h3>
      <AgentChatPanel
        scenario="morning_brief"
        :initial-question="aiQuestion"
        :context-payload="aiContext"
        history-key="s2_market_analysis"
      />
    </section>
  </div>
</template>

<style scoped>
/* ── S2 主任务轴重排（slim-s2-market-analysis）───────────────────────────────
 * 纪律与 S1 方案 B 同款：一套卡片配方（12px 圆角 / 1px var(--line) / var(--panel) 底 / 无阴影）；
 * 层级靠「字号跳变 + 字重 + 颜色」三杠杆（态势 28px 大字 vs 11.5px 灰标签）；
 * 颜色配给——红=偏紧、琥珀=待人处理/口径警示、绿=宽松/完成、accent=链接、primary=唯一主动作。
 * 参考区（日内要素/24时段）默认折叠，AI 按钮后置；预置示例/耦合推演 UI/验签清单已下线；
 * 写回契约与折叠无关。 */
.ma { display: flex; flex-direction: column; gap: 12px; }

/* 标题/表头 ⓘ：说明性文字收纳为 el-tooltip（内嵌浏览器不渲染原生 title），与 S1 同款 */
.ma-info { display: inline-flex; align-items: center; justify-content: center; width: 15px; height: 15px; border: 1px solid var(--el-border-color, #dcdfe6); border-radius: 50%; background: var(--panel-sub, #f8fafc); color: var(--el-text-color-secondary, #667); font-size: var(--font-10); font-style: normal; cursor: help; user-select: none; }

/* ── 主区 2×2（四块两组，同款网格保证列宽对齐）：上排 判断卡∥基本面、下排 AI∥供需比 ── */
.ma-row { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; align-items: start; }
@media (max-width: 1240px) { .ma-row { grid-template-columns: 1fr; } }

/* ── 判断卡（视觉主角）：态势语义 tint 定底色，主导态势放大成 28px 大字 ── */
.ma-verdict { padding: 14px 16px 12px; border: 1px solid; border-radius: 12px; }
.ma-verdict.r-loose { border-color: var(--success, #86efac); background: var(--primary-tint, #f0fdf4); }
.ma-verdict.r-mid { border-color: var(--primary-tint-border, #bfdbfe); background: var(--panel-sub, #f8fbff); }
.ma-verdict.r-tight { border-color: var(--danger, #fca5a5); background: var(--danger-tint, #fef2f2); }
.ma-verdict.r-unknown { border-color: var(--line, #e2e8f0); background: var(--panel-sub, #f8fafc); }
.ma-verdict-main { display: flex; align-items: baseline; gap: 14px; flex-wrap: wrap; }
.ma-regime { font-size: var(--font-28, 28px); font-weight: 700; line-height: 1.25; letter-spacing: -0.01em; font-variant-numeric: tabular-nums; }
.ma-center, .ma-cov { font-size: var(--font-md); font-variant-numeric: tabular-nums; }
.ma-summary { margin: 6px 0 0; font-size: var(--font-sm); line-height: 1.6; }
.ma-actions { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-top: 8px; }
.ma-actions .primary { display: inline-flex; align-items: center; gap: 5px; padding: 5px 14px; border: 1px solid var(--accent, #2563eb); border-radius: 6px; background: var(--accent, #2563eb); color: #fff; font-size: var(--font-sm); cursor: pointer; }
.ma-actions .primary:disabled { opacity: .45; cursor: not-allowed; }
.ma-actions .ghost { padding: 5px 12px; border: 1px solid var(--el-border-color, #dcdfe6); border-radius: 6px; background: var(--panel, #fff); font-size: var(--font-sm); cursor: pointer; }
.ma-ok { font-size: var(--font-sm); color: var(--success, #15803d); }
.ma-err { font-size: var(--font-sm); color: var(--danger, #b91c1c); }
.ma-written { font-size: var(--font-sm); color: var(--success, #15803d); }
.ma-pos-goal { margin: 8px 0 0; font-size: var(--font-xs); color: var(--sky, #075985); }

/* 昨日偏差 → 今日判断（主任务内嵌块） */
.ma-yday { margin: 10px 0 0; padding: 8px 10px; border-radius: 8px; background: var(--panel-sub, rgba(255,255,255,.75)); border: 1px dashed var(--el-border-color, #dcdfe6); }
.ma-yday-facts { display: flex; gap: 14px; flex-wrap: wrap; font-size: var(--font-sm); }
.ma-yday-pending { font-style: normal; font-size: var(--font-10); padding: 0 6px; border-radius: 8px; background: var(--warning-tint, #fef3c7); color: var(--warning, #92400e); }
.ma-yday-lessons { margin: 4px 0 0; font-size: var(--font-xs); color: var(--el-text-color-secondary, #667); }
.ma-yday-input { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin-top: 6px; font-size: var(--font-xs); }
.ma-yday-input select { padding: 3px 6px; border: 1px solid var(--el-border-color, #dcdfe6); border-radius: 5px; font-size: var(--font-xs); }
.ma-yday-note { flex: 1; min-width: 220px; padding: 4px 7px; border: 1px solid var(--el-border-color, #dcdfe6); border-radius: 5px; font-size: var(--font-xs); }
.ma-warn-inline { margin: 0; font-size: var(--font-sm); color: var(--warning, #b45309); }
.ma-jump { padding: 0; border: none; background: none; color: var(--accent, #1d4ed8); font: inherit; font-size: var(--font-sm); cursor: pointer; text-decoration: underline; text-underline-offset: 2px; }

/* 卡片统一配方（S1 方案 B） */
.ma-panel { padding: 14px 16px 12px; border: 1px solid var(--line, #e2e8f0); border-radius: 12px; background: var(--panel, #fff); }
.ma-panel h3 { display: flex; align-items: center; gap: 6px; margin: 0 0 8px; font-size: var(--font-lg, 15px); font-weight: 600; color: var(--text, #1e293b); flex-wrap: wrap; min-width: 0; }
.ma-panel h3::before { content: ''; flex: none; width: 3px; height: 14px; border-radius: 2px; background: var(--primary, #0f766e); margin-right: 2px; }
.ma-panel h3 em { font-style: normal; font-weight: 400; font-size: var(--font-xs); color: var(--el-text-color-secondary, #889); min-width: 0; }

/* 数据管道按钮组（基本面卡头） */
.ma-tools { display: flex; align-items: center; gap: 5px; flex-wrap: wrap; margin: 0 0 8px; font-size: var(--font-xs); }
.ma-tools button { padding: 2px 9px; border: 1px solid var(--line, #dcdfe6); border-radius: 999px; background: var(--panel, #fff); color: var(--muted, #475569); font-size: var(--font-xs); cursor: pointer; }
.ma-tools button:disabled { opacity: .5; cursor: wait; }
/* 采集/库操作三态：卡内直显（不折叠、不进状态行） */
.ma-pipe-ok { margin: 0 0 6px; font-size: var(--font-xs); color: var(--success, #047857); }
.ma-pipe-err { margin: 0 0 6px; font-size: var(--font-xs); color: var(--danger, #b91c1c); }

/* 来源徽章（可信链展示端，配色配给：绿=采集/调度、琥珀=公司、灰=人工） */
.ma-cell { display: inline-flex; align-items: center; gap: 3px; }
.ma-src { font-style: normal; font-size: var(--font-9); padding: 0 4px; border-radius: 6px; white-space: nowrap; }
.src-capture, .src-dispatch { background: var(--primary-tint, #dcfce7); color: var(--success, #15803d); }
.src-company { background: var(--warning-tint, #fef3c7); color: var(--warning, #92400e); }
.src-manual { background: var(--panel-sub, #f1f5f9); color: var(--muted, #64748b); }

/* ── 参考区折叠配方：同卡片 12px 配方；结论预告跟在标题后，收起也可扫读 ── */
.ma-fold { padding: 8px 16px; border: 1px solid var(--line, #e2e8f0); border-radius: 12px; background: var(--panel, #fff); }
.ma-fold summary { display: flex; align-items: center; gap: 6px; cursor: pointer; list-style: none; user-select: none; font-size: var(--font-sm); font-weight: 600; color: var(--text, #1e293b); flex-wrap: wrap; min-width: 0; }
.ma-fold summary::-webkit-details-marker { display: none; }
.ma-fold summary::before { content: ''; flex: none; width: 3px; height: 14px; border-radius: 2px; background: var(--primary, #0f766e); margin-right: 2px; }
.ma-fold summary::after { content: '▾'; flex: none; margin-left: auto; color: var(--muted, #64748b); font-size: var(--font-xs); transition: transform .15s; }
.ma-fold[open] summary::after { transform: rotate(180deg); }
.ma-fold[open] summary { margin-bottom: 8px; }
.ma-fold-hint { font-style: normal; font-weight: 400; font-size: var(--font-xs); color: var(--muted, #64748b); font-variant-numeric: tabular-nums; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ma-fold .ma-tip { margin: 2px 0 8px; }

/* AI 晨间分析：空闲态为一条 invite 横条（左一句话右按钮），展开后为完整面板 */
.ma-ai-invite { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; padding: 10px 16px; border: 1px dashed var(--line, #e2e8f0); border-radius: 12px; background: var(--panel-sub, #f8fafc); }
.ma-ai-invite p { margin: 0; font-size: var(--font-sm); color: var(--text-soft, #475467); }
.ma-ai-invite b { color: var(--text, #1e293b); }
.ma-ai-start { padding: 5px 16px; border: 1px solid var(--accent, #2563eb); border-radius: 6px; background: var(--accent, #2563eb); color: #fff; font-size: var(--font-sm); cursor: pointer; }

/* ── 表格（tabular-nums；发丝线用 --line-faint 与 S1 对齐） ──
   基本面 7 列在双栏下偏紧：输入框收窄 + 单元格减 pad，窄屏退化为横向滚动 */
.ma-table { width: 100%; border-collapse: collapse; font-size: var(--font-xs); font-variant-numeric: tabular-nums; }
.ma-table th, .ma-table td { padding: 4px 3px; border-bottom: 1px solid var(--line-faint, #f0f2f5); text-align: right; }
.ma-table th:first-child, .ma-table td:first-child { text-align: left; padding-left: 0; }
.ma-table th { color: var(--el-text-color-secondary, #667); font-weight: 600; }
.ma-table input[type='number'] { width: 58px; padding: 2px 3px; border: 1px solid var(--el-border-color, #dcdfe6); border-radius: 4px; font-size: var(--font-xs); text-align: right; }
.ma-slot { white-space: nowrap; text-align: left; }
.ma-export input { border-color: var(--warning, #f59e0b); }
.ma-table tr.r-loose td:nth-child(3) { color: var(--success, #15803d); }
.ma-table tr.r-tight td:nth-child(3) { color: var(--danger, #b91c1c); }

.ma-tip { margin: 6px 0 0; font-size: var(--font-xs); line-height: 1.6; color: var(--el-text-color-secondary, #667); }

.row-bad { background: var(--warning-tint, #fff7ed); }
@media (max-width: 760px) {
  .ma-table, .ma-hourly-table { display: block; overflow-x: auto; }
}

/* 日内要素一行（判断卡内，虚线子块与昨日表态块同配方）：紧凑输入 + 结论 chip，
   煤价锚对照的价格中枢、比价答的方向倾向就在同一张卡里 */
.ma-dayline { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin: 10px 0 0; padding: 8px 10px; border-radius: 8px; background: var(--panel-sub, rgba(255,255,255,.75)); border: 1px dashed var(--el-border-color, #dcdfe6); font-size: var(--font-xs); }
.ma-dayline-label { display: inline-flex; align-items: center; gap: 4px; font-weight: 600; color: var(--text, #1e293b); }
.ma-dayline label { display: inline-flex; align-items: center; gap: 4px; color: var(--el-text-color-secondary, #667); }
.ma-dayline input[type='number'] { width: 76px; padding: 2px 5px; border: 1px solid var(--el-border-color, #dcdfe6); border-radius: 5px; font-size: var(--font-xs); text-align: right; }
.ma-dayline input[type='text'] { width: 240px; max-width: 100%; padding: 2px 6px; border: 1px solid var(--el-border-color, #dcdfe6); border-radius: 5px; font-size: var(--font-xs); }
.ma-dayline-calc { color: var(--text-soft, #475467); font-variant-numeric: tabular-nums; }
.ma-dayline-sep { width: 1px; height: 14px; background: var(--line, #e2e8f0); }
.ma-chip { font-style: normal; font-size: var(--font-10); font-weight: 600; padding: 1px 8px; border-radius: 9px; white-space: nowrap; cursor: help; }
.ma-chip.anchor_within { background: var(--primary-tint, #f0fdf4); color: var(--success, #166534); }
.ma-chip.anchor_above_center, .ma-chip.anchor_below_center { background: var(--warning-tint, #fffbeb); color: var(--warning, #92400e); }
.ma-chip.domestic { background: var(--primary-tint, #eff6ff); color: var(--accent, #1d4ed8); }
.ma-chip.external { background: var(--violet-tint, #f5f3ff); color: var(--violet, #6d28d9); }
.ma-chip.comparable { background: var(--panel-sub, #f8fafc); color: var(--muted, #64748b); }
.ma-compare-fill { padding: 2px 8px; border: 1px solid var(--el-border-color, #dcdfe6); border-radius: 5px; background: var(--panel, #fff); font-size: var(--font-xs); cursor: pointer; color: var(--muted, #475569); }
.ma-compare-fill:disabled { opacity: .45; cursor: not-allowed; }

/* 24 时段聚合视图（折叠形态 · 会议拍板仅作聚合展示） */
.ma-hourly-bar { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 8px; }
.ma-hourly-bar .pull { padding: 3px 11px; border: 1px solid var(--success, #059669); border-radius: 12px; background: var(--panel, #fff); color: var(--success, #047857); font-size: var(--font-xs); cursor: pointer; }
.ma-hourly-bar .pull:disabled { opacity: .5; cursor: wait; }
.ma-hourly-table td input { width: 84px; }
.ma-hourly-table tr.row-bad td:last-child { color: var(--warning, #b45309); font-weight: 600; }
</style>
