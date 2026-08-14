<template>
  <div class="bl-root">
    <div class="glow" />

    <div class="page">
      <header class="topbar fade" style="--d: 0ms">
        <div class="brand">
          <span class="logo" aria-hidden="true">
            <svg viewBox="0 0 40 40"><circle cx="20" cy="20" r="16" /><circle cx="20" cy="20" r="6" class="dot" /></svg>
          </span>
          <div>
            <div class="eyebrow">素白 · 多智能体决策中枢</div>
            <h1>电力交易决策驾驶舱</h1>
          </div>
        </div>
        <div class="controls">
          <div class="segment">
            <button class="seg active">今日</button>
            <button class="seg">本周</button>
            <button class="seg">本月</button>
          </div>
          <span class="live"><i class="dot" />{{ clock }}</span>
        </div>
      </header>

      <section class="kpis">
        <div v-for="(k, i) in kpis" :key="k.label" class="card kpi fade" :style="{ '--d': 90 + i * 60 + 'ms' }">
          <div class="kpi-label">{{ k.label }}</div>
          <div class="kpi-value">{{ kpiVals[i] }}<span class="kpi-unit">{{ k.unit }}</span></div>
          <div class="kpi-foot">
            <span class="delta" :class="k.delta >= 0 ? 'up' : 'down'">{{ k.delta >= 0 ? '↑' : '↓' }} {{ Math.abs(k.delta) }}%</span>
            <svg class="spark" viewBox="0 0 80 22" preserveAspectRatio="none"><polyline :points="sparkPts(k.spark)" /></svg>
          </div>
        </div>
      </section>

      <section class="grid">
        <div class="card main fade" style="--d: 540ms">
          <div class="card-head">
            <div>
              <h2>现货价格曲线</h2>
              <p class="sub">日前出清价 vs 实时出清价 · 全天 96 点</p>
            </div>
            <div class="legend">
              <span><i class="sw c1" />日前</span>
              <span><i class="sw c2" />实时</span>
            </div>
          </div>
          <div ref="mainEl" class="chart-box" />
        </div>

        <div class="side">
          <div class="card fade" style="--d: 620ms">
            <div class="card-head"><div><h2>新能源出力占比</h2><p class="sub">全天趋势</p></div></div>
            <div ref="neEl" class="chart-box small" />
          </div>
          <div class="card fade" style="--d: 700ms">
            <div class="card-head"><div><h2>分区出清快照</h2></div></div>
            <table class="snap">
              <thead><tr><th>区域</th><th class="r">出清价</th><th class="r">负荷</th><th class="r">新能源</th><th class="r">态势</th></tr></thead>
              <tbody>
                <tr v-for="r in regionRows" :key="r.region">
                  <td class="rname">{{ r.region }}</td>
                  <td class="r num">{{ r.price.toFixed(1) }}</td>
                  <td class="r num">{{ r.load }}</td>
                  <td class="r num">{{ r.ne.toFixed(1) }}%</td>
                  <td class="r"><span class="pill" :class="statusClass(r.status)">{{ r.status }}</span></td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
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
const kpiVals = kpis.map((k, i) => useCountUp(k.value, { decimals: k.decimals ?? 0, delay: 220 + i * 90, duration: 1700 }))

const sparkPts = (arr: number[]) => {
  const min = Math.min(...arr), max = Math.max(...arr), span = max - min || 1
  return arr.map((v, i) => `${(i / (arr.length - 1)) * 80},${22 - ((v - min) / span) * 18 - 2}`).join(' ')
}
const statusClass = (s: string) => (s === '偏紧' ? 'tight' : s === '宽松' ? 'loose' : 'mid')

const mainEl = ref<HTMLElement>()
const neEl = ref<HTMLElement>()
const charts: echarts.ECharts[] = []
const CELADON = '#7BA391', SAND = '#B7A98C', AX = '#9AA09A'
const SPLIT = 'rgba(123,163,145,.12)'

function renderMain() {
  if (!mainEl.value) return
  const c = echarts.init(mainEl.value); charts.push(c)
  c.setOption({
    grid: { left: 46, right: 16, top: 18, bottom: 28 },
    tooltip: { trigger: 'axis', backgroundColor: '#fff', borderColor: 'rgba(123,163,145,.3)', borderWidth: 1, textStyle: { color: '#3A3D3A' }, extraCssText: 'box-shadow:0 8px 26px rgba(92,132,117,.16);border-radius:8px;' },
    xAxis: { type: 'category', data: timeLabels, boundaryGap: false, axisLine: { lineStyle: { color: 'rgba(123,163,145,.25)' } }, axisTick: { show: false }, axisLabel: { color: AX, interval: 11, fontSize: 11 }, splitLine: { show: false } },
    yAxis: { type: 'value', axisLabel: { color: AX, fontSize: 11 }, splitLine: { lineStyle: { color: SPLIT } } },
    series: [
      { name: '日前', type: 'line', data: dayAhead, smooth: true, symbol: 'none', lineStyle: { color: CELADON, width: 2.4 },
        areaStyle: { color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [{ offset: 0, color: 'rgba(123,163,145,.18)' }, { offset: 1, color: 'rgba(123,163,145,0)' }]) } },
      { name: '实时', type: 'line', data: realtime, smooth: true, symbol: 'none', lineStyle: { color: SAND, width: 1.5, type: 'dashed' } },
    ],
  })
}
function renderNe() {
  if (!neEl.value) return
  const c = echarts.init(neEl.value); charts.push(c)
  c.setOption({
    grid: { left: 36, right: 12, top: 12, bottom: 24 },
    tooltip: { trigger: 'axis', backgroundColor: '#fff', borderColor: 'rgba(123,163,145,.3)', borderWidth: 1, textStyle: { color: '#3A3D3A' }, extraCssText: 'box-shadow:0 8px 26px rgba(92,132,117,.16);border-radius:8px;' },
    xAxis: { type: 'category', data: timeLabels, boundaryGap: false, axisLine: { lineStyle: { color: 'rgba(123,163,145,.25)' } }, axisTick: { show: false }, axisLabel: { color: AX, interval: 23, fontSize: 10 } },
    yAxis: { type: 'value', max: 80, axisLabel: { color: AX, formatter: '{value}%', fontSize: 10 }, splitLine: { lineStyle: { color: SPLIT } } },
    series: [{ type: 'line', data: newEnergyShare, smooth: true, symbol: 'none', lineStyle: { color: CELADON, width: 2 },
      areaStyle: { color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [{ offset: 0, color: 'rgba(123,163,145,.16)' }, { offset: 1, color: 'rgba(123,163,145,0)' }]) } }],
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
.bl-root {
  --bone: #F7F6F2; --bone-2: #FCFCFA; --glaze: #ECF1EE;
  --celadon: #7BA391; --celadon-2: #A9C5B8; --celadon-deep: #5C8475;
  --ink: #3A3D3A; --ink-2: #6E726B; --ink-3: #9AA09A; --sand: #B7A98C;
  --line: rgba(92,132,117,.16); --line-2: rgba(92,132,117,.08);
  position: fixed; inset: 0; overflow: auto; background: var(--bone); color: var(--ink);
  font-family: -apple-system, 'PingFang SC', 'Helvetica Neue', sans-serif; -webkit-font-smoothing: antialiased; letter-spacing: .2px;
}
.glow { position: fixed; inset: 0; z-index: 0; pointer-events: none;
  background: radial-gradient(60% 45% at 50% 0%, rgba(123,163,145,.07), transparent 60%), radial-gradient(45% 40% at 100% 100%, rgba(169,197,184,.1), transparent 70%); }
.page { position: relative; z-index: 1; max-width: 1320px; margin: 0 auto; padding: 38px 40px 50px; }

.topbar { display: flex; justify-content: space-between; align-items: flex-end; margin-bottom: 30px; }
.brand { display: flex; align-items: center; gap: 15px; }
.logo svg { width: 42px; height: 42px; }
.logo circle { fill: none; stroke: var(--celadon); stroke-width: 1.3; }
.logo .dot { fill: var(--celadon-2); stroke: none; }
.eyebrow { font-size: 11px; letter-spacing: 3px; color: var(--celadon-deep); margin-bottom: 7px; }
.brand h1 { margin: 0; font-size: 26px; font-weight: 500; letter-spacing: 2px; color: var(--ink); }
.controls { display: flex; align-items: center; gap: 16px; }
.segment { display: inline-flex; background: var(--bone-2); border: 1px solid var(--line); border-radius: 20px; padding: 3px; }
.seg { border: none; background: transparent; font-size: 13px; color: var(--ink-3); padding: 6px 15px; border-radius: 16px; cursor: pointer; font-family: inherit; }
.seg.active { background: var(--glaze); color: var(--celadon-deep); }
.live { display: inline-flex; align-items: center; gap: 7px; font-size: 13px; color: var(--ink-2); font-variant-numeric: tabular-nums; }
.live .dot { width: 7px; height: 7px; border-radius: 50%; background: var(--celadon); animation: pulse 2.4s infinite; }

.card { background: var(--bone-2); border: 1px solid var(--line); border-radius: 18px; padding: 22px 24px; box-shadow: 0 16px 44px -30px rgba(92,132,117,.5); }

.kpis { display: grid; grid-template-columns: repeat(6, 1fr); gap: 16px; margin-bottom: 20px; }
.kpi { padding: 20px 20px 17px; }
.kpi-label { font-size: 12.5px; color: var(--ink-3); margin-bottom: 15px; letter-spacing: .5px; }
.kpi-value { font-size: 28px; font-weight: 500; color: var(--ink); line-height: 1; letter-spacing: -.5px; font-variant-numeric: tabular-nums; }
.kpi-unit { font-size: 10.5px; color: var(--ink-3); margin-left: 5px; font-weight: 400; }
.kpi-foot { display: flex; justify-content: space-between; align-items: flex-end; margin-top: 16px; }
.delta { font-size: 12px; font-weight: 600; }
.delta.up { color: var(--celadon-deep); }
.delta.down { color: #C0885E; }
.spark { width: 80px; height: 22px; }
.spark polyline { fill: none; stroke: var(--celadon-2); stroke-width: 1.6; }

.grid { display: grid; grid-template-columns: 1fr 380px; gap: 20px; align-items: start; }
.side { display: flex; flex-direction: column; gap: 20px; }
.card-head { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 16px; }
.card-head h2 { margin: 0; font-size: 16px; font-weight: 500; color: var(--ink); letter-spacing: 1.5px; }
.sub { margin: 6px 0 0; font-size: 12px; color: var(--ink-3); }
.legend { display: flex; gap: 16px; font-size: 12px; color: var(--ink-2); }
.legend .sw { display: inline-block; width: 13px; height: 3px; border-radius: 2px; margin-right: 6px; vertical-align: middle; }
.sw.c1 { background: var(--celadon); } .sw.c2 { background: var(--sand); }
.chart-box { height: 322px; }
.chart-box.small { height: 168px; }

.snap { width: 100%; border-collapse: collapse; font-size: 13px; }
.snap th { color: var(--ink-3); font-weight: 500; padding: 9px 4px; border-bottom: 1px solid var(--line); text-align: left; font-size: 12px; }
.snap th.r, .snap td.r { text-align: right; }
.snap td { padding: 12px 4px; border-bottom: 1px solid var(--line-2); color: var(--ink-2); }
.snap tbody tr:last-child td { border-bottom: none; }
.snap td.num { font-variant-numeric: tabular-nums; color: var(--ink); }
.snap .rname { color: var(--ink); font-weight: 600; }
.pill { font-size: 11px; padding: 3px 10px; border-radius: 11px; }
.pill.tight { color: #C0885E; background: rgba(192,136,94,.14); }
.pill.loose { color: var(--celadon-deep); background: rgba(123,163,145,.14); }
.pill.mid { color: var(--ink-2); background: var(--glaze); }

@keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: .4; } }
.fade { opacity: 0; transform: translateY(11px); animation: fadeUp .62s cubic-bezier(.22,.61,.36,1) forwards; animation-delay: var(--d, 0ms); }
@keyframes fadeUp { to { opacity: 1; transform: none; } }

@media (max-width: 768px) {
  .kpis { grid-template-columns: repeat(3, 1fr); gap: 10px; }
  .grid { grid-template-columns: 1fr; }
}
@media (max-width: 480px) {
  .kpis { grid-template-columns: repeat(2, 1fr); }
}
</style>
