<template>
  <div class="bz-root">
    <div class="grain" />
    <div class="brushed" />

    <div class="page">
      <header class="topbar fade" style="--d: 0ms">
        <div class="brand">
          <span class="logo" aria-hidden="true">
            <svg viewBox="0 0 44 44"><circle cx="22" cy="22" r="19" /><circle cx="22" cy="22" r="13" class="inner" /><path d="M22 22 L22 6" /><circle cx="22" cy="22" r="2.4" class="hub" /></svg>
          </span>
          <div>
            <div class="eyebrow">BRONZE · 多智能体决策中枢</div>
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
          <span class="no">Nº{{ String(i + 1).padStart(2, '0') }}</span>
          <div class="kpi-label">{{ k.label }}</div>
          <div class="kpi-value">{{ kpiVals[i] }}<span class="kpi-unit">{{ k.unit }}</span></div>
          <div class="kpi-foot">
            <span class="delta" :class="k.delta >= 0 ? 'up' : 'down'">{{ k.delta >= 0 ? '▲' : '▼' }} {{ Math.abs(k.delta) }}%</span>
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
const BRASS = '#C2A05A', PATINA = '#6FA08D', AX = '#9A8A66'
const SPLIT = 'rgba(201,168,106,.1)'

function renderMain() {
  if (!mainEl.value) return
  const c = echarts.init(mainEl.value); charts.push(c)
  c.setOption({
    grid: { left: 46, right: 16, top: 18, bottom: 28 },
    tooltip: { trigger: 'axis', backgroundColor: '#23201B', borderColor: 'rgba(201,168,106,.35)', borderWidth: 1, textStyle: { color: '#E9DEC6' } },
    xAxis: { type: 'category', data: timeLabels, boundaryGap: false, axisLine: { lineStyle: { color: 'rgba(201,168,106,.3)' } }, axisTick: { show: false }, axisLabel: { color: AX, interval: 11, fontSize: 11 }, splitLine: { show: false } },
    yAxis: { type: 'value', axisLabel: { color: AX, fontSize: 11 }, splitLine: { lineStyle: { color: SPLIT } } },
    series: [
      { name: '日前', type: 'line', data: dayAhead, smooth: true, symbol: 'none', lineStyle: { color: BRASS, width: 2.4, shadowColor: 'rgba(201,168,106,.5)', shadowBlur: 6 },
        areaStyle: { color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [{ offset: 0, color: 'rgba(201,168,106,.22)' }, { offset: 1, color: 'rgba(201,168,106,0)' }]) } },
      { name: '实时', type: 'line', data: realtime, smooth: true, symbol: 'none', lineStyle: { color: PATINA, width: 1.5, type: 'dashed' } },
    ],
  })
}
function renderNe() {
  if (!neEl.value) return
  const c = echarts.init(neEl.value); charts.push(c)
  c.setOption({
    grid: { left: 36, right: 12, top: 12, bottom: 24 },
    tooltip: { trigger: 'axis', backgroundColor: '#23201B', borderColor: 'rgba(201,168,106,.35)', borderWidth: 1, textStyle: { color: '#E9DEC6' } },
    xAxis: { type: 'category', data: timeLabels, boundaryGap: false, axisLine: { lineStyle: { color: 'rgba(201,168,106,.3)' } }, axisTick: { show: false }, axisLabel: { color: AX, interval: 23, fontSize: 10 } },
    yAxis: { type: 'value', max: 80, axisLabel: { color: AX, formatter: '{value}%', fontSize: 10 }, splitLine: { lineStyle: { color: SPLIT } } },
    series: [{ type: 'line', data: newEnergyShare, smooth: true, symbol: 'none', lineStyle: { color: PATINA, width: 2 },
      areaStyle: { color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [{ offset: 0, color: 'rgba(111,160,141,.2)' }, { offset: 1, color: 'rgba(111,160,141,0)' }]) } }],
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
.bz-root {
  --metal: #23201B; --metal-2: #2C2820; --panel: #2E2A22;
  --brass: #C2A05A; --brass-2: #D9BE84; --brass-dim: #7E673A;
  --cream: #E9DEC6; --cream-2: #B3A788; --patina: #6FA08D; --rust: #B5603E;
  --line: rgba(201,168,106,.2); --line-2: rgba(201,168,106,.1);
  --mono: ui-monospace, 'SF Mono', 'JetBrains Mono', Menlo, Consolas, monospace;
  position: fixed; inset: 0; overflow: auto; background: var(--metal); color: var(--cream);
  font-family: -apple-system, 'PingFang SC', sans-serif; -webkit-font-smoothing: antialiased;
}
.grain { position: fixed; inset: 0; z-index: 0; pointer-events: none; opacity: .5; mix-blend-mode: overlay;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.05'/%3E%3C/svg%3E"); }
.brushed { position: fixed; inset: 0; z-index: 0; pointer-events: none; opacity: .5;
  background: repeating-linear-gradient(90deg, rgba(201,168,106,.022) 0 1px, transparent 1px 3px), radial-gradient(120% 70% at 50% 0%, rgba(201,168,106,.06), transparent 55%); }
.page { position: relative; z-index: 1; max-width: 1320px; margin: 0 auto; padding: 34px 36px 46px; }

.topbar { display: flex; justify-content: space-between; align-items: flex-end; margin-bottom: 26px; }
.brand { display: flex; align-items: center; gap: 15px; }
.logo svg { width: 46px; height: 46px; }
.logo circle { fill: none; stroke: var(--brass); stroke-width: 1.4; }
.logo .inner { stroke: var(--brass-dim); stroke-dasharray: 1 3; }
.logo path { stroke: var(--rust); stroke-width: 1.6; }
.logo .hub { fill: var(--brass); stroke: none; }
.eyebrow { font-family: var(--mono); font-size: 11px; letter-spacing: 2px; color: var(--brass); margin-bottom: 6px; }
.brand h1 { margin: 0; font-size: 26px; font-weight: 600; letter-spacing: .5px; color: var(--cream); }
.controls { display: flex; align-items: center; gap: 16px; }
.segment { display: inline-flex; background: var(--metal-2); border: 1px solid var(--line); border-radius: 7px; padding: 3px; }
.seg { border: none; background: transparent; font-size: 13px; color: var(--cream-2); padding: 6px 14px; border-radius: 5px; cursor: pointer; font-family: inherit; }
.seg.active { background: rgba(201,168,106,.16); color: var(--brass-2); }
.live { display: inline-flex; align-items: center; gap: 7px; font-family: var(--mono); font-size: 13px; color: var(--cream-2); }
.live .dot { width: 7px; height: 7px; border-radius: 50%; background: var(--patina); box-shadow: 0 0 6px var(--patina); animation: pulse 2.2s infinite; }

.card { position: relative; background: linear-gradient(180deg, var(--panel), var(--metal-2)); border: 1px solid var(--line); border-radius: 9px; padding: 19px 21px;
  box-shadow: inset 0 1px 0 rgba(217,190,132,.1), 0 14px 34px -22px #000; }

.kpis { display: grid; grid-template-columns: repeat(6, 1fr); gap: 15px; margin-bottom: 18px; }
.kpi { padding: 16px 18px 14px; overflow: hidden; }
.no { position: absolute; top: 12px; right: 13px; font-family: var(--mono); font-size: 10.5px; color: var(--brass); opacity: .65; letter-spacing: .5px; }
.kpi-label { font-size: 12.5px; color: var(--cream-2); margin-bottom: 13px; }
.kpi-value { font-family: var(--mono); font-size: 27px; font-weight: 600; color: var(--cream); line-height: 1; letter-spacing: -.5px; }
.kpi-unit { font-size: 10.5px; color: var(--cream-2); margin-left: 5px; font-weight: 400; }
.kpi-foot { display: flex; justify-content: space-between; align-items: flex-end; margin-top: 14px; }
.delta { font-family: var(--mono); font-size: 12px; font-weight: 600; }
.delta.up { color: var(--patina); }
.delta.down { color: var(--rust); }
.spark { width: 80px; height: 22px; }
.spark polyline { fill: none; stroke: var(--brass); stroke-width: 1.6; }

.grid { display: grid; grid-template-columns: 1fr 380px; gap: 18px; align-items: start; }
.side { display: flex; flex-direction: column; gap: 18px; }
.card-head { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 15px; }
.card-head h2 { margin: 0; font-size: 16px; font-weight: 600; color: var(--cream); letter-spacing: .5px; }
.sub { margin: 5px 0 0; font-size: 12px; color: var(--cream-2); opacity: .8; }
.legend { display: flex; gap: 16px; font-size: 12px; color: var(--cream-2); }
.legend .sw { display: inline-block; width: 13px; height: 3px; border-radius: 2px; margin-right: 6px; vertical-align: middle; }
.sw.c1 { background: var(--brass); } .sw.c2 { background: var(--patina); }
.chart-box { height: 322px; }
.chart-box.small { height: 168px; }

.snap { width: 100%; border-collapse: collapse; font-size: 13px; }
.snap th { color: var(--cream-2); font-weight: 500; padding: 8px 4px; border-bottom: 1px solid var(--line); text-align: left; font-size: 12px; }
.snap th.r, .snap td.r { text-align: right; }
.snap td { padding: 11px 4px; border-bottom: 1px solid var(--line-2); color: var(--cream-2); }
.snap tbody tr:last-child td { border-bottom: none; }
.snap td.num { font-family: var(--mono); color: var(--cream); }
.snap .rname { color: var(--cream); font-weight: 600; }
.pill { font-size: 11px; padding: 3px 9px; border-radius: 4px; font-family: var(--mono); }
.pill.tight { color: #E0A07E; background: rgba(181,96,62,.18); }
.pill.loose { color: var(--patina); background: rgba(111,160,141,.16); }
.pill.mid { color: var(--brass-2); background: rgba(201,168,106,.16); }

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
