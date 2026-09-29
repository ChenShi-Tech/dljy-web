<script setup lang="ts">
// 套保工作台「今明两日」页签（openspec build-midlong-spot-hedging 任务 8.1—8.3，HW-01..04/08；#3420 自外壳拆出）。
//
// 默认页签：今天+明天逐时段敞口（含机制/仅中长期两条，未知断开不连线），标准指标卡展示两个套保率与生效方案判级，
// 服务端需关注清单与数据缺口单独成区。挂载即加载；作用域（公司|地区|认知时点|粒度）任一变化立即清空旧结果并
// 防抖重取（HW-06）；维护页签写入成功后重取。外壳 KeepAlive 保活本页签，失活期间以上重取照常进行。
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { HedgeApiError, fetchOverview } from '@/services/hedge/hedgeApi'
import type { HedgeOverview } from '@/services/hedge/hedgeApi'
import { injectHedgeWorkbench, today2Range } from '../useHedgeWorkbench'

const workbench = injectHedgeWorkbench()

const loading = ref(false)
const loadError = ref<string | null>(null)
const overview = ref<HedgeOverview | null>(null)
let inFlight: ReturnType<typeof setTimeout> | null = null

async function load() {
  if (!workbench.regionOpen.value) return
  const current = workbench.scopedRequest()
  loading.value = true
  loadError.value = null
  try {
    const range = today2Range()
    const data = await fetchOverview({
      fromDate: range.fromDate, toDate: range.toDate, granularity: workbench.granularity.value,
      scope: 'company', asOf: workbench.asOf.value ?? undefined,
    })
    if (!current()) return // HW-06：迟到响应丢弃
    overview.value = data
    workbench.syncAsOfBanner()
  } catch (err) {
    if (!current()) return
    loadError.value = err instanceof HedgeApiError
      ? `${err.errorCode}：${err.message}`
      : '数据加载失败，可重试'
    overview.value = null
  } finally {
    if (current()) loading.value = false
  }
}

function scheduleLoad() {
  if (inFlight) clearTimeout(inFlight)
  inFlight = setTimeout(load, 150)
}

// HW-06：切换公司/地区/认知时点/粒度即清空旧结果，并按新范围重取（#3401：切公司后不得显示上一家公司的数据）。
watch(workbench.scopeKey, () => {
  overview.value = null
  scheduleLoad()
})
// 维护写入成功（区间方案、月度基准、机制参数）后重取：写入后下一次读取即反映到套保计算。
watch(workbench.dataRevision, () => { void load() })

onMounted(load)
onBeforeUnmount(() => { if (inFlight) clearTimeout(inFlight) })
</script>

<template>
  <div class="hedge-today-tab">
    <p v-if="loadError" class="load-error" data-test="load-error">{{ loadError }}</p>
    <p v-else-if="loading" data-test="loading">加载中…</p>

    <section v-if="overview" class="body">
      <div class="metrics" data-test="metrics">
        <div class="metric-card" data-test="metric-today2">
          <h3>今明两日逐时段套保率</h3>
          <p>含机制：<b>{{ overview.ratio.withMechanism.value ?? '不可计算' }}</b>（{{ overview.ratio.withMechanism.status }}）</p>
          <p>仅中长期：<b>{{ overview.ratio.midlongOnly.value ?? '不可计算' }}</b>（{{ overview.ratio.midlongOnly.status }}）</p>
          <p data-test="assessment">
            判级：{{ overview.standardMetrics?.TODAY2_INTERVAL?.level ?? '未评估' }}
            <span v-if="overview.standardMetrics?.TODAY2_INTERVAL?.reason">
              （未评估：{{ overview.standardMetrics?.TODAY2_INTERVAL.reason }}）</span>
          </p>
          <p v-if="overview.scheme" class="scheme">生效方案：{{ overview.scheme.name }} v{{ overview.scheme.versionNo }}（{{ overview.scheme.basis === 'WITH_MECHANISM' ? '含机制' : '仅中长期' }} 判级）</p>
          <p v-else class="scheme">未评估：套保区间未配置</p>
        </div>
        <div class="metric-card" data-test="sensitivity">
          <h3>价格敏感度</h3>
          <p>{{ overview.sensitivity?.value ?? '不完整' }}<span v-if="overview.sensitivity?.note">（{{ overview.sensitivity?.note }}）</span></p>
        </div>
      </div>

      <section class="intervals" data-test="intervals">
        <h3>逐时段敞口（未知时段断开，不做平滑/插值）</h3>
        <table>
          <thead>
            <tr><th>时段</th><th>发电</th><th>来源</th><th>中长期</th><th>机制</th><th>敞口（含机制）</th><th>敞口（仅中长期）</th></tr>
          </thead>
          <tbody>
            <tr v-for="row in overview.intervals" :key="row.start" :class="{ uncovered: row.generation.value === null || row.locked.midlong === null }">
              <td>{{ row.start.slice(11, 16) }}</td>
              <td>{{ row.generation.value ?? '未知' }}</td>
              <td>{{ row.generation.value === null ? (row.generation.uncoveredReason ?? "未知") : row.generation.source }}</td>
              <td>{{ row.locked.midlong ?? '未知' }}</td>
              <td>{{ row.locked.mechanism.value ?? '未知' }}<span v-if="row.locked.mechanism.note">（{{ row.locked.mechanism.note }}）</span></td>
              <td>{{ row.exposure.withMechanism ?? '未知' }}</td>
              <td>{{ row.exposure.midlongOnly ?? '未知' }}</td>
            </tr>
          </tbody>
        </table>
      </section>

      <section class="watchlist" data-test="watchlist">
        <h3>需关注时段（服务端生成）</h3>
        <p v-if="!overview.watchlist.rows.length">暂无已覆盖的风险时段</p>
        <ul v-else>
          <li v-for="(row, wi) in overview.watchlist.rows" :key="wi">
            {{ String(row.start ?? '').slice(11, 16) }} 敞口 {{ row.exposureMwh }} MWh（{{ row.direction === 'SELL' ? '多发卖出' : '买入' }}）
            <span v-if="row.note">【{{ row.note }}】</span>
            <span v-if="row.priceTag">【{{ row.priceTag }}】</span>
          </li>
        </ul>
        <p class="disclaimer">{{ overview.watchlist.disclaimer }}</p>
      </section>

      <section class="gaps" data-test="gaps">
        <h3>数据缺口</h3>
        <ul><li v-for="(gap, i) in overview.gaps" :key="i">{{ gap.code }}：{{ gap.message }}</li></ul>
        <p v-if="!overview.gaps.length">无</p>
      </section>
    </section>
  </div>
</template>

<style scoped>
.metric-card { border: 1px solid #e5e7eb; border-radius: 6px; padding: 12px; }
.metrics { display: flex; gap: 12px; }
.intervals table { width: 100%; border-collapse: collapse; font-size: var(--font-sm, 13px); }
.intervals th, .intervals td { border-bottom: 1px solid #f0f0f0; padding: 4px 8px; text-align: left; }
tr.uncovered td { color: #9ca3af; }
.watchlist .disclaimer { color: #9ca3af; font-size: var(--font-xs, 12px); }
.load-error { color: #b91c1c; }
</style>
