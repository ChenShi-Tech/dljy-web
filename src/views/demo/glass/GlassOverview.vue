<template>
  <div class="glass-root">
    <div class="aurora a1" />
    <div class="aurora a2" />
    <div class="aurora a3" />
    <div class="aurora a4" />
    <div class="noise" />

    <div class="cockpit">
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
          <span class="tag">玻璃拟态 · AURORA</span>
        </div>
      </header>

      <section
        v-for="(k, i) in kpis"
        :key="k.label"
        class="card kpi fade"
        :style="{ '--d': 80 + i * 70 + 'ms' }"
      >
        <div class="kpi-top">
          <span class="kpi-label">{{ k.label }}</span>
          <span class="kpi-delta" :class="k.delta >= 0 ? 'up' : 'down'">
            {{ k.delta >= 0 ? '↑' : '↓' }} {{ Math.abs(k.delta) }}%
          </span>
        </div>
        <div class="kpi-value">
          {{ kpiVals[i] }}<span class="kpi-unit">{{ k.unit }}</span>
        </div>
        <svg class="spark" viewBox="0 0 100 28" preserveAspectRatio="none">
          <defs>
            <linearGradient :id="'g' + i" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="#c4b5fd" />
              <stop offset="100%" stop-color="#5eead4" />
            </linearGradient>
          </defs>
          <polyline :points="sparkPts(k.spark)" :stroke="'url(#g' + i + ')'" />
        </svg>
      </section>

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

      <section class="card ne-panel fade" style="--d: 640ms">
        <div class="card-head"><h2>新能源出力占比</h2></div>
        <div ref="neEl" class="chart-box small" />
      </section>

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
const AX = 'rgba(255,255,255,.66)'
const SPLIT = 'rgba(255,255,255,.12)'

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
    tooltip: { trigger: 'axis', backgroundColor: 'rgba(40,30,70,.82)', borderColor: 'rgba(255,255,255,.25)', textStyle: { color: '#fff' } },
    xAxis: { type: 'category', data: timeLabels, boundaryGap: false, axisLine: { lineStyle: { color: 'rgba(255,255,255,.3)' } }, axisLabel: { color: AX, interval: 11, fontSize: 11 }, splitLine: { show: false } },
    yAxis: { type: 'value', name: '元/MWh', nameTextStyle: { color: AX }, axisLabel: { color: AX }, splitLine: { lineStyle: { color: SPLIT } } },
    series: [
      { name: '日前出清价', type: 'line', data: dayAhead, smooth: true, symbol: 'none', lineStyle: { color: '#c4b5fd', width: 2.6 }, areaStyle: { color: grad('rgba(167,139,250,.5)', 'rgba(167,139,250,0)') } },
      { name: '实时出清价', type: 'line', data: realtime, smooth: true, symbol: 'none', lineStyle: { color: '#5eead4', width: 2.6 }, areaStyle: { color: grad('rgba(94,234,212,.42)', 'rgba(94,234,212,0)') } },
    ],
  })
}

function renderNe() {
  if (!neEl.value) return
  const c = echarts.init(neEl.value)
  charts.push(c)
  c.setOption({
    grid: { left: 38, right: 14, top: 14, bottom: 26 },
    tooltip: { trigger: 'axis', backgroundColor: 'rgba(40,30,70,.82)', borderColor: 'rgba(255,255,255,.25)', textStyle: { color: '#fff' } },
    xAxis: { type: 'category', data: timeLabels, boundaryGap: false, axisLine: { lineStyle: { color: 'rgba(255,255,255,.3)' } }, axisLabel: { color: AX, interval: 23, fontSize: 10 } },
    yAxis: { type: 'value', max: 80, axisLabel: { color: AX, formatter: '{value}%' }, splitLine: { lineStyle: { color: SPLIT } } },
    series: [{ type: 'line', data: newEnergyShare, smooth: true, symbol: 'none', lineStyle: { color: '#fda4af', width: 2.4 }, areaStyle: { color: grad('rgba(253,164,175,.5)', 'rgba(253,164,175,0)') } }],
  })
}

const onResize = () => charts.forEach(c => c.resize())
onMounted(() => {
  renderMain(); renderNe()
  window.addEventListener('resize', onResize)
  timer = window.setInterval(() => { clock.value = new Date().toLocaleTimeString('zh-CN', { hour12: false }) }, 1000)
})
onBeforeUnmount(() => { window.removeEventListener('resize', onResize); charts.forEach(c => c.dispose()); window.clearInterval(timer) })
</script>

<style scoped>
.glass-root {
  position: fixed; inset: 0; overflow: auto;
  background: linear-gradient(135deg, #1e1b4b 0%, #312e81 38%, #1e3a5f 72%, #155e75 100%);
  color: #fff; font-family: 'Inter', -apple-system, 'PingFang SC', sans-serif;
}
.aurora { position: fixed; border-radius: 50%; filter: blur(80px); opacity: .7; pointer-events: none; z-index: 0; }
.a1 { width: 520px; height: 520px; background: #a855f7; top: -160px; left: -60px; animation: drift1 16s ease-in-out infinite; }
.a2 { width: 480px; height: 480px; background: #22d3ee; right: -120px; top: 40px; opacity: .6; animation: drift2 19s ease-in-out infinite; }
.a3 { width: 460px; height: 460px; background: #34d399; bottom: -180px; left: 28%; opacity: .55; animation: drift1 22s ease-in-out infinite reverse; }
.a4 { width: 380px; height: 380px; background: #f472b6; bottom: -120px; right: 12%; opacity: .5; animation: drift2 17s ease-in-out infinite reverse; }
.noise { position: fixed; inset: 0; z-index: 0; pointer-events: none; opacity: .04;
  background-image: radial-gradient(rgba(255,255,255,.8) 1px, transparent 1px); background-size: 4px 4px; }

.cockpit { position: relative; z-index: 1; min-height: 100%; display: grid; grid-template-columns: repeat(12, 1fr); gap: 16px; padding: 22px 26px 30px; }
.topbar { grid-column: span 12; display: flex; justify-content: space-between; align-items: center; }
.brand { display: flex; align-items: center; gap: 14px; }
.logo { width: 48px; height: 48px; border-radius: 15px; display: grid; place-items: center; font-size: var(--font-24);
  background: linear-gradient(135deg, rgba(255,255,255,.4), rgba(255,255,255,.08)); border: 1px solid rgba(255,255,255,.4); backdrop-filter: blur(10px); box-shadow: 0 8px 24px rgba(0,0,0,.2); }
.brand h1 { margin: 0; font-size: var(--font-22); letter-spacing: 1px; font-weight: 700; color: #fff; text-shadow: 0 2px 14px rgba(0,0,0,.3); }
.brand p { margin: 3px 0 0; font-size: var(--font-xs); color: rgba(255,255,255,.7); letter-spacing: 2px; }
.status { display: flex; align-items: center; gap: 16px; font-size: var(--font-md); color: rgba(255,255,255,.82); }
.live { display: inline-flex; align-items: center; gap: 7px; }
.dot { width: 8px; height: 8px; border-radius: 50%; background: #6ee7b7; box-shadow: 0 0 10px #6ee7b7; animation: pulse 1.6s infinite; }
.clock { font-variant-numeric: tabular-nums; font-size: var(--font-15); }
.tag { padding: 5px 12px; border-radius: 999px; font-size: var(--font-xs); color: #fff; border: 1px solid rgba(255,255,255,.35); background: rgba(255,255,255,.14); backdrop-filter: blur(8px); }

.card { position: relative; border-radius: 20px; padding: 16px 18px;
  background: rgba(255,255,255,.10); border: 1px solid rgba(255,255,255,.22);
  box-shadow: 0 12px 40px rgba(20,10,50,.28), inset 0 1px 0 rgba(255,255,255,.35);
  backdrop-filter: blur(22px) saturate(140%); -webkit-backdrop-filter: blur(22px) saturate(140%); }

.kpi { grid-column: span 2; display: flex; flex-direction: column; gap: 8px; min-height: 116px; }
.kpi-top { display: flex; justify-content: space-between; align-items: center; }
.kpi-label { font-size: var(--font-sm); color: rgba(255,255,255,.72); }
.kpi-delta { font-size: var(--font-xs); padding: 2px 7px; border-radius: 7px; }
.kpi-delta.up { color: #6ee7b7; background: rgba(110,231,183,.16); }
.kpi-delta.down { color: #fda4af; background: rgba(253,164,175,.18); }
.kpi-value { font-size: var(--font-27); font-weight: 700; font-variant-numeric: tabular-nums; color: #fff; text-shadow: 0 2px 12px rgba(0,0,0,.25); }
.kpi-unit { font-size: var(--font-sm); color: rgba(255,255,255,.65); margin-left: 5px; font-weight: 500; }
.spark { width: 100%; height: 28px; margin-top: auto; }
.spark polyline { fill: none; stroke-width: 2; }

.chart-main { grid-column: span 8; grid-row: span 2; display: flex; flex-direction: column; }
.ne-panel { grid-column: span 4; display: flex; flex-direction: column; }
.region { grid-column: span 4; display: flex; flex-direction: column; }

.card-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; }
.card-head h2 { margin: 0; font-size: var(--font-15); font-weight: 600; color: #fff; }
.legend { display: flex; gap: 16px; font-size: var(--font-sm); color: rgba(255,255,255,.8); }
.legend .sw { display: inline-block; width: 14px; height: 3px; border-radius: 2px; margin-right: 6px; vertical-align: middle; }
.sw.c1 { background: #c4b5fd; }
.sw.c2 { background: #5eead4; }
.chart-box { flex: 1; min-height: 300px; }
.chart-box.small { min-height: 188px; }

.snap { width: 100%; border-collapse: collapse; font-size: var(--font-md); }
.snap th { text-align: left; color: rgba(255,255,255,.66); font-weight: 500; padding: 8px 6px; border-bottom: 1px solid rgba(255,255,255,.2); }
.snap td { padding: 9px 6px; border-bottom: 1px solid rgba(255,255,255,.1); color: rgba(255,255,255,.92); }
.snap td.num { font-variant-numeric: tabular-nums; }
.snap .rname { color: #fff; font-weight: 600; }
.pill { font-size: var(--font-xs); padding: 3px 10px; border-radius: 999px; }
.pill.tight { color: #fecdd3; background: rgba(244,63,94,.28); }
.pill.loose { color: #bbf7d0; background: rgba(34,197,94,.28); }
.pill.mid { color: #fef08a; background: rgba(234,179,8,.28); }

@keyframes pulse { 0%,100% { transform: scale(1); opacity: 1; } 50% { transform: scale(1.5); opacity: .5; } }
@keyframes drift1 { 0%,100% { transform: translate(0,0); } 50% { transform: translate(60px, 40px); } }
@keyframes drift2 { 0%,100% { transform: translate(0,0); } 50% { transform: translate(-50px, 50px); } }
.fade { opacity: 0; transform: translateY(14px); animation: fadeUp .7s ease forwards; animation-delay: var(--d, 0ms); }
@keyframes fadeUp { to { opacity: 1; transform: none; } }

@media (max-width: 768px) {
  .cockpit { grid-template-columns: 1fr; padding: 14px 14px 24px; }
  .topbar, .kpi, .chart-main, .ne-panel, .region { grid-column: 1 / -1; grid-row: auto; }
}
</style>
