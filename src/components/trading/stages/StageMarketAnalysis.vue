<script setup lang="ts">
// S2 早间分析（08:30–09:30）—— 判断链真正的起点
//
// 交易员早上要回答的第一个业务问题不是「数据齐不齐」，而是**「今天这个市场是松还是紧」**。
// 本面板把四个基本面量（可调机组 / 新能源 / 外送 / 负荷）压成供需比，映射到边际机组与
// 价格中枢区间，输出一句可执行的市场判断——它是 S3 方向判断的输入。
//
// 三个刻意的设计点：
//   ① **外送是分母项**。外送计划是省内出清的硬边界而非竞价标的，外送增加等价于省内净
//      负荷增加。放错位置会让松紧判断整个反向，故面板单独给外送耦合推演。
//   ② **主导态势取众数而非平均**。平均会把「多数时段偏紧 + 个别时段极松」抹成「宽松」，
//      恰好抹掉当天最该防的那几个小时。
//   ③ **八源验签是本步的异常分支**（v1.0："数据缺失→标注低可信并人工补判"），收进折叠
//      区块：验签结论参与写回，但只要基本面仍由使用者给定，门禁上限就压在「可参考」——
//      验签打满分也不放开，防止「表格里都勾了 A」伪装成实测口径。
import { computed, ref } from 'vue'
import { ArrowRightLeft, ClipboardCheck, Save } from 'lucide-vue-next'
import {
  assessSlots,
  exportCouplingImpact,
  REGIME_LABEL,
  summarizeDay,
  type SupplyDemandInput
} from 'shared/trading-rules/supply-demand.mjs'
import {
  assessIntegrity,
  CREDIBILITY_LABEL,
  REQUIRED_SOURCES,
  USAGE_GATE_LABEL,
  type DataCredibility,
  type SourceStatus
} from 'shared/trading-rules/data-integrity.mjs'
import { savePreflight, type DeclarationOrder } from '@/services/declarations'
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
import AgentChatPanel from '@/components/agent/AgentChatPanel.vue'
import type { StageId } from '@/data/workflowStages'

const props = defineProps<{ declaration: DeclarationOrder | null; targetDate: string }>()
const emit = defineEmits<{ updated: [d: DeclarationOrder]; go: [stage: StageId] }>()

type SlotRow = SupplyDemandInput & { label: string }

/** 四个代表时段：够表达「供需比区间」，又不至于让人填 24 行。 */
function presetSlots(kind: 'typical' | 'renewable' | 'tight'): SlotRow[] {
  if (kind === 'renewable') {
    return [
      { label: '低谷 00–08', dispatchableMaxMw: 20000, renewableForecastMw: 12000, netImportMw: 0, systemLoadMw: 13000, exportPlanMw: 6000, reserveMw: 1000 },
      { label: '平段 08–17', dispatchableMaxMw: 20000, renewableForecastMw: 14000, netImportMw: 0, systemLoadMw: 17000, exportPlanMw: 6000, reserveMw: 1000 },
      { label: '高峰 17–21', dispatchableMaxMw: 20000, renewableForecastMw: 6000, netImportMw: 0, systemLoadMw: 21000, exportPlanMw: 6500, reserveMw: 1200 },
      { label: '晚谷 21–24', dispatchableMaxMw: 20000, renewableForecastMw: 9000, netImportMw: 0, systemLoadMw: 15000, exportPlanMw: 6000, reserveMw: 1000 }
    ]
  }
  if (kind === 'tight') {
    return [
      { label: '低谷 00–08', dispatchableMaxMw: 18000, renewableForecastMw: 5000, netImportMw: 0, systemLoadMw: 15000, exportPlanMw: 6000, reserveMw: 1000 },
      { label: '平段 08–17', dispatchableMaxMw: 18000, renewableForecastMw: 4000, netImportMw: 0, systemLoadMw: 19000, exportPlanMw: 6000, reserveMw: 1000 },
      { label: '高峰 17–21', dispatchableMaxMw: 18000, renewableForecastMw: 2000, netImportMw: 0, systemLoadMw: 22000, exportPlanMw: 6500, reserveMw: 1200 },
      { label: '晚谷 21–24', dispatchableMaxMw: 18000, renewableForecastMw: 4000, netImportMw: 0, systemLoadMw: 17000, exportPlanMw: 6000, reserveMw: 1000 }
    ]
  }
  return [
    { label: '低谷 00–08', dispatchableMaxMw: 20000, renewableForecastMw: 9000, netImportMw: 0, systemLoadMw: 14000, exportPlanMw: 6000, reserveMw: 1000 },
    { label: '平段 08–17', dispatchableMaxMw: 20000, renewableForecastMw: 8000, netImportMw: 0, systemLoadMw: 18000, exportPlanMw: 6000, reserveMw: 1000 },
    { label: '高峰 17–21', dispatchableMaxMw: 20000, renewableForecastMw: 4000, netImportMw: 0, systemLoadMw: 21000, exportPlanMw: 6500, reserveMw: 1200 },
    { label: '晚谷 21–24', dispatchableMaxMw: 20000, renewableForecastMw: 7000, netImportMw: 0, systemLoadMw: 16000, exportPlanMw: 6000, reserveMw: 1000 }
  ]
}

const presetName = ref<'typical' | 'renewable' | 'tight' | 'captured' | 'db'>('typical')
const slots = ref<SlotRow[]>(presetSlots('typical'))

// ── 逐格来源跟踪（可信链）───────────────────────────────────────────────────
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

function applyPreset(kind: 'typical' | 'renewable' | 'tight') {
  presetName.value = kind
  slots.value = presetSlots(kind)
  cellSources.value = blankSources() // 预置示例值全按人工假设计
}

// ── 基本面库（PG · 迁移 012）：保存/载入，缺什么录什么 ─────────────────────
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
      const slotIndex = SLOT_DB_LABELS.indexOf(e.slot_label)
      const field = (Object.entries(FIELD_TO_DB).find(([, db]) => db === e.field)?.[0] ?? null) as FieldKey | null
      if (slotIndex < 0 || !field) continue
      ;(slots.value[slotIndex][field] as number) = e.value_mw
      cellSources.value[`${slotIndex}:${field}`] = e.source_kind
      applied += 1
    }
    presetName.value = 'db'
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
    const saved = await saveFundamentals(currentRegion.value.id, props.targetDate, entries)
    dbMsg.value = `已保存 ${saved} 格到基本面库（含来源与录入人留痕）`
  } catch (e) {
    dbError.value = e instanceof Error ? e.message : '保存失败（基本面库需 PG 在线）'
  } finally {
    dbBusy.value = false
  }
}

// ── 从采集库自动拉取基本面（云南 yn_system_forecast 族，真实采集回放）────────
// 该族按 metric 分文件：load_forecast / new_energy_forecast_d1 / inter_provincial_forecast /
// non_market_forecast，均为 (operateDate, targetDate, timePoint) 96 点时序。拉到什么标什么：
// 负荷/新能源/外送三项来自调度预测（B 级），可调机组与备用该族没有——保留手工值并如实提示。
const pulling = ref(false)
const pullMsg = ref('')
const pullError = ref('')
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
      // 是 'yn'，外送是 '云南总送出'）。省内供需判断必须**排除 'all'**——混算会把全网量
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
    presetName.value = 'captured'
    pullMsg.value = `已拉取：${applied.join('、')}；可调机组与备用该族不含，仍需人工核定`
  } catch (e) {
    pullError.value = e instanceof Error ? e.message : '采集库拉取失败'
  } finally {
    pulling.value = false
  }
}

// ── AI 晨间分析（L1 简报 + L2 追问，共用一个面板）───────────────────────────
// 把当前面板的全部推演结果注入为上下文：AI 拿到的是"人已经算出来的东西"，
// 它的职责是给出态势判断的理由、挑出规则表结论可疑的地方、提示最该防的时段——
// 产出是分析初稿与反对意见，不替人拍板；写回仍走人确认的「写回」按钮。
const aiOpen = ref(false)
/**
 * 注入 AI 的基本面**逐格带来源**（trusted = dispatch/capture 采集口径，
 * untrusted = company/manual 假设口径）。AI 无法验证数字真伪——可信链的做法是：
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

// 外送耦合推演：外送一变，档位会不会被推翻
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

// ── 八源验签（作业前清单式自查，与 AI 面板并列成 2×2 第二行）────────────────
type SourceRow = SourceStatus & { label: string }
const sourceRows = ref<SourceRow[]>(
  REQUIRED_SOURCES.map((s) => ({
    id: s.id,
    label: s.label,
    present: true,
    credibility: 'B' as DataCredibility,
    timestamp: '07:30',
    completeness: 1,
    mock: false
  }))
)
const CREDIBILITIES: DataCredibility[] = ['A', 'B', 'C', 'D']
const integrityVerdict = computed(() => assessIntegrity(sourceRows.value))

/**
 * 写回口径的封顶：基本面由使用者给定期间，门禁上限「可参考」、可信度上限 C。
 * 验签结果只能把口径**压得更低**（缺源→仅展示、含 D 级→降级），不能抬得更高——
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

// ── 写回 ────────────────────────────────────────────────────────────────────
const saving = ref(false)
const saveMsg = ref('')
const saveError = ref('')
const written = computed(() => props.declaration?.preflight?.dataGate ?? null)

async function writeBack() {
  if (!props.declaration || !daySummary.value.dominantRegime) return
  saving.value = true
  saveMsg.value = ''
  saveError.value = ''
  try {
    const s = daySummary.value
    const updated = await savePreflight(
      props.declaration.id,
      'dataGate',
      {
        // 市场判断（S2 的主产出）
        regime: s.dominantRegime,
        coverage: s.coverage,
        priceCenterLow: s.priceCenterLow,
        priceCenterHigh: s.priceCenterHigh,
        tightestSlot: s.tightestSlot,
        loosestSlot: s.loosestSlot,
        // 数据口径：验签结论参与，但被自建口径封顶（见 effectiveGate 注释）
        gate: effectiveGate.value,
        completenessRate: integrityVerdict.value.completenessRate,
        weakestCredibility: effectiveCredibility.value,
        degradeLevel: integrityVerdict.value.degradeLevel
      },
      `S2 早间分析：${REGIME_LABEL[s.dominantRegime]}，中枢 ${s.priceCenterLow}–${s.priceCenterHigh} 元/MWh`
    )
    emit('updated', updated)
    saveMsg.value = '市场判断已写回，S3 方向判断可直接读取'
  } catch (e) {
    saveError.value = e instanceof Error ? e.message : '写回失败'
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="ma">
    <div class="ma-presets">
      <span>典型日形态：</span>
      <button type="button" :class="{ on: presetName === 'typical' }" @click="applyPreset('typical')">常规</button>
      <button type="button" :class="{ on: presetName === 'renewable' }" @click="applyPreset('renewable')">新能源大发</button>
      <button type="button" :class="{ on: presetName === 'tight' }" @click="applyPreset('tight')">供需偏紧</button>
      <button type="button" class="pull" :class="{ on: presetName === 'captured' }" :disabled="pulling" @click="pullFundamentals">
        {{ pulling ? '拉取中…' : '从采集库拉取（云南调度预测）' }}
      </button>
      <span class="ma-sep" />
      <button type="button" class="db" :class="{ on: presetName === 'db' }" :disabled="dbBusy" @click="loadFromDb">从基本面库载入</button>
      <button type="button" class="db" :disabled="dbBusy" @click="saveToDb">保存到基本面库</button>
      <span v-if="pullMsg" class="ma-pull-ok">{{ pullMsg }}</span>
      <span v-if="pullError" class="ma-err">{{ pullError }}</span>
      <span v-if="dbMsg" class="ma-pull-ok">{{ dbMsg }}</span>
      <span v-if="dbError" class="ma-err">{{ dbError }}</span>
    </div>

    <!-- 今日市场判断（S2 主产出） -->
    <section class="ma-verdict" :class="regimeClass(daySummary.dominantRegime)">
      <div class="ma-verdict-main">
        <span class="ma-regime">
          {{ daySummary.dominantRegime ? REGIME_LABEL[daySummary.dominantRegime] : '无法判断' }}
        </span>
        <span v-if="daySummary.priceCenterLow !== null" class="ma-center">
          均价指引 {{ daySummary.priceCenterLow }}–{{ daySummary.priceCenterHigh }} 元/MWh
        </span>
        <span v-if="daySummary.coverage" class="ma-cov">主导档覆盖 {{ (daySummary.coverage * 100).toFixed(0) }}% 时段</span>
      </div>
      <p class="ma-summary">{{ daySummary.summary }}</p>
      <p class="ma-note">
        主导态势取<strong>时段数最多</strong>的档位而非平均供需比——平均会把「多数偏紧 + 个别极松」
        抹成宽松，恰好抹掉当天最该防的时段。
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

    <div class="ma-grid">
      <!-- 基本面输入：逐格带来源徽章（可信链的展示端） -->
      <section class="ma-panel">
        <h3>
          基本面（分时段 · 逐格标来源）
          <em class="ma-src-legend">
            <i class="src-capture">采集</i> = 调度预测采集；<i class="src-manual">人工</i> = 估计/假设，AI 只当假设用
          </em>
        </h3>
        <table class="ma-table">
          <thead>
            <tr>
              <th>时段</th>
              <th title="全网口径（调度侧数据，市场成员通常拿不到全量）——注意与「公司代理机组容量」是两个不同的量，不可混填">全网可调机组 ⓘ</th>
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
        <p class="ma-tip">
          单位 MW。<strong>外送计入分母</strong>（外送增加等价于省内净负荷增加）。
          「全网可调机组」是调度口径，采集库没有——从调度渠道拿到后在此录入并「保存到基本面库」，
          手改任一格来源即打回「人工」。
        </p>
      </section>

      <!-- 逐时段供需比与档位 -->
      <section class="ma-panel">
        <h3>供需比与边际机组</h3>
        <table class="ma-table">
          <thead><tr><th>时段</th><th>供需比</th><th>市场态势</th><th>边际机组</th><th>价格中枢</th></tr></thead>
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

        <h3><ArrowRightLeft :size="13" /> 外送耦合推演</h3>
        <div class="ma-coupling">
          <label>
            时段
            <select v-model.number="couplingSlotIndex">
              <option v-for="(row, i) in slots" :key="row.label" :value="i">{{ row.label }}</option>
            </select>
          </label>
          <label>外送增量 MW<input v-model.number="exportDelta" type="number" step="500" /></label>
        </div>
        <p class="ma-coupling-out" :class="{ shifted: coupling.regimeShifted }">
          供需比 {{ coupling.ratioBefore ?? '—' }} → {{ coupling.ratioAfter ?? '—' }}
          （Δ {{ coupling.delta ?? '—' }}）·
          <template v-if="coupling.regimeShifted">
            <strong>档位被推翻</strong>：{{ REGIME_LABEL[coupling.regimeBefore!] }} → {{ REGIME_LABEL[coupling.regimeAfter!] }}
          </template>
          <template v-else>档位未变（{{ coupling.regimeBefore ? REGIME_LABEL[coupling.regimeBefore] : '—' }}）</template>
        </p>
      </section>
    </div>

    <!-- 第二行：八源验签 × AI 晨间分析，与上一行「基本面 × 供需比」成 2×2 -->
    <div class="ma-grid">
      <!-- 八源验签：作业前的清单式自查（逻辑见 h3 title 与底部说明） -->
      <section class="ma-panel">
        <h3>
          <ClipboardCheck :size="13" /> 数据可信度自查（八源验签）
          <em class="ma-gate-badge" :class="integrityVerdict.gate">
            {{ USAGE_GATE_LABEL[integrityVerdict.gate] }} · 完整率 {{ (integrityVerdict.completenessRate * 100).toFixed(0) }}%
          </em>
        </h3>
        <p class="ma-tip" style="margin: 0 0 6px">
          逻辑：开工前逐一勾验八类输入数据「到位没有、几成可信、是不是 Mock」→ 算完整率 → 判三态门禁
          （可申报 / 可参考 / 仅展示）。任一源缺席或标 Mock 即降档；结论随市场判断一并写回，
          直接决定申报暴露系数（1 / 0.5 / 0）。当前为人工勾选，自动验签探针未接。
        </p>
        <table class="ma-table ma-sources">
          <thead>
            <tr><th>#</th><th>数据源</th><th>到位</th><th>可信度</th><th>完整度</th><th>Mock</th></tr>
          </thead>
          <tbody>
            <tr v-for="(row, i) in sourceRows" :key="row.id" :class="{ 'row-bad': !row.present || row.credibility === 'D' || row.mock }">
              <td>{{ i + 1 }}</td>
              <td class="ma-slot">{{ row.label }}</td>
              <td><input v-model="row.present" type="checkbox" /></td>
              <td>
                <select v-model="row.credibility" :disabled="!row.present">
                  <option v-for="c in CREDIBILITIES" :key="c" :value="c">{{ CREDIBILITY_LABEL[c] }}</option>
                </select>
              </td>
              <td><input v-model.number="row.completeness" type="number" min="0" max="1" step="0.05" :disabled="!row.present" /></td>
              <td><input v-model="row.mock" type="checkbox" :disabled="!row.present" /></td>
            </tr>
          </tbody>
        </table>
        <ul v-if="integrityVerdict.problems.length" class="ma-problems">
          <li v-for="(p, i) in integrityVerdict.problems" :key="`${p.id}-${i}`"><strong>{{ p.label }}</strong> — {{ p.reason }}</li>
        </ul>
        <p class="ma-tip">
          写回口径 = 验签结论与「自建口径封顶」取更严者：基本面未全接调度边界条件包期间，门禁上限
          「可参考」（本次写回 {{ USAGE_GATE_LABEL[effectiveGate] }}）、可信度上限 C——验签打满分也不放开。
        </p>
      </section>

      <!-- AI 晨间分析：简报初稿 + 追问（注入当前面板全部推演结果为上下文） -->
      <section class="ma-panel">
        <h3>
          AI 晨间分析
          <em class="ma-src-legend">产出分析初稿与反对意见，不替人拍板；写回仍走上方「写回」按钮</em>
        </h3>
        <div v-if="!aiOpen" class="ma-ai-idle">
          <p>
            把左侧基本面（逐格含来源标注）、供需比推演、外送耦合、验签门禁与昨日复盘一并注入
            AI 上下文，产出结构化简报：态势判断理由 / 规则表可疑点 / 最该防时段 / 给 S3 的方向倾向。
            当前 {{ trustedCellCount }}/24 格为可信数据——建立在人工假设上的结论会被强制标注「基于假设」。
          </p>
          <button type="button" class="ma-ai-start" @click="aiOpen = true">生成晨间简报</button>
        </div>
        <AgentChatPanel
          v-if="aiOpen"
          scenario="morning_brief"
          :initial-question="aiQuestion"
          :context-payload="aiContext"
          history-key="s2_market_analysis"
        />
      </section>
    </div>

    <p class="ma-foot">
      基本面口径：{{ pulledFields.length
        ? `负荷/新能源/外送已接云南采集库调度预测（${pulledFields.join('、')}），可调机组与备用仍为人工核定`
        : '当前由使用者给定，可点上方「从采集库拉取」接入云南调度预测（负荷/新能源/外送）' }}；
      写回口径如实封顶为自建模型（C 级）、门禁「可参考」——申报暴露会因此减半。
    </p>
  </div>
</template>

<style scoped>
.ma { display: flex; flex-direction: column; gap: 12px; }
.ma-presets { display: flex; align-items: center; gap: 6px; font-size: 12px; flex-wrap: wrap; }
.ma-presets button { padding: 3px 11px; border: 1px solid var(--el-border-color, #dcdfe6); border-radius: 12px; background: #fff; font-size: 12px; cursor: pointer; }
.ma-presets button.on { border-color: #2563eb; background: #eff6ff; color: #1d4ed8; }
.ma-presets button.pull { border-color: #059669; color: #047857; }
.ma-presets button.pull.on { background: #ecfdf5; }
.ma-presets button.pull:disabled { opacity: .5; cursor: wait; }
.ma-presets button.db { border-color: #7c3aed; color: #6d28d9; }
.ma-presets button.db.on { background: #f5f3ff; }
.ma-presets button.db:disabled { opacity: .5; cursor: wait; }
.ma-sep { width: 1px; height: 16px; background: var(--el-border-color, #dcdfe6); }
.ma-pull-ok { font-size: 11px; color: #047857; }

.ma-src-legend { margin-left: 8px; font-style: normal; font-weight: 400; font-size: 10px; color: var(--el-text-color-secondary, #889); }
.ma-cell { display: inline-flex; align-items: center; gap: 3px; }
.ma-src { font-style: normal; font-size: 9px; padding: 0 4px; border-radius: 6px; white-space: nowrap; }
.src-capture, .src-dispatch { background: #dcfce7; color: #15803d; }
.src-company { background: #fef3c7; color: #92400e; }
.src-manual { background: #f1f5f9; color: #64748b; }

.ma-ai-idle p { margin: 0 0 10px; font-size: 12px; line-height: 1.7; color: var(--el-text-color-secondary, #667); }
.ma-ai-start { padding: 6px 18px; border: 1px solid #2563eb; border-radius: 6px; background: #2563eb; color: #fff; font-size: 12px; cursor: pointer; }

.ma-gate-badge { margin-left: auto; font-style: normal; font-size: 10px; font-weight: 600; padding: 2px 9px; border-radius: 9px; }
.ma-gate-badge.declarable { background: #dcfce7; color: #15803d; }
.ma-gate-badge.reference { background: #fef3c7; color: #92400e; }
.ma-gate-badge.display_only { background: #fee2e2; color: #991b1b; }

.ma-verdict { padding: 12px 14px; border: 1px solid; border-radius: 10px; }
.ma-verdict.r-loose { border-color: #86efac; background: #f0fdf4; }
.ma-verdict.r-mid { border-color: #bfdbfe; background: #f8fbff; }
.ma-verdict.r-tight { border-color: #fca5a5; background: #fef2f2; }
.ma-verdict.r-unknown { border-color: #e2e8f0; background: #f8fafc; }
.ma-verdict-main { display: flex; align-items: baseline; gap: 14px; flex-wrap: wrap; }
.ma-regime { font-size: 20px; font-weight: 700; }
.ma-center, .ma-cov { font-size: 13px; font-variant-numeric: tabular-nums; }
.ma-summary { margin: 6px 0 4px; font-size: 12px; line-height: 1.6; }
.ma-note { margin: 0 0 8px; font-size: 11px; line-height: 1.6; color: var(--el-text-color-secondary, #667); }
.ma-actions { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.ma-actions .primary { display: inline-flex; align-items: center; gap: 5px; padding: 5px 14px; border: 1px solid #2563eb; border-radius: 6px; background: #2563eb; color: #fff; font-size: 12px; cursor: pointer; }
.ma-actions .primary:disabled { opacity: .45; cursor: not-allowed; }
.ma-actions .ghost { padding: 5px 12px; border: 1px solid var(--el-border-color, #dcdfe6); border-radius: 6px; background: #fff; font-size: 12px; cursor: pointer; }
.ma-ok { font-size: 12px; color: #15803d; }
.ma-err { font-size: 12px; color: #b91c1c; }
.ma-written { font-size: 12px; color: #15803d; }

.ma-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(380px, 1fr)); gap: 12px; }
.ma-panel { padding: 12px 14px; border: 1px solid var(--el-border-color-lighter, #ebeef5); border-radius: 10px; background: #fff; }
.ma-panel h3 { display: flex; align-items: center; gap: 5px; margin: 10px 0 6px; font-size: 13px; }
.ma-panel h3:first-child { margin-top: 0; }

.ma-table { width: 100%; border-collapse: collapse; font-size: 11px; font-variant-numeric: tabular-nums; }
.ma-table th, .ma-table td { padding: 4px 5px; border-bottom: 1px solid var(--el-border-color-lighter, #ebeef5); text-align: right; }
.ma-table th:first-child, .ma-table td:first-child { text-align: left; }
.ma-table th { color: var(--el-text-color-secondary, #667); font-weight: 600; }
.ma-table input[type='number'] { width: 74px; padding: 2px 4px; border: 1px solid var(--el-border-color, #dcdfe6); border-radius: 4px; font-size: 11px; text-align: right; }
.ma-slot { white-space: nowrap; text-align: left; }
.ma-export input { border-color: #f59e0b; }
.ma-table tr.r-loose td:nth-child(3) { color: #15803d; }
.ma-table tr.r-tight td:nth-child(3) { color: #b91c1c; }

.ma-tip, .ma-foot { margin: 6px 0 0; font-size: 11px; line-height: 1.6; color: var(--el-text-color-secondary, #667); }
.ma-foot { color: #a16207; }

.ma-coupling { display: flex; gap: 12px; flex-wrap: wrap; font-size: 11px; }
.ma-coupling label { display: inline-flex; align-items: center; gap: 5px; }
.ma-coupling select, .ma-coupling input { padding: 3px 6px; border: 1px solid var(--el-border-color, #dcdfe6); border-radius: 5px; font-size: 11px; }
.ma-coupling-out { margin: 6px 0 0; padding: 6px 9px; border-radius: 6px; background: #f8fafc; font-size: 11px; }
.ma-coupling-out.shifted { background: #fef2f2; color: #991b1b; }

.ma-sources td select, .ma-sources td input[type='number'] { font-size: 11px; }
.row-bad { background: #fff7ed; }
.ma-problems { margin: 8px 0 0; padding-left: 18px; font-size: 11px; color: #b45309; line-height: 1.7; }
</style>
