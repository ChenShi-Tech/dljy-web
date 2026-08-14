<template>
  <div class="swiss-root">
    <div class="page">
      <header class="topbar fade" style="--d: 0ms">
        <div class="brand">
          <span class="mark" />
          <div>
            <h1>电力交易决策驾驶舱</h1>
            <div class="eyebrow">SHANXI SPOT MARKET · DECISION COCKPIT</div>
          </div>
        </div>
        <div class="meta">
          <span class="mono">SX-SPOT</span>
          <span class="mono">2026.06.08</span>
          <span class="live"><i class="dot" />LIVE {{ clock }}</span>
        </div>
      </header>
      <div class="rule fade" style="--d: 40ms" />

      <section class="kpis">
        <div
          v-for="(k, i) in kpis"
          :key="k.label"
          class="kpi fade"
          :style="{ '--d': 90 + i * 55 + 'ms' }"
        >
          <div class="kpi-top"><span class="kpi-idx mono">{{ String(i + 1).padStart(2, '0') }}</span><span class="kpi-label">{{ k.label }}</span></div>
          <div class="kpi-value">{{ kpiVals[i] }}<span class="kpi-unit">{{ k.unit }}</span></div>
          <div class="kpi-foot">
            <span class="delta" :class="k.delta >= 0 ? 'up' : 'down'">{{ k.delta >= 0 ? '+' : '−' }}{{ Math.abs(k.delta) }}%</span>
            <svg class="spark" viewBox="0 0 70 18" preserveAspectRatio="none"><polyline :points="sparkPts(k.spark)" /></svg>
          </div>
        </div>
      </section>

      <section class="grid">
        <div class="panel main fade" style="--d: 520ms">
          <div class="panel-head">
            <div class="ph-left"><span class="ph-idx mono">01</span><h2>现货价格曲线</h2><span class="ph-en">PRICE CURVE / 96PT</span></div>
            <div class="legend"><span><i class="sw c1" />日前</span><span><i class="sw c2" />实时</span></div>
          </div>
          <div ref="mainEl" class="chart-box" />
        </div>

        <div class="side">
          <div class="panel fade" style="--d: 600ms">
            <div class="panel-head"><div class="ph-left"><span class="ph-idx mono">02</span><h2>新能源出力占比</h2></div></div>
            <div ref="neEl" class="chart-box small" />
          </div>
          <div class="panel fade" style="--d: 680ms">
            <div class="panel-head"><div class="ph-left"><span class="ph-idx mono">03</span><h2>分区出清快照</h2></div></div>
            <table class="snap">
              <thead>
                <tr><th>NODE / 区域</th><th class="r">价格</th><th class="r">负荷</th><th class="r">新能源</th><th class="r">态势</th></tr>
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

const clock = ref(new Date().toLocaleTimeString('en-GB', { hour12: false }))
let timer = 0
const kpiVals = kpis.map((k, i) => useCountUp(k.value, { decimals: k.decimals ?? 0, delay: 220 + i * 80, duration: 1600 }))

const sparkPts = (arr: number[]) => {
  const min = Math.min(...arr), max = Math.max(...arr), span = max - min || 1
  return arr.map((v, i) => `${(i / (arr.length - 1)) * 70},${18 - ((v - min) / span) * 15 - 1.5}`).join(' ')
}
const statusClass = (s: string) => (s === '偏紧' ? 'tight' : s === '宽松' ? 'loose' : 'mid')

const mainEl = ref<HTMLElement>()
const neEl = ref<HTMLElement>()
const charts: echarts.ECharts[] = []
const INDIGO = '#3B5BDB'
const INK = '#9A988F'
const AX = '#8E8C86'
const SPLIT = '#EBEAE4'

function renderMain() {
  if (!mainEl.value) return
  const c = echarts.init(mainEl.value)
  charts.push(c)
  c.setOption({
    grid: { left: 44, right: 14, top: 14, bottom: 26 },
    tooltip: { trigger: 'axis', backgroundColor: '#1A1A1A', borderColor: '#1A1A1A', textStyle: { color: '#fff', fontSize: 12 }, extraCssText: 'border-radius:6px;' },
    xAxis: { type: 'category', data: timeLabels, boundaryGap: false, axisLine: { lineStyle: { color: '#DAD8D0' } }, axisTick: { show: false }, axisLabel: { color: AX, interval: 11, fontSize: 11 }, splitLine: { show: false } },
    yAxis: { type: 'value', axisLabel: { color: AX, fontSize: 11 }, splitLine: { lineStyle: { color: SPLIT } } },
    series: [
      { name: '日前', type: 'line', data: dayAhead, smooth: false, symbol: 'none', lineStyle: { color: INDIGO, width: 2 },
        areaStyle: { color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [{ offset: 0, color: 'rgba(59,91,219,.10)' }, { offset: 1, color: 'rgba(59,91,219,0)' }]) } },
      { name: '实时', type: 'line', data: realtime, smooth: false, symbol: 'none', lineStyle: { color: INK, width: 1.4, type: 'dashed' } },
    ],
  })
}

function renderNe() {
  if (!neEl.value) return
  const c = echarts.init(neEl.value)
  charts.push(c)
  c.setOption({
    grid: { left: 34, right: 10, top: 12, bottom: 22 },
    tooltip: { trigger: 'axis', backgroundColor: '#1A1A1A', borderColor: '#1A1A1A', textStyle: { color: '#fff', fontSize: 12 }, extraCssText: 'border-radius:6px;' },
    xAxis: { type: 'category', data: timeLabels, boundaryGap: true, axisLine: { lineStyle: { color: '#DAD8D0' } }, axisTick: { show: false }, axisLabel: { color: AX, interval: 23, fontSize: 10 } },
    yAxis: { type: 'value', max: 80, axisLabel: { color: AX, formatter: '{value}%', fontSize: 10 }, splitLine: { lineStyle: { color: SPLIT } } },
    series: [{ type: 'bar', data: newEnergyShare, barWidth: '52%', itemStyle: { color: '#C7CEE8' } }],
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
.swiss-root { position: fixed; inset: 0; overflow: auto; background: #F7F7F4;
  color: #1A1A1A; font-family: 'Inter', -apple-system, 'PingFang SC', 'Microsoft YaHei', sans-serif; -webkit-font-smoothing: antialiased; }
.mono { font-family: 'SF Mono', 'JetBrains Mono', Menlo, Consolas, monospace; }
.page { max-width: 1340px; margin: 0 auto; padding: 32px 36px 44px; }

.topbar { display: flex; justify-content: space-between; align-items: center; }
.brand { display: flex; align-items: center; gap: 14px; }
.mark { width: 28px; height: 28px; background: #3B5BDB; }
.brand h1 { margin: 0; font-size: 23px; font-weight: 700; letter-spacing: -.3px; color: #141414; }
.eyebrow { font-size: 10.5px; letter-spacing: 1.8px; color: #9A988F; font-weight: 500; margin-top: 4px; }
.meta { display: flex; align-items: center; gap: 18px; font-size: 11.5px; color: #8E8C86; }
.meta .mono { letter-spacing: .5px; }
.live { display: inline-flex; align-items: center; gap: 6px; color: #3B5BDB; font-weight: 500; letter-spacing: .5px; }
.live .dot { width: 6px; height: 6px; border-radius: 50%; background: #3B5BDB; animation: pulse 2s infinite; }
.rule { height: 1px; background: #1A1A1A; margin: 16px 0 22px; opacity: .85; }

.kpis { display: grid; grid-template-columns: repeat(6, 1fr); gap: 0; margin-bottom: 24px; border: 1px solid #E2E0D8; background: #fff; }
.kpi { padding: 16px 18px; border-right: 1px solid #ECEAE3; }
.kpi:last-child { border-right: none; }
.kpi-top { display: flex; align-items: center; gap: 8px; margin-bottom: 14px; }
.kpi-idx { font-size: 10px; color: #3B5BDB; font-weight: 600; }
.kpi-label { font-size: 11.5px; color: #76746C; letter-spacing: .2px; }
.kpi-value { font-size: 27px; font-weight: 700; color: #141414; line-height: 1; letter-spacing: -1px; font-variant-numeric: tabular-nums; }
.kpi-unit { font-size: 10.5px; color: #9A988F; margin-left: 5px; font-weight: 500; letter-spacing: 0; }
.kpi-foot { display: flex; justify-content: space-between; align-items: flex-end; margin-top: 13px; }
.delta { font-size: 12px; font-weight: 600; font-variant-numeric: tabular-nums; }
.delta.up { color: #2F6B43; }
.delta.down { color: #B23A3A; }
.spark { width: 70px; height: 18px; }
.spark polyline { fill: none; stroke: #B9C2E6; stroke-width: 1.5; }

.grid { display: grid; grid-template-columns: 1fr 380px; gap: 20px; align-items: start; }
.side { display: flex; flex-direction: column; gap: 20px; }
.panel { background: #fff; border: 1px solid #E2E0D8; padding: 20px 22px; }
.panel-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
.ph-left { display: flex; align-items: baseline; gap: 10px; }
.ph-idx { font-size: 11px; color: #3B5BDB; font-weight: 600; }
.panel-head h2 { margin: 0; font-size: 15px; font-weight: 600; color: #141414; }
.ph-en { font-size: 10px; letter-spacing: 1.5px; color: #ADABA2; font-weight: 500; }
.legend { display: flex; gap: 16px; font-size: 12px; color: #76746C; }
.legend .sw { display: inline-block; width: 12px; height: 3px; margin-right: 6px; vertical-align: middle; }
.sw.c1 { background: #3B5BDB; }
.sw.c2 { background: #9A988F; }
.chart-box { height: 322px; }
.chart-box.small { height: 168px; }

.snap { width: 100%; border-collapse: collapse; font-size: 13px; }
.snap th { color: #ADABA2; font-weight: 500; padding: 8px 4px; border-bottom: 1px solid #1A1A1A; text-align: left; font-size: 11px; letter-spacing: .3px; }
.snap th.r, .snap td.r { text-align: right; }
.snap td { padding: 11px 4px; border-bottom: 1px solid #F0EEE7; color: #45433D; }
.snap tbody tr:last-child td { border-bottom: none; }
.snap td.num { font-variant-numeric: tabular-nums; }
.snap .rname { color: #141414; font-weight: 600; }
.pill { font-size: 11px; padding: 2px 9px; border-radius: 3px; font-weight: 500; }
.pill.tight { color: #B23A3A; background: rgba(178,58,58,.09); }
.pill.loose { color: #2F6B43; background: rgba(47,107,67,.09); }
.pill.mid { color: #8A6D20; background: rgba(138,109,32,.10); }

@keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: .4; } }
.fade { opacity: 0; transform: translateY(10px); animation: fadeUp .6s cubic-bezier(.22,.61,.36,1) forwards; animation-delay: var(--d, 0ms); }
@keyframes fadeUp { to { opacity: 1; transform: none; } }

@media (max-width: 768px) {
  .kpis { grid-template-columns: repeat(3, 1fr); }
  .grid { grid-template-columns: 1fr; }
}
@media (max-width: 480px) {
  .kpis { grid-template-columns: repeat(2, 1fr); }
}
</style>
