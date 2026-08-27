<script setup lang="ts">
// 月度市场归因面板（Epic #2033 · M3 · #2046：模板六）
// ---------------------------------------------------------------------------
// 四行结构：价格走势/供需形势 A 档自动预填（市场经营分析真取数，basis 随行标注）；
// 政策变化人工 + AI 建议占位（不做自动因果声明）；异常价格事件月粒度规则识别
// （#2047 端点上线后登记入风险事件库并双向引用）；「下月关注点」转行动项落
// review.improvement_actions（写入端点上线，端点缺席环境仍诚实降级本地清单）。
import { computed, onMounted, ref, watch } from 'vue'
import { loadMarketAnalysis, type MarketAnalysisResult } from '@/services/market/marketAnalysis'
import { DATA_BASIS_LABEL } from '@/services/dataBasis'
import {
  anomalyMonths,
  monthPriceStats,
  supplyDemandDirection
} from '@/services/review/marketAttribution'
import {
  createImprovementAction,
  fetchImprovementActions,
  fetchRiskEvents,
  patchImprovementAction,
  registerRiskEvent
} from '@/services/review/reviewStoreClient'
import type { ImprovementActionSummary, RiskEventSummary } from '@/services/review/reviewStoreApi'
import { currentMonthBeijing } from '@/utils/beijingDate'

const month = ref(currentMonthBeijing())
const loading = ref(false)
const result = ref<MarketAnalysisResult | null>(null)
const loadError = ref('')

function prevMonthOf(ym: string): string {
  const [y, m] = ym.split('-').map(Number)
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`
}

async function load() {
  loading.value = true
  loadError.value = ''
  try {
    result.value = await loadMarketAnalysis(Number(month.value.slice(0, 4)))
  } catch (e) {
    result.value = null
    loadError.value = e instanceof Error ? e.message : '市场分析取数失败'
  } finally {
    loading.value = false
  }
  await loadServerState()
}
onMounted(load)
watch(month, load)

const ds = computed(() => result.value?.dataset ?? null)
const price = computed(() => (ds.value ? monthPriceStats(ds.value.priceTrend, month.value) : null))
const supplyDemand = computed(() =>
  ds.value ? supplyDemandDirection(ds.value.monthlyTrend, month.value, prevMonthOf(month.value)) : null
)
const anomaly = computed(() => (ds.value ? anomalyMonths(ds.value.priceTrend) : null))
const basisLabel = computed(() => (result.value ? DATA_BASIS_LABEL[result.value.basis] : ''))

// 政策行：人工关联 + AI 建议占位（不做自动因果）
const policyText = ref('')

// ── 服务端接线（#2046 尾巴收口）：关注点落库 + 异常事件登记 ──────────────────
const actionsAvailable = ref(false)
const actionsNote = ref('')
const savedActions = ref<ImprovementActionSummary[]>([])
const focusLocal = ref<string[]>([])
const focusInput = ref('')
const actionBusy = ref(false)
const actionError = ref('')

/** 已登记的本月风险事件（与异常识别行双向引用的「事件库侧」）。 */
const monthRiskEvents = ref<RiskEventSummary[]>([])
const eventsAvailable = ref(false)
const eventBusy = ref(false)
const eventError = ref('')

async function loadServerState() {
  const feed = await fetchImprovementActions('open')
  if (feed.available) {
    actionsAvailable.value = true
    savedActions.value = feed.actions
  } else {
    actionsAvailable.value = false
    actionsNote.value =
      feed.reason === 'endpoint-absent'
        ? 'improvement_actions 端点未上线：关注点暂存本地清单，不落库（端点上线后自动切换）。'
        : 'improvement_actions 端点不可达：关注点暂存本地清单，可稍后重试。'
  }
  const [y, m] = month.value.split('-').map(Number)
  const until = `${y}-${String(m).padStart(2, '0')}-31T23:59:59Z`
  const evFeed = await fetchRiskEvents({ since: `${month.value}-01`, until })
  if (evFeed.available) {
    eventsAvailable.value = true
    monthRiskEvents.value = evFeed.events
  } else {
    eventsAvailable.value = false
  }
}

async function addFocus() {
  const t = focusInput.value.trim()
  if (!t) return
  if (!actionsAvailable.value) {
    focusLocal.value.push(t)
    focusInput.value = ''
    return
  }
  actionBusy.value = true
  actionError.value = ''
  try {
    savedActions.value = [...savedActions.value, await createImprovementAction({ action: t })]
    focusInput.value = ''
  } catch (e) {
    actionError.value = e instanceof Error ? e.message : '行动项写入失败'
  } finally {
    actionBusy.value = false
  }
}

async function removeFocus(i: number) {
  if (!actionsAvailable.value) {
    focusLocal.value.splice(i, 1)
    return
  }
  const target = savedActions.value[i]
  if (!target) return
  actionBusy.value = true
  actionError.value = ''
  try {
    await patchImprovementAction(target.id, { status: 'dropped' })
    savedActions.value = savedActions.value.filter((a) => a.id !== target.id)
  } catch (e) {
    actionError.value = e instanceof Error ? e.message : '行动项移除失败'
  } finally {
    actionBusy.value = false
  }
}

/** 异常价格月登记入风险事件库（时间取月首，月粒度规则口径；金额不猜恒 null）。 */
async function registerAnomaly(m: string, devPct: number) {
  eventBusy.value = true
  eventError.value = ''
  try {
    const ev = await registerRiskEvent({
      eventTime: `${m}-01T00:00:00Z`,
      eventType: 'price_anomaly',
      riskLevel: Math.abs(devPct) >= 0.3 ? 'high' : 'medium',
      impactYuan: null,
      // #2046 极值/持续时长：月粒度数据无逐时极值与持续口径——如实 null，lessons 注明 data_gap
      extremeValue: null,
      durationHours: null,
      lessons: `月粒度 2σ 规则识别：偏离年均 ${(devPct * 100).toFixed(1)}%（data_gap：月内逐时极值与持续时长需 clearing_price 逐时数据，当前未记录）`
    })
    monthRiskEvents.value = [ev, ...monthRiskEvents.value]
  } catch (e) {
    eventError.value = e instanceof Error ? e.message : '风险事件登记失败'
  } finally {
    eventBusy.value = false
  }
}
</script>

<template>
  <section class="map">
    <header class="map-head">
      <b>月度市场归因报告（模板六 · 四行）</b>
      <input v-model="month" type="month" />
    </header>

    <p v-if="loading" class="map-muted">读市场经营分析取数（9 数据集回放）…</p>
    <p v-else-if="loadError" class="map-warn">取数失败：{{ loadError }}——四行不出数，不合成。</p>

    <template v-else-if="ds">
      <p class="map-basis">
        数据基线：{{ basisLabel }}<template v-if="result?.basis === 'synthetic'">（无真实回放时演示兜底——<b>不可作为复盘依据</b>）</template>
      </p>

      <table class="map-table">
        <thead><tr><th>归因行</th><th>自动预填（A 档）</th><th>口径说明</th></tr></thead>
        <tbody>
          <tr>
            <td>价格走势</td>
            <td>
              <template v-if="price?.spotPrice !== null && price?.spotPrice !== undefined">
                月现货均价 {{ price.spotPrice.toFixed(1) }} 元/MWh · 中长期 {{ price.mediumLongPrice?.toFixed(1) ?? '—' }}
                · 较年均 {{ price.devFromYearMeanPct === null ? '—' : (price.devFromYearMeanPct * 100).toFixed(1) + '%' }}
              </template>
              <span v-else class="map-muted">本月无价格数据</span>
            </td>
            <td>market_analysis priceTrend（{{ basisLabel }}）</td>
          </tr>
          <tr>
            <td>供需形势</td>
            <td>
              <b>{{ supplyDemand?.direction }}</b>
              <p class="map-note">{{ supplyDemand?.note }}</p>
            </td>
            <td>market_analysis monthlyTrend（量价方向代理 v1）</td>
          </tr>
          <tr>
            <td>政策变化</td>
            <td>
              <textarea v-model="policyText" rows="2" class="map-input" placeholder="人工关联政策事件（披露库/政策情报）" />
              <p class="map-note">AI 可建议关联项（随 #2044 调度上线）；<b>不做自动因果</b>——政策与价格的因果由人判定。</p>
            </td>
            <td>人工 + AI 建议（B 档）</td>
          </tr>
          <tr>
            <td>异常价格事件</td>
            <td>
              <template v-if="anomaly?.events.length">
                <p v-for="e in anomaly.events" :key="e.month" class="map-event">
                  {{ e.month }}：{{ e.spotPrice.toFixed(1) }} 元/MWh（偏离年均 {{ e.devFromMeanYuan >= 0 ? '+' : '' }}{{ e.devFromMeanYuan.toFixed(1) }}，
                  {{ (e.devFromMeanPct * 100).toFixed(1) }}%）
                  <button
                    v-if="eventsAvailable && !monthRiskEvents.some((r) => r.eventType === 'price_anomaly' && r.eventTime.startsWith(e.month))"
                    type="button" class="map-reg" :disabled="eventBusy" @click="registerAnomaly(e.month, e.devFromMeanPct)"
                  >登记入风险事件库</button>
                </p>
              </template>
              <p class="map-note">{{ anomaly?.note }}</p>
              <template v-if="eventsAvailable && monthRiskEvents.length">
                <p class="map-note">事件库侧（{{ month }} 已登记）：</p>
                <p v-for="r in monthRiskEvents" :key="r.id" class="map-event">
                  {{ r.eventTime.slice(0, 10) }} · {{ r.eventType }}{{ r.nearMiss ? '（near_miss·不计损失）' : '' }}{{ r.riskLevel ? ` · ${r.riskLevel}` : '' }}
                </p>
              </template>
            </td>
            <td>月粒度规则（2σ）；与风险事件库（#2047）<b>双向引用</b>：识别行可登记，事件库侧回显</td>
          </tr>
        </tbody>
      </table>

      <p v-if="eventError" class="map-warn">{{ eventError }}</p>
      <p class="map-note">
        异常事件与风险事件库双向引用已接通（review.risk_events 读写端点）；
        端点未部署的环境保持只读识别，不合成登记记录。
      </p>

      <!-- 下月关注点 → 行动项 -->
      <div class="map-focus">
        <b>下月关注点 → 行动项（纳入月度策略会讨论）</b>
        <div class="map-focus-add">
          <input v-model="focusInput" class="map-input" placeholder="如：晚高峰供需趋紧，关注现货价格上限政策落地" @keyup.enter="addFocus" />
          <button type="button" :disabled="actionBusy" @click="addFocus">加入</button>
        </div>
        <template v-if="actionsAvailable">
          <p v-for="(a, i) in savedActions" :key="a.id" class="map-focus-item">
            {{ a.action }} <button type="button" class="map-x" :disabled="actionBusy" @click="removeFocus(i)">×</button>
          </p>
        </template>
        <template v-else>
          <p v-for="(f, i) in focusLocal" :key="i" class="map-focus-item">
            {{ f }} <button type="button" class="map-x" @click="removeFocus(i)">×</button>
          </p>
        </template>
        <p v-if="actionError" class="map-warn">{{ actionError }}</p>
        <p class="map-note">
          {{ actionsAvailable
            ? '行动项落 review.improvement_actions（已接通写入端点；移除=标记 dropped 保留痕迹，不物理删除）。'
            : actionsNote }}
        </p>
      </div>
    </template>
  </section>
</template>

<style scoped>
.map { display: flex; flex-direction: column; gap: 8px; font-size: var(--font-12-5); }
.map-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; }
.map-head input { padding: 2px 6px; border: 1px solid var(--el-border-color, #dcdfe6); border-radius: 6px; font-size: var(--font-11-5); }
.map-muted { margin: 0; color: var(--el-text-color-secondary, #909399); }
.map-warn { margin: 0; padding: 6px 9px; border-radius: 6px; background: #fffbeb; color: #92400e; font-size: var(--font-11-5); }
.map-basis { margin: 0; font-size: var(--font-xs); color: var(--el-text-color-secondary, #909399); }
.map-table { width: 100%; border-collapse: collapse; font-size: var(--font-11-5); }
.map-table th, .map-table td { padding: 5px 8px; border-bottom: 1px solid var(--el-border-color-lighter, #ebeef5); text-align: left; vertical-align: top; }
.map-table th { color: var(--el-text-color-secondary, #666); font-weight: 500; font-size: var(--font-10-5); white-space: nowrap; }
.map-note { margin: 2px 0 0; font-size: var(--font-10-5); color: var(--el-text-color-secondary, #909399); line-height: 1.6; }
.map-event { margin: 2px 0; font-variant-numeric: tabular-nums; }
.map-input { width: 100%; padding: 4px 7px; border: 1px solid var(--el-border-color, #dcdfe6); border-radius: 6px; font-size: var(--font-11-5); box-sizing: border-box; font-family: inherit; }
.map-focus { display: flex; flex-direction: column; gap: 5px; }
.map-focus b { font-size: var(--font-sm); }
.map-focus-add { display: flex; gap: 6px; }
.map-focus-add button { padding: 3px 12px; border: 1px solid var(--el-border-color, #dcdfe6); border-radius: 6px; background: #fff; font-size: var(--font-11-5); cursor: pointer; }
.map-focus-item { margin: 0; padding: 4px 8px; border: 1px solid var(--el-border-color-lighter, #ebeef5); border-radius: 6px; font-size: var(--font-11-5); }
.map-x { border: none; background: none; color: #b91c1c; cursor: pointer; padding: 0 2px; }
.map-reg { margin-left: 6px; padding: 1px 8px; border: 1px solid var(--el-border-color, #dcdfe6); border-radius: 6px; background: #fff; font-size: var(--font-10-5); cursor: pointer; }
.map-reg:disabled { opacity: 0.5; cursor: default; }
</style>
