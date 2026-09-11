<script setup lang="ts">
// 交易月历 (zjyap/calendar) — 精修版,自绘月历(全中文/大字号/配色可控)。对照 B3:
//  全中文(星期/上个月/下个月/今天);字号调大;当天与申报窗口范围标蓝;当月说明文字绿、补齐的非本月日期灰。
// 数据:GET /sdpt/zjyap/calendar -> {jyrq(交易日), sj1(申报窗口"6月3-5日"), sj2(交易品种)}。源 capture-raw/sdpt_zjyap/。
import { onMounted, ref, computed, watch } from 'vue'
import { useRoute } from 'vue-router'
import { fetchCaptured } from '@/services/captured'
import { currentRegion } from '@/services/region/regionContext'
import { getRegionCapabilityForPath } from '@/services/region/regionModules'
import { useQuerySync } from '../composables/useQuerySync'
import { onRegionChange } from '../composables/useRegionReload'
import RegionDataBanner from '@/components/region/RegionDataBanner.vue'
import CapabilitySupportBadge from '../components/CapabilitySupportBadge.vue'
import ChartCard from '../components/common/ChartCard.vue'
import { seqColors } from '@/services/chart/chartStyle'
import { emptyOverlay } from '@/services/chart/chartOptions'

const WD = ['日', '一', '二', '三', '四', '五', '六']
const loading = ref(true)
const error = ref('')
const byDate = ref<Record<string, any>>({})
const cur = ref({ y: 2026, m: 6 }) // 当前展示年月(默认数据所在月)
const route = useRoute()
// 支持 ?month=YYYY-MM 或 ?date=YYYY-MM-DD 带参定位月份
const qMonth = typeof route.query.month === 'string' ? route.query.month : (typeof route.query.date === 'string' ? route.query.date.slice(0, 7) : '')
// 展示月份 ⇄ 路由 query 双向同步(?month=YYYY-MM),刷新/分享链接后还原当前展示月
const monthSync = ref(qMonth)
useQuerySync({ month: monthSync })
watch(cur, ({ y, m }) => { monthSync.value = `${y}-${String(m).padStart(2, '0')}` })
const routeCapability = computed(() => getRegionCapabilityForPath('/zcqjy/zjyap', currentRegion.value.id))
const requestEnabled = computed(() => !routeCapability.value || routeCapability.value.status === 'available')
let loadGeneration = 0
const today = new Date()
const ymdStr = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const todayYmd = ymdStr(today)

async function load() {
  const generation = ++loadGeneration
  loading.value = true; error.value = ''
  clearViewState()
  if (!requestEnabled.value) {
    loading.value = false
    return
  }
  try {
    const res = await fetchCaptured<any>('sdpt_zjyap', 'calendar')
    if (generation !== loadGeneration) return
    const rows = res?.rows || res?.data || []
    const map: Record<string, any> = {}
    rows.forEach((r: any) => { if (r.jyrq) map[r.jyrq] = r })
    byDate.value = map
    // 默认展示「最新数据所在月」(全量回放后 rows[0] 是最早的 2022-12,不应默认开在那)
    if (rows.length) {
      const def = rows[rows.length - 1].jyrq.slice(0, 7)
      const [y, m] = (/^\d{4}-\d{2}$/.test(monthSync.value) ? monthSync.value : def).split('-')
      cur.value = { y: +y, m: +m }
    }
  } catch (e) {
    if (generation !== loadGeneration) return
    clearViewState()
    error.value = e instanceof Error ? e.message : '加载失败'
  } finally {
    if (generation === loadGeneration) loading.value = false
  }
}

function clearViewState() {
  byDate.value = {}
}

// 申报窗口范围(sj1 "6月3-5日") → 当月内的蓝色高亮日集合
const blueSet = computed(() => {
  const set = new Set<string>()
  const pfx = `${cur.value.y}-${String(cur.value.m).padStart(2, '0')}` // 仅看当前展示月的交易日
  Object.values(byDate.value).forEach((r: any) => {
    if (!String(r.jyrq || '').startsWith(pfx)) return
    const mm = String(r.sj1 || '').match(/(\d+)月(\d+)(?:[-~](\d+))?日/)
    if (!mm) return
    const m = +mm[1], d1 = +mm[2], d2 = mm[3] ? +mm[3] : +mm[2]
    for (let d = d1; d <= d2; d++) set.add(`${cur.value.y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`)
  })
  return set
})

const weeks = computed(() => {
  const first = new Date(cur.value.y, cur.value.m - 1, 1)
  const start = new Date(first); start.setDate(1 - first.getDay()) // 回退到周日
  const out: any[][] = []
  for (let w = 0; w < 6; w++) {
    const row: any[] = []
    for (let i = 0; i < 7; i++) {
      const d = new Date(start); d.setDate(start.getDate() + w * 7 + i)
      const ymd = ymdStr(d)
      row.push({ d: d.getDate(), ymd, inMonth: d.getMonth() === cur.value.m - 1, isToday: ymd === todayYmd, blue: blueSet.value.has(ymd), data: byDate.value[ymd] })
    }
    out.push(row)
  }
  return out
})

function go(delta: number) { let { y, m } = cur.value; m += delta; if (m < 1) { m = 12; y-- } else if (m > 12) { m = 1; y++ }; cur.value = { y, m } }
function goToday() { cur.value = { y: today.getFullYear(), m: today.getMonth() + 1 } }
onMounted(load)

onRegionChange(load)

// ECharts calendar 热力图：每日申报/交易标记密度

/**
 * 派生热力图数据：遍历 byDate 全量数据，
 * 每日强度 = sj1 非空 +1、sj2 非空计品种个数（逗号/顿号分隔）。
 * 返回 [[YYYY-MM-DD, value], ...] 供 ECharts calendar heatmap 使用。
 */
const calendarData = computed<[string, number][]>(() => {
  return Object.entries(byDate.value).map(([date, r]: [string, any]) => {
    let val = 0
    // sj1 非空：申报窗口存在，+1
    if (r.sj1 && String(r.sj1).trim()) val += 1
    // sj2 非空：按逗号/顿号/空白分割计算品种个数
    if (r.sj2 && String(r.sj2).trim()) {
      const count = String(r.sj2).split(/[，,、\s]+/).filter((s: string) => s.trim()).length
      val += Math.max(count, 1) // 至少 +1，防止有值但分割为 0
    }
    return [date, val]
  })
})

/**
 * 热力图只渲染当前展示月（随「上/下个月」切换而变化）；单月直接给 'YYYY-MM'。
 * 此前恒为全量数据的首~尾月跨区，切月份图形纹丝不动，被误读为数据不随月变化。
 */
const calendarRange = computed<string>(() => `${cur.value.y}-${String(cur.value.m).padStart(2, '0')}`)

/** 构建 ECharts calendar 热力图 option（byDate 变化时 watchEffect 自动重绘）。 */
function buildCalendarOption(): Record<string, unknown> {
  const data = calendarData.value
  const isEmpty = data.length === 0

  return {
    ...emptyOverlay(isEmpty),
    tooltip: {
      trigger: 'item' as const,
      formatter: (p: any) => {
        if (!p.value) return ''
        const [date, val] = p.value as [string, number]
        const r = byDate.value[date]
        const sj1 = r?.sj1 ? String(r.sj1) : '—'
        const sj2 = r?.sj2 ? String(r.sj2) : '—'
        return `<b>${date}</b><br/>申报窗口：${sj1}<br/>交易品种：${sj2}<br/>标记密度：${val}`
      },
      backgroundColor: '#fff',
      borderColor: '#0f766e',
      borderWidth: 1,
      padding: [8, 12],
      textStyle: { color: '#1f2a37', fontSize: 12 },
      extraCssText: 'border-radius:8px;box-shadow:0 6px 24px rgba(15,23,42,.14);'
    },
    visualMap: {
      min: 0,
      max: 4, // sj1+sj2 多品种可超过 2，给更大上限避免色阶压缩
      type: 'piecewise' as const,
      orient: 'horizontal' as const,
      left: 'center',
      bottom: 4,
      pieces: [
        { value: 0, label: '无标记', color: '#f0f4f8' },
        { min: 1, max: 1, label: '仅申报', color: seqColors()[2] },
        { min: 2, max: 2, label: '申报+1品种', color: seqColors()[3] },
        { min: 3, label: '多品种', color: seqColors()[4] }
      ],
      textStyle: { fontSize: 11 }
    },
    calendar: {
      range: calendarRange.value,
      cellSize: ['auto', 18],
      top: 30,
      left: 30,
      right: 10,
      bottom: 36, // 为 visualMap 留出空间
      itemStyle: { borderColor: '#eee', borderWidth: 0.5 },
      yearLabel: { show: false },
      monthLabel: { nameMap: 'ZH', fontSize: 11, color: '#909399' },
      dayLabel: { nameMap: ['日', '一', '二', '三', '四', '五', '六'], fontSize: 10, color: '#909399' }
    },
    series: [{
      type: 'heatmap' as const,
      coordinateSystem: 'calendar' as const,
      data: isEmpty ? [] : data
    }]
  }
}
</script>

<template>
  <div class="cal" v-loading="loading">
    <RegionDataBanner />
    <CapabilitySupportBadge path="/zcqjy/zjyap" />
    <el-alert v-if="error" type="error" :closable="false" :title="error" class="mb" />
    <div v-if="!requestEnabled" class="degraded-card">
      <div class="degraded-title">当前地区不使用国网交易月历</div>
      <div class="degraded-text">
        该交易安排属于国网（sgcc）经营区数据。云南属于南方电网经营区，南网≠国网；这里是电网体系边界，不是数据缺失或回放失败，本页不会跨电网取数。
      </div>
    </div>
    <template v-else>
    <div class="head">
      <div class="title">{{ cur.y }} 年 {{ cur.m }} 月</div>
      <div class="ops">
        <el-button size="default" @click="go(-1)">上个月</el-button>
        <el-button size="default" type="primary" @click="goToday">今天</el-button>
        <el-button size="default" @click="go(1)">下个月</el-button>
      </div>
    </div>
    <!-- 交易/申报日历热力图：展示全量数据每日标记密度，独立于下方自绘月历 -->
    <ChartCard
      title="交易/申报日历热力"
      :height="240"
      :build-option="buildCalendarOption"
      style="margin-bottom: 16px"
    />

    <div class="grid">
      <div class="wd" v-for="w in WD" :key="w">星期{{ w }}</div>
      <template v-for="(row, ri) in weeks" :key="ri">
        <div v-for="c in row" :key="c.ymd" class="cell" :class="{ out: !c.inMonth, today: c.isToday, blue: c.blue }">
          <div class="num" :class="{ today: c.isToday, blue: c.blue && !c.isToday }">{{ c.d }}</div>
          <template v-if="c.data">
            <div class="win" :class="c.inMonth ? 'green' : 'grey'">{{ c.data.sj1 }}</div>
            <div class="prod" :class="c.inMonth ? 'green' : 'grey'">{{ c.data.sj2 }}</div>
          </template>
        </div>
      </template>
    </div>
    <!-- 数据源(内部参考,勿对外展示)：GET /sdpt/zjyap/calendar -->
    <p class="src"><span class="lg-blue">■</span> 今天/申报窗口范围 <span class="lg-green">■</span> 当月 <span class="lg-grey">■</span> 非本月</p>
    </template>
  </div>
</template>

<style scoped>
.cal { padding: 16px 20px; background: var(--el-fill-color-light); min-height: calc(100vh - 90px); }
.head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 14px; }
.title { font-size: var(--font-22); font-weight: 700; color: var(--text); }
.ops { display: flex; gap: 8px; }
.degraded-card { border: 1px solid color-mix(in srgb, var(--warning, #d97706) 35%, var(--line)); background: color-mix(in srgb, var(--warning, #d97706) 8%, var(--panel)); border-radius: 8px; padding: 14px 16px; color: var(--text); }
.degraded-title { font-size: var(--font-lg); font-weight: 700; margin-bottom: 6px; }
.degraded-text { font-size: var(--font-md); color: var(--muted); line-height: 1.6; }
.grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 8px; }
.wd { text-align: center; font-size: var(--font-15); font-weight: 600; color: var(--el-text-color-regular); padding: 6px 0; }
.cell { background: var(--panel); border-radius: 8px; min-height: 96px; padding: 8px 10px; box-shadow: 0 1px 3px rgba(0,0,0,.04); border: 1px solid transparent; }
.cell.out { background: var(--panel-sub); }
.cell.blue { border-color: var(--line); background: var(--panel-sub); }
.cell.today { border-color: var(--el-color-primary); box-shadow: 0 0 0 2px rgba(64,158,255,.25); }
.num { font-size: var(--font-18); font-weight: 700; color: var(--el-text-color-primary); }
.cell.out .num { color: var(--el-text-color-disabled); }
.num.blue { color: var(--el-color-primary); }
.num.today { display: inline-block; background: var(--el-color-primary); color: #fff; border-radius: 50%; width: 28px; height: 28px; line-height: 28px; text-align: center; font-size: var(--font-15); }
.win { font-size: var(--font-md); font-weight: 600; margin-top: 4px; line-height: 1.3; }
.prod { font-size: var(--font-sm); margin-top: 2px; line-height: 1.3; }
.green { color: var(--success); }
.grey { color: var(--el-text-color-disabled); }
.mb { margin-bottom: 12px; }
.src { color: var(--el-text-color-secondary); font-size: var(--font-sm); margin: 14px 0 0; }
.src code { color: var(--el-color-primary); }
.lg-blue { color: var(--line); } .lg-green { color: var(--success); } .lg-grey { color: var(--el-text-color-disabled); }

/* 移动端：7列日历横向滚动，避免列太窄不可读 */
@media (max-width: 768px) {
  .cal { padding: 10px 12px; }
  .head { flex-wrap: wrap; gap: 8px; }
  .title { font-size: var(--font-18); }
  .grid { min-width: 560px; }
  .cal { overflow-x: auto; }
  .cell { min-height: 72px; padding: 6px 6px; }
  .num { font-size: var(--font-15); }
  .wd { font-size: var(--font-sm); }
}
</style>
