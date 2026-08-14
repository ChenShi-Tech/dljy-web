<template>
  <div class="tg-root">
    <div class="grain" />
    <div class="warp" />

    <div class="page">
      <!-- 抬头 -->
      <header class="topbar fade" style="--d: 0ms">
        <div class="brand">
          <span class="seal" aria-hidden="true">
            <svg viewBox="0 0 40 40"><rect x="2.5" y="2.5" width="35" height="35" rx="4" /><text x="20" y="27" text-anchor="middle">工</text></svg>
          </span>
          <div>
            <div class="eyebrow">天工 · 多智能体决策中枢</div>
            <h1 class="serif">电力交易决策驾驶舱</h1>
          </div>
        </div>
        <div class="controls">
          <div class="segment">
            <button class="seg active">今日</button>
            <button class="seg">本周</button>
            <button class="seg">本月</button>
          </div>
          <span class="live"><i class="dot" />实时 · {{ clock }}</span>
        </div>
      </header>

      <!-- KPI -->
      <section class="kpis">
        <div v-for="(k, i) in kpis" :key="k.label" class="card kpi fade" :style="{ '--d': 90 + i * 60 + 'ms' }">
          <span class="gan serif">{{ gan[i] }}</span>
          <div class="kpi-label">{{ k.label }}</div>
          <div class="kpi-value serif">{{ kpiVals[i] }}<span class="kpi-unit">{{ k.unit }}</span></div>
          <div class="kpi-foot">
            <span class="delta" :class="k.delta >= 0 ? 'up' : 'down'">{{ k.delta >= 0 ? '▲' : '▼' }} {{ Math.abs(k.delta) }}%</span>
            <svg class="spark" viewBox="0 0 80 22" preserveAspectRatio="none"><polyline :points="sparkPts(k.spark)" /></svg>
          </div>
        </div>
      </section>

      <!-- 主体 -->
      <section class="grid">
        <div class="card main fade" style="--d: 540ms">
          <div class="card-head">
            <div>
              <h2 class="serif">现货价格曲线</h2>
              <p class="sub">日前出清价 vs 实时出清价 · 全天 96 点(15 分钟粒度)</p>
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
            <div class="card-head"><div><h2 class="serif">新能源出力占比</h2><p class="sub">全天趋势</p></div></div>
            <div ref="neEl" class="chart-box small" />
          </div>

          <div class="card fade" style="--d: 700ms">
            <div class="card-head"><div><h2 class="serif">分区出清快照</h2></div></div>
            <table class="snap">
              <thead>
                <tr><th>区域</th><th class="r">出清价</th><th class="r">负荷</th><th class="r">新能源</th><th class="r">态势</th></tr>
              </thead>
              <tbody>
                <tr v-for="r in regionRows" :key="r.region">
                  <td class="rname serif">{{ r.region }}</td>
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

const gan = ['甲', '乙', '丙', '丁', '戊', '己']
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
const BRASS = '#A8823C'
const INK = '#1C1A17'
const AX = '#8C8273'
const SPLIT = 'rgba(28,26,23,.07)'

function renderMain() {
  if (!mainEl.value) return
  const c = echarts.init(mainEl.value)
  charts.push(c)
  c.setOption({
    grid: { left: 46, right: 16, top: 18, bottom: 28 },
    tooltip: { trigger: 'axis', backgroundColor: '#FBF8F0', borderColor: 'rgba(28,26,23,.12)', borderWidth: 1, textStyle: { color: INK }, extraCssText: 'box-shadow:0 8px 26px rgba(60,46,24,.14);border-radius:6px;' },
    xAxis: { type: 'category', data: timeLabels, boundaryGap: false, axisLine: { lineStyle: { color: 'rgba(28,26,23,.16)' } }, axisTick: { show: false }, axisLabel: { color: AX, interval: 11, fontSize: 11 }, splitLine: { show: false } },
    yAxis: { type: 'value', axisLabel: { color: AX, fontSize: 11 }, splitLine: { lineStyle: { color: SPLIT } } },
    series: [
      { name: '日前', type: 'line', data: dayAhead, smooth: true, symbol: 'none', lineStyle: { color: BRASS, width: 2.4 },
        areaStyle: { color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [{ offset: 0, color: 'rgba(168,130,60,.16)' }, { offset: 1, color: 'rgba(168,130,60,0)' }]) } },
      { name: '实时', type: 'line', data: realtime, smooth: true, symbol: 'none', lineStyle: { color: INK, width: 1.5, type: 'dashed' } },
    ],
  })
}

function renderNe() {
  if (!neEl.value) return
  const c = echarts.init(neEl.value)
  charts.push(c)
  c.setOption({
    grid: { left: 36, right: 12, top: 12, bottom: 24 },
    tooltip: { trigger: 'axis', backgroundColor: '#FBF8F0', borderColor: 'rgba(28,26,23,.12)', borderWidth: 1, textStyle: { color: INK }, extraCssText: 'box-shadow:0 8px 26px rgba(60,46,24,.14);border-radius:6px;' },
    xAxis: { type: 'category', data: timeLabels, boundaryGap: false, axisLine: { lineStyle: { color: 'rgba(28,26,23,.16)' } }, axisTick: { show: false }, axisLabel: { color: AX, interval: 23, fontSize: 10 } },
    yAxis: { type: 'value', max: 80, axisLabel: { color: AX, formatter: '{value}%', fontSize: 10 }, splitLine: { lineStyle: { color: SPLIT } } },
    series: [{ type: 'line', data: newEnergyShare, smooth: true, symbol: 'none', lineStyle: { color: '#6E8B7A', width: 2 },
      areaStyle: { color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [{ offset: 0, color: 'rgba(110,139,122,.18)' }, { offset: 1, color: 'rgba(110,139,122,0)' }]) } }],
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
.tg-root {
  --paper: #F4F0E6; --paper-2: #EFEADD; --card: #FBF8F0;
  --ink: #1C1A17; --ink-2: #4A463E; --ink-3: #8C8273;
  --brass: #A8823C; --brass-2: #C9A35B; --cinnabar: #B23A2E; --celadon: #5E8268;
  --line: rgba(28,26,23,.11); --line-2: rgba(28,26,23,.06);
  --serif: 'Songti SC', 'STSong', 'Source Han Serif SC', 'Noto Serif SC', Georgia, serif;
  position: fixed; inset: 0; overflow: auto; background: var(--paper); color: var(--ink);
  font-family: -apple-system, 'PingFang SC', 'Microsoft YaHei', sans-serif; -webkit-font-smoothing: antialiased;
}
.serif { font-family: var(--serif); }
.grain { position: fixed; inset: 0; z-index: 0; pointer-events: none; opacity: .5; mix-blend-mode: multiply;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.8' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.045'/%3E%3C/svg%3E"); }
.warp { position: fixed; inset: 0; z-index: 0; pointer-events: none;
  background-image: linear-gradient(var(--line-2) 1px, transparent 1px), linear-gradient(90deg, var(--line-2) 1px, transparent 1px);
  background-size: 30px 30px; mask-image: radial-gradient(120% 90% at 50% 0%, #000 30%, transparent 78%); }
.page { position: relative; z-index: 1; max-width: 1320px; margin: 0 auto; padding: 36px 38px 48px; }

.topbar { display: flex; justify-content: space-between; align-items: flex-end; margin-bottom: 28px; }
.brand { display: flex; align-items: center; gap: 15px; }
.seal svg { width: 42px; height: 42px; }
.seal rect { fill: none; stroke: var(--cinnabar); stroke-width: 1.6; }
.seal text { fill: var(--cinnabar); font-family: var(--serif); font-size: 20px; font-weight: 600; }
.eyebrow { font-size: 11px; letter-spacing: 3px; color: var(--brass); font-weight: 600; margin-bottom: 6px; }
.brand h1 { margin: 0; font-size: 27px; font-weight: 600; letter-spacing: 1px; color: var(--ink); }
.controls { display: flex; align-items: center; gap: 18px; }
.segment { display: inline-flex; background: var(--paper-2); border: 1px solid var(--line); border-radius: 9px; padding: 3px; }
.seg { border: none; background: transparent; font-size: 13px; color: var(--ink-3); padding: 6px 14px; border-radius: 6px; cursor: pointer; font-family: inherit; }
.seg.active { background: var(--card); color: var(--ink); box-shadow: 0 1px 2px rgba(60,46,24,.1); font-weight: 500; }
.live { display: inline-flex; align-items: center; gap: 7px; font-size: 13px; color: var(--ink-3); font-variant-numeric: tabular-nums; }
.live .dot { width: 7px; height: 7px; border-radius: 50%; background: var(--celadon); box-shadow: 0 0 0 3px rgba(94,130,104,.18); animation: pulse 2.4s infinite; }

.card { position: relative; background: var(--card); border: 1px solid var(--line); border-radius: 13px; padding: 20px 22px;
  box-shadow: 0 1px 0 rgba(255,255,255,.7) inset, 0 10px 30px -18px rgba(60,46,24,.4); }

.kpis { display: grid; grid-template-columns: repeat(6, 1fr); gap: 15px; margin-bottom: 18px; }
.kpi { padding: 17px 18px 15px; overflow: hidden; }
.gan { position: absolute; top: 12px; right: 14px; font-size: 15px; color: var(--brass); opacity: .5; }
.kpi-label { font-size: 12.5px; color: var(--ink-3); margin-bottom: 13px; }
.kpi-value { font-size: 30px; font-weight: 600; color: var(--ink); line-height: 1; letter-spacing: .2px; font-variant-numeric: tabular-nums; }
.kpi-unit { font-size: 11px; color: var(--ink-3); margin-left: 5px; font-weight: 400; font-family: -apple-system, 'PingFang SC', sans-serif; }
.kpi-foot { display: flex; justify-content: space-between; align-items: flex-end; margin-top: 14px; }
.delta { font-size: 12px; font-weight: 600; letter-spacing: .3px; }
.delta.up { color: var(--celadon); }
.delta.down { color: var(--cinnabar); }
.spark { width: 80px; height: 22px; }
.spark polyline { fill: none; stroke: var(--brass-2); stroke-width: 1.6; }

.grid { display: grid; grid-template-columns: 1fr 380px; gap: 18px; align-items: start; }
.side { display: flex; flex-direction: column; gap: 18px; }
.card-head { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 15px; }
.card-head h2 { margin: 0; font-size: 17px; font-weight: 600; color: var(--ink); letter-spacing: .5px; }
.sub { margin: 5px 0 0; font-size: 12px; color: var(--ink-3); }
.legend { display: flex; gap: 16px; font-size: 12px; color: var(--ink-2); }
.legend .sw { display: inline-block; width: 13px; height: 3px; border-radius: 2px; margin-right: 6px; vertical-align: middle; }
.sw.c1 { background: var(--brass); }
.sw.c2 { background: var(--ink); }
.chart-box { height: 322px; }
.chart-box.small { height: 168px; }

.snap { width: 100%; border-collapse: collapse; font-size: 13px; }
.snap th { color: var(--ink-3); font-weight: 500; padding: 8px 4px; border-bottom: 1px solid var(--line); text-align: left; font-size: 12px; }
.snap th.r, .snap td.r { text-align: right; }
.snap td { padding: 11px 4px; border-bottom: 1px solid var(--line-2); color: var(--ink-2); }
.snap tbody tr:last-child td { border-bottom: none; }
.snap td.num { font-variant-numeric: tabular-nums; }
.snap .rname { color: var(--ink); font-weight: 600; font-size: 14px; }
.pill { font-size: 11px; padding: 3px 9px; border-radius: 5px; }
.pill.tight { color: var(--cinnabar); background: rgba(178,58,46,.1); }
.pill.loose { color: var(--celadon); background: rgba(94,130,104,.12); }
.pill.mid { color: var(--brass); background: rgba(168,130,60,.13); }

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
