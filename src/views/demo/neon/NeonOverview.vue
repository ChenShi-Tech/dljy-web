<template>
  <div class="neon-root">
    <!-- ambient glow blobs -->
    <div class="blob b1" />
    <div class="blob b2" />
    <div class="blob b3" />
    <div class="grid-overlay" />

    <div class="cockpit">
      <!-- header -->
      <header class="topbar fade" style="--d: 0ms">
        <div class="brand">
          <div class="logo">⚡</div>
          <div>
            <h1>电力交易决策驾驶舱</h1>
            <p>SHANXI SPOT MARKET · 实时态势感知</p>
          </div>
        </div>
        <div class="status">
          <span class="live"><i class="dot" />实时在线</span>
          <span class="clock">{{ clock }}</span>
          <span class="tag">霓虹暗色 · NEON</span>
        </div>
      </header>

      <!-- KPI row -->
      <section
        v-for="(k, i) in kpis"
        :key="k.label"
        class="card kpi fade"
        :style="{ '--d': 80 + i * 70 + 'ms' }"
      >
        <div class="kpi-top">
          <span class="kpi-label">{{ k.label }}</span>
          <span class="kpi-delta" :class="k.delta >= 0 ? 'up' : 'down'">
            {{ k.delta >= 0 ? '▲' : '▼' }} {{ Math.abs(k.delta) }}%
          </span>
        </div>
        <div class="kpi-value">
          {{ kpiVals[i] }}<span class="kpi-unit">{{ k.unit }}</span>
        </div>
        <svg class="spark" viewBox="0 0 100 28" preserveAspectRatio="none">
          <polyline :points="sparkPts(k.spark)" />
        </svg>
      </section>

      <!-- main chart -->
      <section class="card chart-main fade" style="--d: 560ms">
        <div class="card-head">
          <h2>现货价格曲线 · 日前 vs 实时</h2>
          <div class="legend">
            <span><i class="sw c1" />日前出清价</span>
            <span><i class="sw c2" />实时出清价</span>
          </div>
        </div>
        <div ref="mainEl" class="chart-box" />
      </section>

      <!-- new energy panel -->
      <section class="card ne-panel fade" style="--d: 640ms">
        <div class="card-head"><h2>新能源出力占比</h2></div>
        <div ref="neEl" class="chart-box small" />
      </section>

      <!-- region snapshot -->
      <section class="card region fade" style="--d: 720ms">
        <div class="card-head"><h2>分区出清快照</h2></div>
        <table class="snap">
          <thead>
            <tr><th>区域</th><th>出清价</th><th>负荷(MW)</th><th>新能源%</th><th>态势</th></tr>
          </thead>
          <tbody>
            <tr v-for="r in regionRows" :key="r.region">
              <td class="rname">{{ r.region }}</td>
              <td class="num">{{ r.price.toFixed(1) }}</td>
              <td class="num">{{ r.load }}</td>
              <td class="num">{{ r.ne.toFixed(1) }}</td>
              <td><span class="pill" :class="statusClass(r.status)">{{ r.status }}</span></td>
            </tr>
          </tbody>
        </table>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from 'vue'
import * as echarts from 'echarts'
import { kpis, regionRows, timeLabels, dayAhead, realtime, newEnergyShare } from '../mock'
import { useCountUp } from '@/composables/useCountUp'

const clock = ref(new Date().toLocaleTimeString('zh-CN', { hour12: false }))
let timer = 0
const kpiVals = kpis.map((k, i) => useCountUp(k.value, { decimals: k.decimals ?? 0, delay: 120 + i * 80, duration: 1500 }))

const sparkPts = (arr: number[]) => {
  const min = Math.min(...arr), max = Math.max(...arr), span = max - min || 1
  return arr.map((v, i) => `${(i / (arr.length - 1)) * 100},${28 - ((v - min) / span) * 24 - 2}`).join(' ')
}
const statusClass = (s: string) => (s === '偏紧' ? 'tight' : s === '宽松' ? 'loose' : 'mid')

const mainEl = ref<HTMLElement>()
const neEl = ref<HTMLElement>()
const charts: echarts.ECharts[] = []

function grad(top: string, bottom: string) {
  return new echarts.graphic.LinearGradient(0, 0, 0, 1, [
    { offset: 0, color: top },
    { offset: 1, color: bottom },
  ])
}

function renderMain() {
  if (!mainEl.value) return
  const c = echarts.init(mainEl.value)
  charts.push(c)
  c.setOption({
    grid: { left: 48, right: 18, top: 18, bottom: 30 },
    tooltip: { trigger: 'axis', backgroundColor: 'rgba(8,12,24,.92)', borderColor: '#22d3ee', textStyle: { color: '#cde9ff' } },
    xAxis: {
      type: 'category', data: timeLabels, boundaryGap: false,
      axisLine: { lineStyle: { color: 'rgba(120,160,220,.35)' } },
      axisLabel: { color: '#7fa8d6', interval: 11, fontSize: 11 },
      splitLine: { show: false },
    },
    yAxis: {
      type: 'value', name: '元/MWh', nameTextStyle: { color: '#7fa8d6' },
      axisLabel: { color: '#7fa8d6' },
      splitLine: { lineStyle: { color: 'rgba(90,120,180,.14)' } },
    },
    series: [
      {
        name: '日前出清价', type: 'line', data: dayAhead, smooth: true, symbol: 'none',
        lineStyle: { color: '#22d3ee', width: 2.4, shadowColor: '#22d3ee', shadowBlur: 14 },
        areaStyle: { color: grad('rgba(34,211,238,.42)', 'rgba(34,211,238,0)') },
      },
      {
        name: '实时出清价', type: 'line', data: realtime, smooth: true, symbol: 'none',
        lineStyle: { color: '#e879f9', width: 2.4, shadowColor: '#e879f9', shadowBlur: 14 },
        areaStyle: { color: grad('rgba(232,121,249,.30)', 'rgba(232,121,249,0)') },
      },
    ],
  })
}

function renderNe() {
  if (!neEl.value) return
  const c = echarts.init(neEl.value)
  charts.push(c)
  c.setOption({
    grid: { left: 38, right: 14, top: 14, bottom: 26 },
    tooltip: { trigger: 'axis', backgroundColor: 'rgba(8,12,24,.92)', borderColor: '#a3e635', textStyle: { color: '#e6ffd6' } },
    xAxis: {
      type: 'category', data: timeLabels, boundaryGap: false,
      axisLine: { lineStyle: { color: 'rgba(120,160,220,.35)' } },
      axisLabel: { color: '#7fa8d6', interval: 23, fontSize: 10 },
    },
    yAxis: {
      type: 'value', max: 80, axisLabel: { color: '#7fa8d6', formatter: '{value}%' },
      splitLine: { lineStyle: { color: 'rgba(90,120,180,.14)' } },
    },
    series: [{
      type: 'line', data: newEnergyShare, smooth: true, symbol: 'none',
      lineStyle: { color: '#a3e635', width: 2.2, shadowColor: '#a3e635', shadowBlur: 12 },
      areaStyle: { color: grad('rgba(163,230,53,.4)', 'rgba(163,230,53,0)') },
    }],
  })
}

const onResize = () => charts.forEach(c => c.resize())

onMounted(() => {
  renderMain(); renderNe()
  window.addEventListener('resize', onResize)
  timer = window.setInterval(() => { clock.value = new Date().toLocaleTimeString('zh-CN', { hour12: false }) }, 1000)
})
onBeforeUnmount(() => {
  window.removeEventListener('resize', onResize)
  charts.forEach(c => c.dispose())
  window.clearInterval(timer)
})
</script>

<style scoped>
.neon-root {
  position: fixed; inset: 0; overflow: auto;
  background: radial-gradient(1200px 700px at 15% -10%, #0d1b3a 0%, #060914 55%), #04060f;
  color: #e6f0ff; font-family: 'Inter', -apple-system, 'PingFang SC', sans-serif;
}
.blob { position: fixed; border-radius: 50%; filter: blur(90px); opacity: .55; pointer-events: none; z-index: 0; }
.b1 { width: 460px; height: 460px; background: #1364ff; top: -220px; left: -140px; opacity: .4; }
.b2 { width: 520px; height: 520px; background: #b026ff; right: -160px; top: 120px; opacity: .42; }
.b3 { width: 420px; height: 420px; background: #00d4ff; bottom: -180px; left: 30%; opacity: .35; }
.grid-overlay {
  position: fixed; inset: 0; z-index: 0; pointer-events: none;
  background-image: linear-gradient(rgba(70,120,200,.06) 1px, transparent 1px), linear-gradient(90deg, rgba(70,120,200,.06) 1px, transparent 1px);
  background-size: 44px 44px;
}
.cockpit {
  position: relative; z-index: 1; min-height: 100%;
  display: grid; grid-template-columns: repeat(12, 1fr); gap: 16px;
  padding: 22px 26px 30px;
}
.topbar {
  grid-column: span 12; display: flex; justify-content: space-between; align-items: center;
}
.brand { display: flex; align-items: center; gap: 14px; }
.logo {
  width: 48px; height: 48px; border-radius: 14px; display: grid; place-items: center; font-size: var(--font-24);
  background: linear-gradient(135deg, #22d3ee, #6d5cff); box-shadow: 0 0 26px rgba(34,211,238,.6);
}
.brand h1 { margin: 0; font-size: var(--font-22); letter-spacing: 1px; font-weight: 700;
  background: linear-gradient(90deg, #d6f6ff, #8fb6ff); -webkit-background-clip: text; background-clip: text; color: transparent; }
.brand p { margin: 3px 0 0; font-size: var(--font-xs); color: #6d8fc0; letter-spacing: 2px; }
.status { display: flex; align-items: center; gap: 18px; font-size: var(--font-md); color: #9bb6dd; }
.live { display: inline-flex; align-items: center; gap: 7px; color: #4ade80; }
.dot { width: 8px; height: 8px; border-radius: 50%; background: #4ade80; box-shadow: 0 0 10px #4ade80; animation: pulse 1.6s infinite; }
.clock { font-variant-numeric: tabular-nums; font-size: var(--font-15); color: #cfe2ff; }
.tag { padding: 4px 10px; border-radius: 999px; font-size: var(--font-xs); color: #22d3ee; border: 1px solid rgba(34,211,238,.4); background: rgba(34,211,238,.08); }

.card {
  position: relative; border-radius: 16px; padding: 16px 18px;
  background: linear-gradient(160deg, rgba(20,30,56,.72), rgba(10,16,34,.66));
  border: 1px solid rgba(90,130,200,.22);
  box-shadow: 0 10px 30px rgba(0,0,0,.4), inset 0 1px 0 rgba(255,255,255,.05);
  backdrop-filter: blur(8px);
}
.card::before {
  content: ''; position: absolute; inset: 0; border-radius: 16px; padding: 1px; pointer-events: none;
  background: linear-gradient(120deg, rgba(34,211,238,.7), rgba(232,121,249,.5), transparent 60%);
  -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
  -webkit-mask-composite: xor; mask-composite: exclude; opacity: .55;
}

.kpi { grid-column: span 2; display: flex; flex-direction: column; gap: 8px; min-height: 116px; }
.kpi-top { display: flex; justify-content: space-between; align-items: center; }
.kpi-label { font-size: var(--font-sm); color: #8fa8cf; }
.kpi-delta { font-size: var(--font-xs); padding: 2px 6px; border-radius: 6px; }
.kpi-delta.up { color: #4ade80; background: rgba(74,222,128,.12); }
.kpi-delta.down { color: #fb7185; background: rgba(251,113,133,.12); }
.kpi-value { font-size: var(--font-27); font-weight: 700; font-variant-numeric: tabular-nums; color: #eaf4ff; text-shadow: 0 0 18px rgba(34,211,238,.45); }
.kpi-unit { font-size: var(--font-sm); color: #7e9bc6; margin-left: 5px; font-weight: 500; }
.spark { width: 100%; height: 28px; margin-top: auto; }
.spark polyline { fill: none; stroke: #22d3ee; stroke-width: 1.8; filter: drop-shadow(0 0 4px rgba(34,211,238,.8)); }

.chart-main { grid-column: span 8; grid-row: span 2; display: flex; flex-direction: column; }
.ne-panel { grid-column: span 4; display: flex; flex-direction: column; }
.region { grid-column: span 4; display: flex; flex-direction: column; }

.card-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; }
.card-head h2 { margin: 0; font-size: var(--font-15); font-weight: 600; color: #cfe2ff; }
.legend { display: flex; gap: 16px; font-size: var(--font-sm); color: #9bb6dd; }
.legend .sw { display: inline-block; width: 14px; height: 3px; border-radius: 2px; margin-right: 6px; vertical-align: middle; }
.sw.c1 { background: #22d3ee; box-shadow: 0 0 8px #22d3ee; }
.sw.c2 { background: #e879f9; box-shadow: 0 0 8px #e879f9; }
.chart-box { flex: 1; min-height: 300px; }
.chart-box.small { min-height: 188px; }

.snap { width: 100%; border-collapse: collapse; font-size: var(--font-md); }
.snap th { text-align: left; color: #7e9bc6; font-weight: 500; padding: 8px 6px; border-bottom: 1px solid rgba(90,130,200,.2); }
.snap td { padding: 9px 6px; border-bottom: 1px solid rgba(90,130,200,.08); color: #d6e4fb; }
.snap td.num { font-variant-numeric: tabular-nums; }
.snap .rname { color: #fff; font-weight: 600; }
.pill { font-size: var(--font-xs); padding: 3px 9px; border-radius: 999px; }
.pill.tight { color: #fb7185; background: rgba(251,113,133,.14); }
.pill.loose { color: #4ade80; background: rgba(74,222,128,.14); }
.pill.mid { color: #fbbf24; background: rgba(251,191,36,.14); }

@keyframes pulse { 0%,100% { transform: scale(1); opacity: 1; } 50% { transform: scale(1.5); opacity: .5; } }
.fade { opacity: 0; transform: translateY(14px); animation: fadeUp .7s ease forwards; animation-delay: var(--d, 0ms); }
@keyframes fadeUp { to { opacity: 1; transform: none; } }

@media (max-width: 768px) {
  .cockpit { grid-template-columns: 1fr; padding: 14px 16px; }
  .chart-main, .ne-panel, .region { grid-column: 1 / -1; grid-row: auto; }
}
</style>
