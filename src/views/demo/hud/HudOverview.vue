<template>
  <div class="hud-root">
    <div class="scanlines" />
    <div class="sweep" />
    <div class="vignette" />

    <div class="cockpit">
      <header class="topbar fade" style="--d: 0ms">
        <div class="prompt">
          <span class="user">root@dljy-cockpit</span><span class="path">:~$</span>
          <span class="cmd"> ./market --live --province=SX</span><span class="cur">█</span>
        </div>
        <div class="statusline">
          <span class="on">● SYS_ONLINE</span>
          <span>LAT 12ms</span>
          <span>NODES 24/24</span>
          <span class="ts">{{ clock }}</span>
          <span class="modetag">[ HUD_TERMINAL ]</span>
        </div>
      </header>

      <h2 class="sect title-line fade" style="--d: 60ms">▣ 电力交易决策驾驶舱 <span class="dim">// SHANXI_SPOT_MARKET</span></h2>

      <section
        v-for="(k, i) in kpis"
        :key="k.label"
        class="hud-card kpi fade"
        :style="{ '--d': 120 + i * 60 + 'ms' }"
      >
        <div class="kpi-label">// {{ k.label }}</div>
        <div class="kpi-value">{{ kpiVals[i] }}<span class="kpi-unit">{{ k.unit }}</span></div>
        <div class="kpi-bar">{{ bar(k) }}</div>
        <div class="kpi-foot">
          <span :class="k.delta >= 0 ? 'up' : 'down'">{{ k.delta >= 0 ? '▲' : '▼' }} {{ Math.abs(k.delta) }}%</span>
          <span class="dim">24H</span>
        </div>
      </section>

      <section class="hud-card chart-main fade" style="--d: 520ms">
        <div class="card-head">
          <h3>▣ 现货价格曲线 <span class="dim">// PRICE_CURVE</span></h3>
          <div class="legend"><span><i class="sw c1" />DAY_AHEAD</span><span><i class="sw c2" />REALTIME</span></div>
        </div>
        <div ref="mainEl" class="chart-box" />
      </section>

      <section class="hud-card ne-panel fade" style="--d: 600ms">
        <div class="card-head"><h3>▣ 新能源占比 <span class="dim">// RENEWABLE</span></h3></div>
        <div ref="neEl" class="chart-box small" />
      </section>

      <section class="hud-card region fade" style="--d: 680ms">
        <div class="card-head"><h3>▣ 分区出清快照 <span class="dim">// NODE_SNAPSHOT</span></h3></div>
        <table class="snap">
          <thead>
            <tr><th>NODE</th><th>价格</th><th>负荷</th><th>NE%</th><th>STATE</th></tr>
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
import { kpis, regionRows, timeLabels, dayAhead, realtime, newEnergyShare, type Kpi } from '../mock'
import { useCountUp } from '@/composables/useCountUp'

const clock = ref(new Date().toLocaleTimeString('en-GB', { hour12: false }))
let timer = 0
const kpiVals = kpis.map((k, i) => useCountUp(k.value, { decimals: k.decimals ?? 0, delay: 160 + i * 70, duration: 1400 }))

function bar(k: Kpi) {
  const ratio = Math.max(0.12, Math.min(0.95, 0.45 + k.delta / 32))
  const filled = Math.round(ratio * 14)
  return '█'.repeat(filled) + '░'.repeat(14 - filled)
}
const statusClass = (s: string) => (s === '偏紧' ? 'tight' : s === '宽松' ? 'loose' : 'mid')

const mainEl = ref<HTMLElement>()
const neEl = ref<HTMLElement>()
const charts: echarts.ECharts[] = []
const GREEN = '#00ff9c'
const AMBER = '#ffb000'
const AX = 'rgba(0,255,156,.55)'
const SPLIT = 'rgba(0,255,156,.1)'

function renderMain() {
  if (!mainEl.value) return
  const c = echarts.init(mainEl.value)
  charts.push(c)
  c.setOption({
    grid: { left: 48, right: 18, top: 18, bottom: 30 },
    tooltip: { trigger: 'axis', backgroundColor: 'rgba(0,12,8,.95)', borderColor: GREEN, textStyle: { color: GREEN, fontFamily: 'monospace' } },
    xAxis: { type: 'category', data: timeLabels, boundaryGap: false, axisLine: { lineStyle: { color: 'rgba(0,255,156,.4)' } }, axisLabel: { color: AX, interval: 11, fontSize: 10, fontFamily: 'monospace' }, splitLine: { show: false } },
    yAxis: { type: 'value', axisLabel: { color: AX, fontFamily: 'monospace' }, splitLine: { lineStyle: { color: SPLIT, type: 'dashed' } } },
    series: [
      { name: 'DAY_AHEAD', type: 'line', data: dayAhead, smooth: false, symbol: 'none', lineStyle: { color: GREEN, width: 1.8, shadowColor: GREEN, shadowBlur: 8 },
        areaStyle: { color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [{ offset: 0, color: 'rgba(0,255,156,.22)' }, { offset: 1, color: 'rgba(0,255,156,0)' }]) } },
      { name: 'REALTIME', type: 'line', data: realtime, smooth: false, symbol: 'none', lineStyle: { color: AMBER, width: 1.6, type: 'dashed' } },
    ],
  })
}

function renderNe() {
  if (!neEl.value) return
  const c = echarts.init(neEl.value)
  charts.push(c)
  c.setOption({
    grid: { left: 36, right: 14, top: 14, bottom: 26 },
    tooltip: { trigger: 'axis', backgroundColor: 'rgba(0,12,8,.95)', borderColor: GREEN, textStyle: { color: GREEN, fontFamily: 'monospace' } },
    xAxis: { type: 'category', data: timeLabels, boundaryGap: true, axisLine: { lineStyle: { color: 'rgba(0,255,156,.4)' } }, axisLabel: { color: AX, interval: 23, fontSize: 9, fontFamily: 'monospace' } },
    yAxis: { type: 'value', max: 80, axisLabel: { color: AX, formatter: '{value}%', fontFamily: 'monospace' }, splitLine: { lineStyle: { color: SPLIT, type: 'dashed' } } },
    series: [{ type: 'bar', data: newEnergyShare, barWidth: '55%', itemStyle: { color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [{ offset: 0, color: 'rgba(0,255,156,.9)' }, { offset: 1, color: 'rgba(0,255,156,.15)' }]) } }],
  })
}

const onResize = () => charts.forEach(c => c.resize())
onMounted(() => {
  renderMain(); renderNe()
  window.addEventListener('resize', onResize)
  timer = window.setInterval(() => { clock.value = new Date().toLocaleTimeString('en-GB', { hour12: false }) }, 1000)
})
onBeforeUnmount(() => { window.removeEventListener('resize', onResize); charts.forEach(c => c.dispose()); window.clearInterval(timer) })
</script>

<style scoped>
.hud-root { position: fixed; inset: 0; overflow: auto; background: #02060300; background-color: #020603;
  color: #00ff9c; font-family: 'JetBrains Mono', 'SF Mono', Menlo, Consolas, monospace; }
.scanlines { position: fixed; inset: 0; z-index: 5; pointer-events: none;
  background: repeating-linear-gradient(0deg, rgba(0,0,0,0) 0px, rgba(0,0,0,0) 2px, rgba(0,40,25,.35) 3px); opacity: .5; }
.sweep { position: fixed; left: 0; right: 0; height: 120px; z-index: 4; pointer-events: none;
  background: linear-gradient(180deg, rgba(0,255,156,0), rgba(0,255,156,.08), rgba(0,255,156,0)); animation: sweep 6s linear infinite; }
.vignette { position: fixed; inset: 0; z-index: 1; pointer-events: none;
  background: radial-gradient(120% 90% at 50% 40%, rgba(0,0,0,0) 55%, rgba(0,0,0,.6) 100%),
    linear-gradient(rgba(0,255,156,.025) 1px, transparent 1px), linear-gradient(90deg, rgba(0,255,156,.025) 1px, transparent 1px);
  background-size: 100% 100%, 40px 40px, 40px 40px; }

.cockpit { position: relative; z-index: 2; min-height: 100%; display: grid; grid-template-columns: repeat(12, 1fr); gap: 14px; padding: 18px 22px 28px; }
.topbar { grid-column: span 12; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px;
  border: 1px solid rgba(0,255,156,.25); padding: 10px 14px; background: rgba(0,20,12,.4); }
.prompt { font-size: 14px; }
.prompt .user { color: #00ff9c; }
.prompt .path { color: #5af; }
.prompt .cmd { color: #cfffe9; }
.cur { color: #00ff9c; animation: blink 1s steps(2) infinite; }
.statusline { display: flex; gap: 16px; font-size: 12px; color: rgba(0,255,156,.6); align-items: center; }
.statusline .on { color: #00ff9c; }
.statusline .ts { color: #cfffe9; }
.modetag { color: #ffb000; }

.sect { grid-column: span 12; margin: 0; font-size: 15px; font-weight: 600; letter-spacing: 1px; color: #00ff9c; }
.title-line { text-shadow: 0 0 12px rgba(0,255,156,.5); }
.dim { color: rgba(0,255,156,.45); font-weight: 400; }

.hud-card { position: relative; padding: 14px 16px; background: rgba(0,22,13,.55);
  border: 1px solid rgba(0,255,156,.26); box-shadow: inset 0 0 24px rgba(0,255,156,.05); }
.hud-card::before, .hud-card::after { content: ''; position: absolute; width: 12px; height: 12px; pointer-events: none; }
.hud-card::before { top: -1px; left: -1px; border-top: 2px solid #00ff9c; border-left: 2px solid #00ff9c; }
.hud-card::after { bottom: -1px; right: -1px; border-bottom: 2px solid #00ff9c; border-right: 2px solid #00ff9c; }

.kpi { grid-column: span 2; display: flex; flex-direction: column; gap: 6px; min-height: 116px; }
.kpi-label { font-size: 11px; color: rgba(0,255,156,.6); }
.kpi-value { font-size: 25px; font-weight: 700; color: #00ff9c; text-shadow: 0 0 12px rgba(0,255,156,.55); }
.kpi-unit { font-size: 11px; color: rgba(0,255,156,.5); margin-left: 5px; font-weight: 400; }
.kpi-bar { font-size: 11px; letter-spacing: 1px; color: #00ff9c; opacity: .85; margin-top: auto; }
.kpi-foot { display: flex; justify-content: space-between; font-size: 11px; }
.kpi-foot .up { color: #00ff9c; }
.kpi-foot .down { color: #ff5d5d; }

.chart-main { grid-column: span 8; grid-row: span 2; display: flex; flex-direction: column; }
.ne-panel { grid-column: span 4; display: flex; flex-direction: column; }
.region { grid-column: span 4; display: flex; flex-direction: column; }
.card-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
.card-head h3 { margin: 0; font-size: 13px; font-weight: 600; color: #00ff9c; letter-spacing: .5px; }
.legend { display: flex; gap: 14px; font-size: 11px; color: rgba(0,255,156,.6); }
.legend .sw { display: inline-block; width: 14px; height: 2px; margin-right: 5px; vertical-align: middle; }
.sw.c1 { background: #00ff9c; }
.sw.c2 { background: #ffb000; }
.chart-box { flex: 1; min-height: 300px; }
.chart-box.small { min-height: 188px; }

.snap { width: 100%; border-collapse: collapse; font-size: 12px; }
.snap th { text-align: left; color: rgba(0,255,156,.55); font-weight: 500; padding: 7px 6px; border-bottom: 1px solid rgba(0,255,156,.25); }
.snap td { padding: 8px 6px; border-bottom: 1px solid rgba(0,255,156,.1); color: #bfffe6; }
.snap .rname { color: #00ff9c; font-weight: 600; }
.pill { font-size: 10px; padding: 2px 8px; border: 1px solid; }
.pill.tight { color: #ff5d5d; border-color: rgba(255,93,93,.5); }
.pill.loose { color: #00ff9c; border-color: rgba(0,255,156,.5); }
.pill.mid { color: #ffb000; border-color: rgba(255,176,0,.5); }

@keyframes blink { 50% { opacity: 0; } }
@keyframes sweep { 0% { top: -120px; } 100% { top: 100%; } }
.fade { opacity: 0; transform: translateY(12px); animation: fadeUp .55s ease forwards; animation-delay: var(--d, 0ms); }
@keyframes fadeUp { to { opacity: 1; transform: none; } }

@media (max-width: 768px) {
  .cockpit { grid-template-columns: 1fr; padding: 12px 12px 22px; }
  .topbar, .sect, .kpi, .chart-main, .ne-panel, .region { grid-column: 1 / -1; grid-row: auto; }
}
</style>
