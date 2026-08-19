<template>
  <div class="paper-root">
    <div class="page">
      <!-- header -->
      <header class="topbar fade" style="--d: 0ms">
        <div class="brand">
          <span class="mark" />
          <div>
            <div class="eyebrow">SHANXI SPOT MARKET</div>
            <h1>电力交易决策驾驶舱</h1>
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

      <!-- KPI row -->
      <section class="kpis">
        <div
          v-for="(k, i) in kpis"
          :key="k.label"
          class="card kpi fade"
          :style="{ '--d': 80 + i * 60 + 'ms' }"
        >
          <div class="kpi-label">{{ k.label }}</div>
          <div class="kpi-value serif">{{ kpiVals[i] }}<span class="kpi-unit">{{ k.unit }}</span></div>
          <div class="kpi-foot">
            <span class="delta" :class="k.delta >= 0 ? 'up' : 'down'">
              {{ k.delta >= 0 ? '↑' : '↓' }} {{ Math.abs(k.delta) }}%
            </span>
            <svg class="spark" viewBox="0 0 80 22" preserveAspectRatio="none">
              <polyline :points="sparkPts(k.spark)" />
            </svg>
          </div>
        </div>
      </section>

      <!-- main grid -->
      <section class="grid">
        <div class="card main fade" style="--d: 520ms">
          <div class="card-head">
            <div>
              <h2>现货价格曲线</h2>
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
          <div class="card fade" style="--d: 600ms">
            <div class="card-head"><div><h2>新能源出力占比</h2><p class="sub">全天趋势</p></div></div>
            <div ref="neEl" class="chart-box small" />
          </div>

          <div class="card fade" style="--d: 680ms">
            <div class="card-head"><div><h2>分区出清快照</h2></div></div>
            <table class="snap">
              <thead>
                <tr><th>区域</th><th class="r">出清价</th><th class="r">负荷</th><th class="r">新能源</th><th class="r">态势</th></tr>
              </thead>
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
const kpiVals = kpis.map((k, i) => useCountUp(k.value, { decimals: k.decimals ?? 0, delay: 200 + i * 90, duration: 1700 }))

const sparkPts = (arr: number[]) => {
  const min = Math.min(...arr), max = Math.max(...arr), span = max - min || 1
  return arr.map((v, i) => `${(i / (arr.length - 1)) * 80},${22 - ((v - min) / span) * 18 - 2}`).join(' ')
}
const statusClass = (s: string) => (s === '偏紧' ? 'tight' : s === '宽松' ? 'loose' : 'mid')

const mainEl = ref<HTMLElement>()
const neEl = ref<HTMLElement>()
const charts: echarts.ECharts[] = []
const CLAY = '#C45B36'
const INK = '#8A8378'
const AX = '#9A958C'
const SPLIT = '#EFEDE7'

function renderMain() {
  if (!mainEl.value) return
  const c = echarts.init(mainEl.value)
  charts.push(c)
  c.setOption({
    grid: { left: 46, right: 16, top: 16, bottom: 28 },
    tooltip: { trigger: 'axis', backgroundColor: '#fff', borderColor: '#ECE8DF', borderWidth: 1, textStyle: { color: '#1F1D1A' }, extraCssText: 'box-shadow:0 6px 20px rgba(80,60,40,.1);border-radius:8px;' },
    xAxis: { type: 'category', data: timeLabels, boundaryGap: false, axisLine: { lineStyle: { color: '#E4E0D6' } }, axisTick: { show: false }, axisLabel: { color: AX, interval: 11, fontSize: 11 }, splitLine: { show: false } },
    yAxis: { type: 'value', axisLabel: { color: AX, fontSize: 11 }, splitLine: { lineStyle: { color: SPLIT } } },
    series: [
      { name: '日前', type: 'line', data: dayAhead, smooth: true, symbol: 'none', lineStyle: { color: CLAY, width: 2.2 },
        areaStyle: { color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [{ offset: 0, color: 'rgba(196,91,54,.10)' }, { offset: 1, color: 'rgba(196,91,54,0)' }]) } },
      { name: '实时', type: 'line', data: realtime, smooth: true, symbol: 'none', lineStyle: { color: INK, width: 1.6, type: 'dashed' } },
    ],
  })
}

function renderNe() {
  if (!neEl.value) return
  const c = echarts.init(neEl.value)
  charts.push(c)
  c.setOption({
    grid: { left: 36, right: 12, top: 12, bottom: 24 },
    tooltip: { trigger: 'axis', backgroundColor: '#fff', borderColor: '#ECE8DF', borderWidth: 1, textStyle: { color: '#1F1D1A' }, extraCssText: 'box-shadow:0 6px 20px rgba(80,60,40,.1);border-radius:8px;' },
    xAxis: { type: 'category', data: timeLabels, boundaryGap: false, axisLine: { lineStyle: { color: '#E4E0D6' } }, axisTick: { show: false }, axisLabel: { color: AX, interval: 23, fontSize: 10 } },
    yAxis: { type: 'value', max: 80, axisLabel: { color: AX, formatter: '{value}%', fontSize: 10 }, splitLine: { lineStyle: { color: SPLIT } } },
    series: [{ type: 'line', data: newEnergyShare, smooth: true, symbol: 'none', lineStyle: { color: '#A07E4A', width: 2 },
      areaStyle: { color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [{ offset: 0, color: 'rgba(160,126,74,.14)' }, { offset: 1, color: 'rgba(160,126,74,0)' }]) } }],
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
.paper-root {
  position: fixed; inset: 0; overflow: auto; background: #FAF9F6;
  color: #1F1D1A; font-family: 'Inter', -apple-system, 'PingFang SC', 'Microsoft YaHei', sans-serif;
  -webkit-font-smoothing: antialiased;
}
.serif { font-family: 'Source Serif 4', 'Source Serif Pro', Georgia, 'Songti SC', serif; }
.page { max-width: 1320px; margin: 0 auto; padding: 34px 36px 44px; }

.topbar { display: flex; justify-content: space-between; align-items: flex-end; margin-bottom: 26px; }
.brand { display: flex; align-items: center; gap: 14px; }
.mark { width: 30px; height: 30px; border-radius: 9px; background: #C45B36; box-shadow: inset 0 0 0 4px rgba(255,255,255,.55); }
.eyebrow { font-size: var(--font-xs); letter-spacing: 2.5px; color: #A4998A; font-weight: 600; margin-bottom: 4px; }
.brand h1 { margin: 0; font-size: var(--font-25); font-weight: 600; letter-spacing: .2px; color: #211F1B; }
.controls { display: flex; align-items: center; gap: 18px; }
.segment { display: inline-flex; background: #F0ECE3; border: 1px solid #E6E1D6; border-radius: 10px; padding: 3px; }
.seg { border: none; background: transparent; font-size: var(--font-md); color: #6B6760; padding: 6px 14px; border-radius: 7px; cursor: pointer; font-family: inherit; }
.seg.active { background: #fff; color: #211F1B; box-shadow: 0 1px 2px rgba(80,60,40,.08); font-weight: 500; }
.live { display: inline-flex; align-items: center; gap: 7px; font-size: var(--font-md); color: #8A8378; font-variant-numeric: tabular-nums; }
.live .dot { width: 7px; height: 7px; border-radius: 50%; background: #5B8F6E; box-shadow: 0 0 0 3px rgba(91,143,110,.16); animation: pulse 2.4s infinite; }

.card { background: #FFFFFF; border: 1px solid #ECE8DF; border-radius: 14px; padding: 20px 22px; }

.kpis { display: grid; grid-template-columns: repeat(6, 1fr); gap: 16px; margin-bottom: 18px; }
.kpi { padding: 18px 18px 16px; }
.kpi-label { font-size: var(--font-12-5); color: #7A746A; margin-bottom: 12px; }
.kpi-value { font-size: var(--font-29); font-weight: 600; color: #211F1B; line-height: 1; letter-spacing: -.5px; }
.kpi-unit { font-size: var(--font-xs); color: #A4998A; margin-left: 5px; font-weight: 400; font-family: 'Inter', sans-serif; }
.kpi-foot { display: flex; justify-content: space-between; align-items: flex-end; margin-top: 14px; }
.delta { font-size: var(--font-sm); font-weight: 500; }
.delta.up { color: #4F7355; }
.delta.down { color: #B4543A; }
.spark { width: 80px; height: 22px; }
.spark polyline { fill: none; stroke: #C9A98F; stroke-width: 1.6; }

.grid { display: grid; grid-template-columns: 1fr 380px; gap: 18px; align-items: start; }
.side { display: flex; flex-direction: column; gap: 18px; }
.card-head { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 14px; }
.card-head h2 { margin: 0; font-size: var(--font-16); font-weight: 600; color: #211F1B; }
.sub { margin: 5px 0 0; font-size: var(--font-sm); color: #9A958C; }
.legend { display: flex; gap: 16px; font-size: var(--font-sm); color: #7A746A; }
.legend .sw { display: inline-block; width: 12px; height: 3px; border-radius: 2px; margin-right: 6px; vertical-align: middle; }
.sw.c1 { background: #C45B36; }
.sw.c2 { background: #8A8378; }
.chart-box { height: 320px; }
.chart-box.small { height: 170px; }

.snap { width: 100%; border-collapse: collapse; font-size: var(--font-md); }
.snap th { color: #A4998A; font-weight: 500; padding: 8px 4px; border-bottom: 1px solid #EFEBE2; text-align: left; font-size: var(--font-sm); }
.snap th.r, .snap td.r { text-align: right; }
.snap td { padding: 11px 4px; border-bottom: 1px solid #F4F1EA; color: #4A463F; }
.snap tbody tr:last-child td { border-bottom: none; }
.snap td.num { font-variant-numeric: tabular-nums; }
.snap .rname { color: #211F1B; font-weight: 600; }
.pill { font-size: var(--font-xs); padding: 3px 9px; border-radius: 6px; }
.pill.tight { color: #B4543A; background: rgba(180,84,58,.10); }
.pill.loose { color: #4F7355; background: rgba(79,115,85,.10); }
.pill.mid { color: #9A7B3A; background: rgba(154,123,58,.12); }

@keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: .45; } }
.fade { opacity: 0; transform: translateY(10px); animation: fadeUp .6s cubic-bezier(.22,.61,.36,1) forwards; animation-delay: var(--d, 0ms); }
@keyframes fadeUp { to { opacity: 1; transform: none; } }

@media (max-width: 768px) {
  .kpis { grid-template-columns: repeat(3, 1fr); gap: 10px; }
  .grid { grid-template-columns: 1fr; }
}
@media (max-width: 480px) {
  .kpis { grid-template-columns: repeat(2, 1fr); }
}
</style>
