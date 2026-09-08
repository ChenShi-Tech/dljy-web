<script setup lang="ts">
// 收益三层拆解面板（Epic #2033 · M2 · #2043：模板二/三）
// ---------------------------------------------------------------------------
// 月度三层：分品种（日前/实时增量先行，中长期未接入如实标注）/ 分时段（读
// SettlementRuleSpec）/ 单笔 Top5（M2 以日为笔，逐笔归集待 S6 #1966）。
// 与 #2042 共用 fetchReviewRange，Top5 与拆解表同一次 /review 聚合产出（同源同口径）。
// 环比超 20% 强制归因（方案原文规则）；反事实定位「策略对比」视图=决策参考非结算依据。
// Top5「入案例库」已接 review.cases 端点（registerCase）：勾选即以行内人填内容构造
// 四要素落库（空壳服务端拒、前端前置拦截）；失败红字+重试（写路径不静默）。
import { computed, onMounted, ref, watch } from 'vue'
import PnLWaterfall from '@/components/agent/dljy-ui/review/PnLWaterfall.vue'
import PanelFetchLoading from '@/components/review/PanelFetchLoading.vue'
import { fetchReviewRange, type PeriodReviewDay } from '@/services/review/reviewPeriodClient'
import { fetchCases, registerCase, type CaseDraft } from '@/services/review/reviewStoreClient'
import type { CaseSummary } from '@/services/review/reviewStoreApi'
import { fetchTemplateInstanceFeed, patchTemplateInstance } from '@/services/review/templateInstanceClient'
import type { TemplateInstanceSummary } from '@/services/review/templateInstanceApi'
import {
  decomposeDaily,
  momForcesAttribution,
  monthlyPnlTop,
  rollupMonthly,
  type DailyPnlDecompose
} from '@/services/review/pnlDecompose'
import type { SettlementRuleSpec } from '@/rules/types'
import { currentMonthBeijing, todayBeijing } from '@/utils/beijingDate'

const props = defineProps<{ spec: SettlementRuleSpec | null; tolerancePct: number; penaltyPrice: number; reviewMonth?: string }>()

// 默认看复盘日期所在月（深链 ?date=… / 头部翻日），而不是固定当前月——
// 看 5 月复盘还得手动切月读起来像面板与页面脱节（走查 K2-3）；用户仍可手动改月。
const month = ref(props.reviewMonth || currentMonthBeijing())
watch(() => props.reviewMonth, (m) => {
  if (m && m !== month.value) month.value = m
})
const loading = ref(false)
const curDays = ref<Array<{ date: string; d: DailyPnlDecompose | null; pnlYuan: number | null }>>([])
const prevTotalYuan = ref<number | null>(null)
const prevLabel = ref('')

function monthDays(ym: string, upToToday = false): string[] {
  const [y, m] = ym.split('-').map(Number)
  const last = new Date(y, m, 0).getDate()
  const today = todayBeijing()
  return Array.from({ length: last }, (_, i) => `${y}-${String(m).padStart(2, '0')}-${String(i + 1).padStart(2, '0')}`)
    .filter((d) => (upToToday ? d <= today : true))
}
function prevMonthOf(ym: string): string {
  const [y, m] = ym.split('-').map(Number)
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`
}

const curProgress = ref<{ done: number; total: number } | null>(null)
async function load() {
  loading.value = true
  curDays.value = []
  prevTotalYuan.value = null
  curProgress.value = null
  try {
    const [cur, prev] = await Promise.all([
      fetchReviewRange(monthDays(month.value, true), {
        tolerancePct: props.tolerancePct, penaltyPrice: props.penaltyPrice,
        onProgress: (done, total) => (curProgress.value = { done, total })
      }),
      fetchReviewRange(monthDays(prevMonthOf(month.value)), { tolerancePct: props.tolerancePct, penaltyPrice: props.penaltyPrice })
    ])
    curDays.value = cur.days.map((day: PeriodReviewDay) => {
      if (!day.ok) return { date: day.date, d: null, pnlYuan: null }
      const d = decomposeDaily(day.result.detail, props.spec)
      return { date: day.date, d, pnlYuan: d.totalYuan }
    })
    const prevRoll = rollupMonthly(
      prev.days.map((day: PeriodReviewDay) =>
        day.ok ? { date: day.date, d: decomposeDaily(day.result.detail, props.spec) } : { date: day.date, d: null }
      )
    )
    prevTotalYuan.value = prevRoll.days ? prevRoll.totalYuan : null
    prevLabel.value = prevMonthOf(month.value)
  } finally {
    loading.value = false
  }
}
onMounted(load)
onMounted(loadCasesProbe)
onMounted(loadT03)
watch(month, loadT03)
watch(month, load)

const rollup = computed(() => rollupMonthly(curDays.value))
const top5 = computed(() =>
  monthlyPnlTop(
    curDays.value.filter((x): x is { date: string; d: DailyPnlDecompose; pnlYuan: number } => x.pnlYuan !== null)
  )
)
const forcesAttribution = computed(() =>
  momForcesAttribution(rollup.value.totalYuan, prevTotalYuan.value)
)
/** PnLWaterfall 真数据：分品种层（日前/实时增量），合计=两层之和（恒等）。 */
const waterfallData = computed(() => {
  const r = rollup.value
  const segs: Array<{ label: string; valueYuan: number; kind: 'gain' | 'cost' | 'total' }> = []
  for (const v of r.byVariety) {
    if (v.revenueYuan === null) continue // 中长期未接入不画假柱
    segs.push({ label: v.variety, valueYuan: v.revenueYuan, kind: v.revenueYuan >= 0 ? 'gain' : 'cost' })
  }
  return {
    segments: segs,
    totalYuan: r.totalYuan,
    caliber: 'self-computed',
    note: `${r.days} 个数据日聚合；价格缺失点 ${r.priceGapPoints} 个未计入对应层${r.segmentGapPoints > 0 ? `；时点未解析 ${r.segmentGapPoints} 点未计入分时段` : ''}`
  }
})

// 模板三 B 档：事实自动带入（下表），成因与经验人填——内容随模板三实例存草稿（#2037 链路：
// PATCH payload.pnlTop5），提交/锁定在模板抽屉的表单里做；此处自动保存草稿，不做第二套提交入口。
const topDraft = ref<Record<string, { mainCause: string; lesson: string; toCase: boolean }>>({})
function draftOf(date: string) {
  return (topDraft.value[date] ??= { mainCause: '', lesson: '', toCase: false })
}

// ── 模板三实例接线：读实例回填人填内容，编辑防抖自动存草稿 ──────────────────────
const t03Instance = ref<TemplateInstanceSummary | null>(null)
const t03Available = ref(true)
const t03Saving = ref(false)
const t03SavedAt = ref('')
const t03Error = ref('')
const t03Locked = computed(() => t03Instance.value?.status === 'submitted' || t03Instance.value?.status === 'reviewed')
let t03SaveTimer: number | undefined

async function loadT03() {
  t03Instance.value = null
  t03Error.value = ''
  t03SavedAt.value = ''
  const feed = await fetchTemplateInstanceFeed()
  t03Available.value = feed.available
  if (!feed.available) return
  // T03 为月度节奏：周期键按月前缀匹配（触发引擎按 公司×模板×周期键 幂等生成）
  const inst = feed.instances.find((i) => i.templateId === 'T03' && (i.periodKey ?? '').startsWith(month.value)) ?? null
  t03Instance.value = inst
  // 已落库的人填内容回读（payload.pnlTop5: { [date]: { mainCause, lesson } }）；不覆盖本地未保存的编辑
  const saved = inst?.payload?.pnlTop5 as Record<string, { mainCause?: string; lesson?: string }> | undefined
  if (saved && typeof saved === 'object') {
    for (const [date, v] of Object.entries(saved)) {
      const d = draftOf(date)
      if (!d.mainCause) d.mainCause = v.mainCause ?? ''
      if (!d.lesson) d.lesson = v.lesson ?? ''
    }
  }
}

function serializeTop5() {
  return Object.fromEntries(top5.value.map((t) => {
    const d = topDraft.value[t.date]
    return [t.date, { type: t.type, pnlYuan: t.pnlYuan, mainCause: d?.mainCause ?? '', lesson: d?.lesson ?? '', toCase: !!d?.toCase }]
  }))
}

async function saveT03Draft() {
  const inst = t03Instance.value
  if (!inst || t03Locked.value || t03Saving.value) return
  t03Saving.value = true
  t03Error.value = ''
  try {
    const pnlTop5 = serializeTop5()
    await patchTemplateInstance(inst.id, { payload: { ...inst.payload, pnlTop5 }, status: 'draft' })
    t03Instance.value = { ...inst, payload: { ...inst.payload, pnlTop5 } }
    t03SavedAt.value = new Date().toLocaleTimeString('zh-CN', { hour12: false })
  } catch (e) {
    t03Error.value = e instanceof Error ? e.message : '模板三草稿保存失败'
  } finally {
    t03Saving.value = false
  }
}

// 人填内容变更 → 800ms 防抖自动存模板三草稿（有实例且未锁定时才落库）
watch(topDraft, () => {
  if (!t03Instance.value || t03Locked.value || !t03Available.value) return
  if (t03SaveTimer) clearTimeout(t03SaveTimer)
  t03SaveTimer = window.setTimeout(() => { void saveT03Draft() }, 800)
}, { deep: true })

// ── Top5「入案例库」→ review.cases（#2045/#2047 端点已上线） ────────────────────
// 案例档案纪律：四要素必填不接受空壳沉淀、沉淀后不可改写、无 DELETE——故勾选即登记，
// 登记前前置校验成因/经验已填；失败红字 + 重试（写路径不静默）；端点缺席保持本地勾选并如实提示。
const casesAvailable = ref(false)
const caseState = ref<Record<string, { status: 'idle' | 'sinking' | 'done' | 'error'; caseNo?: string; error?: string; retry?: CaseDraft }>>({})
const registeredCases = ref<CaseSummary[]>([])

async function loadCasesProbe() {
  const feed = await fetchCases('deviation')
  casesAvailable.value = feed.available
  if (feed.available) registeredCases.value = feed.cases
}

// 已登记案例回读水合：刷新/换月后把命中行恢复为「已入库 + 案号」，防止重复登记——
// 幂等键一字不差才去重，案例库无 DELETE，重登即产生一条永不可删的重复档案。
function hydrateRegisteredCases() {
  if (!casesAvailable.value) return
  for (const t of top5.value) {
    const st = caseState.value[t.date]
    if (st?.status === 'done' || st?.status === 'sinking') continue
    const hit = registeredCases.value.find((c) => c.title.startsWith(TOP5_CASE_TITLE_PREFIX)
      && c.title.slice(TOP5_CASE_TITLE_PREFIX.length, TOP5_CASE_TITLE_PREFIX.length + 10) === t.date)
    if (!hit) continue
    caseState.value[t.date] = { status: 'done', caseNo: hit.caseNo }
    const d = draftOf(t.date)
    // 空栏回填案例内容（成因在案例列表接口不返回，留空如实）；不覆盖本地未保存的编辑
    if (!d.lesson) d.lesson = hit.lessons ?? ''
    d.toCase = true
  }
}
watch(top5, hydrateRegisteredCases)
watch(registeredCases, hydrateRegisteredCases)

// 案例标题规则即回读主键：`偏差Top5：{日期} …`（前 10 位即 ISO 日期）。两侧必须同源。
const TOP5_CASE_TITLE_PREFIX = '偏差Top5：'

function caseDraftOf(t: { date: string; type: string; pnlYuan: number }, draft: { mainCause: string; lesson: string }): CaseDraft {
  return {
    caseType: 'deviation',
    title: `${TOP5_CASE_TITLE_PREFIX}${t.date} ${t.type} ${Math.round(t.pnlYuan).toLocaleString()} 元`,
    background: `复盘月份 ${month.value}；当日申报回测偏差（自算口径，结算细则未核验）`,
    conclusion: draft.mainCause,
    lessons: draft.lesson
  }
}

async function sinkTopCase(t: { date: string; type: string; pnlYuan: number }) {
  const draft = draftOf(t.date)
  const st = (caseState.value[t.date] ??= { status: 'idle' })
  if (st.status === 'sinking') return
  if (!draft.mainCause.trim() || !draft.lesson.trim()) {
    // 不自动回弹勾选框（状态与 DOM 会失同步）：保持勾选 + 行内红字，用户自行取消
    st.status = 'error'
    st.error = '案例库不接受空壳沉淀：请先填写主要成因与可复制经验（未落库）'
    return
  }
  st.status = 'sinking'
  st.error = undefined
  const payload = caseDraftOf(t, draft)
  try {
    const created = await registerCase(payload)
    st.status = 'done'
    st.caseNo = created.caseNo
    st.error = undefined
  } catch (e) {
    st.status = 'error'
    st.error = e instanceof Error ? e.message : '案例登记失败'
  }
}

// 重试 = 重新执行登记：payload 按行内草稿现造，幂等键按内容派生（同内容同键天然去重）。
function retrySinkTopCase(t: { date: string; type: string; pnlYuan: number }) {
  void sinkTopCase(t)
}

function onToCaseChange(t: { date: string; type: string; pnlYuan: number }, checked: boolean) {
  const st = (caseState.value[t.date] ??= { status: 'idle' })
  if (st.status === 'done') return // 档案纪律：沉淀后不可撤回
  if (checked) void sinkTopCase(t)
}
</script>

<template>
  <section class="pdp">
    <header class="pdp-head">
      <b>收益三层拆解与典型交易（模板二 · 月度拆解 / 模板三 · Top5）</b>
      <input v-model="month" type="month" />
    </header>

    <PanelFetchLoading
      v-if="loading"
      :text="`逐日取 quant /review 分解中（本月 + 上月环比基线${curProgress ? `，本月已取 ${curProgress.done}/${curProgress.total} 天` : ''}）…`"
      :progress="curProgress"
    />

    <template v-else>
      <p v-if="!rollup.days" class="pdp-muted">{{ month }} 无可用数据日——诚实空态，不合成。</p>

      <template v-else>
        <!-- 三层各自成卡片（白底+细边+浅阴影，与系统卡片调性一致） -->
        <div class="pdp-card">
          <!-- 第一层：分品种（喂 M1 预留位 PnLWaterfall 真数据） -->
          <PnLWaterfall :data="waterfallData" :title="`${month} 收益三层拆解 · 分品种`" />
          <p v-for="v in rollup.byVariety" v-show="v.revenueYuan === null" :key="v.variety" class="pdp-note">
            {{ v.variety }}：{{ v.note }}
          </p>
        </div>

        <div class="pdp-card">
          <!-- 第二层：分时段 -->
          <div v-if="rollup.bySegment" class="pdp-seg">
            <b>分时段（峰平谷 · 读 SettlementRuleSpec）</b>
            <table class="pdp-table">
              <thead><tr><th>时段</th><th>收益 元</th><th>占比</th></tr></thead>
              <tbody>
                <tr v-for="s in rollup.bySegment" :key="s.segment">
                  <td>{{ s.segment }}</td>
                  <td>{{ Math.round(s.revenueYuan).toLocaleString() }}</td>
                  <td>{{ (s.share * 100).toFixed(1) }}%</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p v-else class="pdp-warn">本省峰谷时段未参数化（SettlementRuleSpec 未沉淀）：分时段层不出数，不借用他省划分。</p>

          <!-- 环比强制归因 -->
          <p v-if="forcesAttribution" class="pdp-warn">
            环比 {{ prevLabel }} 变动超 20%（{{ prevTotalYuan!.toLocaleString() }} → {{ Math.round(rollup.totalYuan).toLocaleString() }} 元）：
            按方案规则本层主要归因<b>必填</b>——在 Top5 表「主要成因」栏填写。
          </p>
          <p v-else class="pdp-note">
            环比 {{ prevLabel }}：{{ prevTotalYuan === null ? '上期无数据（不强制归因）' : `${Math.round(prevTotalYuan).toLocaleString()} 元` }}。
          </p>
        </div>

        <!-- 第三层：单笔 Top5（M2 以日为笔） -->
        <div class="pdp-card pdp-top">
          <b>单笔 Top5 盈亏榜 <i>（M2 以日为笔；逐笔成交归集待 S6 持仓线 #1966 接通后替换）</i></b>
          <p class="pdp-note" :class="{ 'pdp-warn': t03Error }">
            <template v-if="!t03Available">模板实例端点未接入——成因/经验不会自动保存，仅本机暂存；勾选「入案例库」仍会立即登记入库（不可撤回）。</template>
            <template v-else-if="t03Instance">
              人填内容写入模板三实例 #{{ t03Instance.id }}（{{ t03Instance.periodKey }}）：
              {{ t03Locked ? '实例已提交锁定，内容只读' : '编辑后自动存草稿' }}{{ t03SavedAt ? ` · 最近保存 ${t03SavedAt}` : '' }}<template v-if="t03Error"> · {{ t03Error }}</template>
            </template>
            <template v-else>本月无模板三实例（触发引擎未生成）——成因/经验不会自动保存，仅本机暂存；勾选「入案例库」仍会立即登记入库（不可撤回）。</template>
          </p>
          <table class="pdp-table pdp-top-table">
            <thead>
              <tr><th>#</th><th>日期</th><th>类型</th><th>盈亏 元</th><th>主要成因（人填）</th><th>可复制经验/改进点</th><th>入案例库</th></tr>
            </thead>
            <tbody>
              <tr v-for="t in top5" :key="t.date">
                <td>{{ t.rank }}</td>
                <td>{{ t.date }}</td>
                <td :class="t.type === '亏损' ? 'bad' : 'good'">{{ t.type }}</td>
                <td>{{ Math.round(t.pnlYuan).toLocaleString() }}</td>
                <td><input v-model="draftOf(t.date).mainCause" class="pdp-input"
                  :disabled="t03Locked || caseState[t.date]?.status === 'done'"
                  :title="caseState[t.date]?.status === 'done' ? `已沉淀至案例库（${caseState[t.date]?.caseNo ?? ''}）：档案不可改写，如需更正请登记新案例` : undefined"
                  placeholder="市场机会/策略有效/执行到位…" /></td>
                <td><input v-model="draftOf(t.date).lesson" class="pdp-input"
                  :disabled="t03Locked || caseState[t.date]?.status === 'done'"
                  :title="caseState[t.date]?.status === 'done' ? `已沉淀至案例库（${caseState[t.date]?.caseNo ?? ''}）：档案不可改写，如需更正请登记新案例` : undefined"
                  placeholder="可复制经验或改进点" /></td>
                <td class="pdp-case">
                  <input
                    type="checkbox"
                    :checked="draftOf(t.date).toCase || caseState[t.date]?.status === 'done'"
                    :disabled="casesAvailable && caseState[t.date]?.status === 'done'"
                    :title="casesAvailable ? '勾选即登记案例库（沉淀后不可撤回）；需先填主要成因与可复制经验' : '案例库端点未接入：勾选仅本地记录，不落库'"
                    @change="onToCaseChange(t, ($event.target as HTMLInputElement).checked)"
                  />
                  <span v-if="caseState[t.date]?.status === 'sinking'" class="pdp-case-note">登记中…</span>
                  <span v-else-if="caseState[t.date]?.status === 'done'" class="pdp-case-ok">{{ caseState[t.date]?.caseNo }}</span>
                  <span v-else-if="!casesAvailable" class="pdp-case-note" >本地</span>
                  <template v-else-if="caseState[t.date]?.status === 'error'">
                    <span class="pdp-case-err">{{ caseState[t.date]?.error }}</span>
                    <button type="button" class="pdp-retry" @click="retrySinkTopCase(t)">重试</button>
                  </template>
                </td>
              </tr>
            </tbody>
          </table>
          <p class="pdp-note">
            Top5 与拆解表同源同口径（同一次 /review 聚合产出）；金额 self-computed。
            「是否入库=勾选」即登记案例库（review.cases，deviation 档案纪律：四要素必填、沉淀后不可改写、无 DELETE）；
            端点缺席环境保持本地勾选并如实标注「本地」，不谎报已入库。
          </p>
        </div>

        <!-- 反事实定位：策略对比视图（占位声明） -->
        <p class="pdp-note">
          反事实分析定位为「策略对比」视图：包装 quant 引擎的假设推演，页面将显著标注
          <b>「决策参考，非结算依据」</b>——与正式复盘口径分离呈现。
        </p>
      </template>
    </template>
  </section>
</template>

<style scoped>
.pdp { display: flex; flex-direction: column; gap: 10px; font-size: var(--font-12-5); }
/* 三层内容卡片化：白底 + 细边 + 浅阴影，与系统卡片调性一致（--radius/--shadow 主题化） */
.pdp-card {
  display: flex; flex-direction: column; gap: 8px;
  padding: 12px 14px;
  border: 1px solid var(--line, #d9e2ec);
  border-radius: var(--radius, 6px);
  background: var(--panel, #fff);
  box-shadow: var(--shadow, 0 1px 2px rgba(15, 23, 42, 0.04));
}
.pdp-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; }
.pdp-head input { padding: 2px 6px; border: 1px solid var(--el-border-color, #dcdfe6); border-radius: 6px; font-size: var(--font-11-5); }
.pdp-muted { margin: 0; color: var(--el-text-color-secondary, #909399); }
.pdp-note { margin: 0; font-size: var(--font-xs); color: var(--el-text-color-secondary, #909399); line-height: 1.6; }
.pdp-warn { margin: 0; padding: 6px 9px; border-radius: 6px; background: #fffbeb; color: #92400e; font-size: var(--font-11-5); line-height: 1.6; }
.pdp-seg b, .pdp-top b { font-size: var(--font-12-5); display: block; margin-bottom: 4px; }
.pdp-top i { font-style: normal; font-size: var(--font-10-5); color: var(--el-text-color-secondary, #909399); font-weight: 400; }
.pdp-table { width: 100%; border-collapse: collapse; font-size: var(--font-11-5); font-variant-numeric: tabular-nums; }
.pdp-table th, .pdp-table td { padding: 3px 7px; border-bottom: 1px solid var(--el-border-color-lighter, #ebeef5); text-align: right; white-space: nowrap; }
.pdp-table th { color: var(--el-text-color-secondary, #666); font-weight: 500; font-size: var(--font-10-5); }
.pdp-table th:nth-child(n+5), .pdp-table td:nth-child(n+5) { text-align: left; white-space: normal; }
.pdp-table .good { color: #15803d; }
.pdp-table .bad { color: #b91c1c; }
.pdp-input { width: 100%; min-width: 120px; padding: 2px 6px; border: 1px solid var(--el-border-color, #dcdfe6); border-radius: 5px; font-size: var(--font-11-5); box-sizing: border-box; }
.pdp-case { white-space: normal; min-width: 90px; }
.pdp-case input { cursor: pointer; }
.pdp-case-note { display: block; font-size: var(--font-10-5); color: var(--el-text-color-secondary, #909399); }
.pdp-case-ok { display: block; font-size: var(--font-10-5); color: #15803d; font-variant-numeric: tabular-nums; }
.pdp-case-err { display: block; font-size: var(--font-10-5); color: #b91c1c; line-height: 1.5; }
.pdp-retry { border: 0; background: transparent; color: var(--el-color-primary, #2563eb); font: inherit; font-size: var(--font-10-5); cursor: pointer; padding: 0; text-decoration: underline; }
</style>
