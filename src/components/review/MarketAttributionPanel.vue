<script setup lang="ts">
// 月度市场归因面板（Epic #2033 · M3 · #2046：模板六；#3392 改接平台真实数据）
// ---------------------------------------------------------------------------
// 四行结构：价格走势/供需形势/异常价格事件读平台真实数据（#3392：云南
// yn_system_forecast·日前用户侧电价，其余地区 sdpt_zcqxhdl·日前全省均价，
// 负荷 sdpt_actualLoad——见 marketAttributionSource.ts，近 12 个月滚动窗口，
// 取不到时口径说明如实标「无真实数据」，绝不回落示例）；
// 政策变化人工 + AI 建议占位（不做自动因果声明）；异常价格事件月粒度规则识别
// （#2047 端点上线后登记入风险事件库并双向引用）；「下月关注点」转行动项落
// review.improvement_actions（写入端点上线，端点缺席环境仍诚实降级本地清单）。
import { computed, onMounted, ref, watch } from 'vue'
import { currentRegion } from '@/services/region/regionContext'
import PanelFetchLoading from '@/components/review/PanelFetchLoading.vue'
import {
  anomalyMonths,
  monthPriceStats,
  supplyDemandDirection
} from '@/services/review/marketAttribution'
import {
  attributionMonths,
  fetchMarketAttributionSource,
  type MarketAttributionSource
} from '@/services/review/marketAttributionSource'
import {
  createImprovementAction,
  fetchImprovementActions,
  fetchRiskEvents,
  patchImprovementAction,
  registerRiskEvent
} from '@/services/review/reviewStoreClient'
import type { ImprovementActionSummary, RiskEventSummary } from '@/services/review/reviewStoreApi'
import { currentMonthBeijing } from '@/utils/beijingDate'

const props = defineProps<{ reviewMonth?: string }>()
// 默认归因复盘日期所在月（走查 K2-3 同族）：锚死当前月会让月度归因四行
// 与页面复盘日期各说各话；用户仍可手动切月。
const month = ref(props.reviewMonth || currentMonthBeijing())
watch(() => props.reviewMonth, (m) => {
  if (m && m !== month.value) month.value = m
})
const loading = ref(false)
const loadError = ref('')
const source = ref<MarketAttributionSource | null>(null)
// 快速切月/切地区时旧请求后返回不得覆盖新结果（loadGeneration 代次守卫，同 #415 惯例）。
let loadGeneration = 0

function prevMonthOf(ym: string): string {
  const [y, m] = ym.split('-').map(Number)
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`
}

async function load() {
  const generation = ++loadGeneration
  loading.value = true
  loadError.value = ''
  try {
    const src = await fetchMarketAttributionSource({ region: currentRegion.value.id, month: month.value })
    if (generation !== loadGeneration) return
    source.value = src
  } catch (e) {
    if (generation !== loadGeneration) return
    source.value = null
    loadError.value = e instanceof Error ? e.message : '市场归因取数失败'
  } finally {
    if (generation === loadGeneration) loading.value = false
  }
  await loadServerState(generation)
}
onMounted(load)
watch(month, load)
watch(() => currentRegion.value.id, load)

const points = computed(() => source.value?.points ?? [])
const price = computed(() => monthPriceStats(points.value, month.value))
const supplyDemand = computed(() => supplyDemandDirection(points.value, month.value, prevMonthOf(month.value)))
const anomaly = computed(() => anomalyMonths(points.value))
const NO_REAL_DATA = '无真实数据'

/** 数据覆盖月份区间：首个到最后一个非空月（「2025-10 ~ 2026-05」），全空为空串。 */
function coverageOf(values: Array<number | null>): string {
  const months = points.value.map((p) => p.month)
  let first = -1
  let last = -1
  values.forEach((v, i) => {
    if (v !== null) {
      if (first < 0) first = i
      last = i
    }
  })
  if (first < 0) return ''
  return months[first] === months[last] ? months[first] : `${months[first]} ~ ${months[last]}`
}

function basisTextOf(src: MarketAttributionSource['priceSource'] | undefined, covered: string): string {
  if (!src || src.basis !== 'captured') return NO_REAL_DATA
  return covered ? `${src.family} · ${src.label}（${covered}）` : `${src.family} · ${src.label}`
}
const priceBasisText = computed(() => basisTextOf(source.value?.priceSource, coverageOf(points.value.map((p) => p.spotPrice))))
const loadBasisText = computed(() => basisTextOf(source.value?.loadSource, coverageOf(points.value.map((p) => p.avgLoad))))
/** 带符号百分数（+12.3% / -4.5%）。 */
function signedPct(v: number | null): string {
  return v === null ? '—' : `${v >= 0 ? '+' : ''}${(v * 100).toFixed(1)}%`
}

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

/**
 * 滚动窗口（复盘月及此前 11 个月）内已登记的风险事件。异常月可能落在窗口内任一月，
 * 「是否已登记」必须按异常月本身核对——只查复盘月会让历史异常月已登记仍出现按钮，
 * 切到相邻复盘月后窗口均值与说明文字变化，重复登记同一异常（#206 R1-01）。
 */
const windowRiskEvents = ref<RiskEventSummary[]>([])
/** 复盘月内已登记的风险事件（与异常识别行双向引用的「事件库侧」回显）。 */
const monthRiskEvents = computed(() => windowRiskEvents.value.filter((r) => r.eventTime.startsWith(month.value)))
/** 该异常月是否已在事件库登记过价格异常。 */
function anomalyRegistered(m: string): boolean {
  return windowRiskEvents.value.some((r) => r.eventType === 'price_anomaly' && r.eventTime.startsWith(m))
}

function monthEndIso(ym: string): string {
  const [y, m] = ym.split('-').map(Number)
  return `${ym}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}T23:59:59Z`
}
const eventsAvailable = ref(false)
const eventBusy = ref(false)
const eventError = ref('')

async function loadServerState(generation: number) {
  const feed = await fetchImprovementActions('open')
  // 快速切月/切地区时旧轮次后返回不得覆盖新轮次（与 load 同一代次守卫）
  if (generation !== loadGeneration) return
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
  const windowMonths = attributionMonths(month.value)
  const since = `${windowMonths[0] ?? month.value}-01`
  const evFeed = await fetchRiskEvents({ since, until: monthEndIso(month.value) })
  if (generation !== loadGeneration) return
  if (evFeed.available) {
    eventsAvailable.value = true
    windowRiskEvents.value = evFeed.events
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
  // 服务端不按幂等键去重、表上也无唯一约束：已登记的异常月在客户端就拦下，不再提交
  if (anomalyRegistered(m)) return
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
      lessons: `月粒度 2σ 规则识别：偏离近 12 个月均值 ${(devPct * 100).toFixed(1)}%（data_gap：月内逐时极值与持续时长需逐时价格数据，当前未记录）`
    },
    // 幂等键只由「地区 + 异常月」决定：说明文字随滚动窗口变化，按内容派生的键会让
    // 同一异常月在不同复盘月下生成不同键（#206 R1-01）
    `re-price-anomaly-${currentRegion.value.id}-${m}`)
    windowRiskEvents.value = [ev, ...windowRiskEvents.value]
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

    <!-- 单次取数无分批进度：进度条走 indeterminate 慢滑，骨架同款 -->
    <PanelFetchLoading v-if="loading" text="读平台真实现货价与系统负荷（近 12 个月）…" />
    <p v-else-if="loadError" class="map-warn">取数失败：{{ loadError }}——四行不出数，不合成。</p>

    <template v-else-if="source">
      <!-- 内容卡片化：四行归因主表 + 下月关注点各成卡片（白底+细边+浅阴影，与系统调性一致） -->
      <div class="map-card">
      <table class="map-table">
        <thead><tr><th>归因行</th><th>自动预填（A 档）</th><th>口径说明</th></tr></thead>
        <tbody>
          <tr>
            <td>价格走势</td>
            <td>
              <template v-if="price.spotPrice !== null">
                月现货均价 {{ price.spotPrice.toFixed(1) }} 元/MWh · 中长期 暂无公共来源
                · 较近 12 个月均值 {{ signedPct(price.devFromTrailingMeanPct) }}
              </template>
              <span v-else class="map-muted">{{ NO_REAL_DATA }}（中长期成交均价亦无全省公共来源，不找替代、不合成）</span>
            </td>
            <td>价格：{{ priceBasisText }}</td>
          </tr>
          <tr>
            <td>供需形势</td>
            <td>
              <b>{{ supplyDemand.direction }}</b>
              <p class="map-note">{{ supplyDemand.note }}</p>
            </td>
            <td>负荷：{{ loadBasisText }}<br />判定口径：月均负荷环比 × 月现货均价环比</td>
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
              <template v-if="anomaly.events.length">
                <p v-for="e in anomaly.events" :key="e.month" class="map-event">
                  {{ e.month }}：{{ e.spotPrice.toFixed(1) }} 元/MWh（偏离近 12 个月均值 {{ e.devFromMeanYuan >= 0 ? '+' : '' }}{{ e.devFromMeanYuan.toFixed(1) }}，
                  {{ (e.devFromMeanPct * 100).toFixed(1) }}%）
                  <button
                    v-if="eventsAvailable && !anomalyRegistered(e.month)"
                    type="button" class="map-reg" :disabled="eventBusy" @click="registerAnomaly(e.month, e.devFromMeanPct)"
                  >登记入风险事件库</button>
                </p>
              </template>
              <p class="map-note">{{ anomaly.note }}</p>
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
      </div>

      <div class="map-card">
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
      </div>
    </template>
  </section>
</template>

<style scoped>
.map { display: flex; flex-direction: column; gap: 8px; font-size: var(--font-12-5); }
/* 内容卡片化：白底 + 细边 + 浅阴影，与系统卡片调性一致（--radius/--shadow 主题化） */
.map-card {
  display: flex; flex-direction: column; gap: 8px;
  padding: 12px 14px;
  border: 1px solid var(--line, #d9e2ec);
  border-radius: var(--radius, 6px);
  background: var(--panel, #fff);
  box-shadow: var(--shadow, 0 1px 2px rgba(15, 23, 42, 0.04));
}
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
