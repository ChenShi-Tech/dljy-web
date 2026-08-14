<template>
  <div class="sage-root">
    <div class="page">
      <header class="topbar fade" style="--d: 0ms">
        <div class="brand">
          <span class="mark">⚡</span>
          <div>
            <h1>电力交易决策驾驶舱</h1>
            <p class="sub">山西现货市场 · 实时态势感知</p>
          </div>
        </div>
        <div class="controls">
          <div class="segment">
            <button class="seg active">今日</button>
            <button class="seg">本周</button>
            <button class="seg">本月</button>
          </div>
          <span class="live"><i class="dot" />实时 {{ clock }}</span>
        </div>
      </header>

      <section class="kpis">
        <div
          v-for="(k, i) in kpis"
          :key="k.label"
          class="card kpi fade"
          :style="{ '--d': 80 + i * 60 + 'ms' }"
        >
          <div class="kpi-head">
            <span class="ico" :style="{ background: iconBg[i % iconBg.length] }">{{ icons[i % icons.length] }}</span>
            <span class="kpi-label">{{ k.label }}</span>
          </div>
          <div class="kpi-value">{{ kpiVals[i] }}<span class="kpi-unit">{{ k.unit }}</span></div>
          <div class="kpi-foot">
            <span class="delta" :class="k.delta >= 0 ? 'up' : 'down'">{{ k.delta >= 0 ? '↑' : '↓' }} {{ Math.abs(k.delta) }}%</span>
            <svg class="spark" viewBox="0 0 76 20" preserveAspectRatio="none"><polyline :points="sparkPts(k.spark)" /></svg>
          </div>
        </div>
      </section>

      <section class="grid">
        <div class="card main fade" style="--d: 520ms">
          <div class="card-head">
            <div><h2>现货价格曲线</h2><p class="muted">日前出清价 vs 实时出清价 · 全天 96 点</p></div>
            <div class="legend"><span><i class="sw c1" />日前</span><span><i class="sw c2" />实时</span></div>
          </div>
          <div ref="mainEl" class="chart-box" />
        </div>

        <div class="side">
          <div class="card fade" style="--d: 600ms">
            <div class="card-head"><div><h2>新能源出力占比</h2><p class="muted">全天趋势</p></div></div>
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
const icons = ['¥', '⇅', '☀', '◆', '⚡', '◷']
const iconBg = ['#E4EBDD', '#E7E3D5', '#DFE8E2', '#ECE4DA', '#E4EBDD', '#E7E3D5']

const sparkPts = (arr: number[]) => {
  const min = Math.min(...arr), max = Math.max(...arr), span = max - min || 1
  return arr.map((v, i) => `${(i / (arr.length - 1)) * 76},${20 - ((v - min) / span) * 16 - 2}`).join(' ')
}
const statusClass = (s: string) => (s === '偏紧' ? 'tight' : s === '宽松' ? 'loose' : 'mid')

const mainEl = ref<HTMLElement>()
const neEl = ref<HTMLElement>()
const charts: echarts.ECharts[] = []
const SAGE = '#6F8466'
const GRAY = '#A9A395'
const AX = '#9B978A'
const SPLIT = '#ECEAE1'

function renderMain() {
  if (!mainEl.value) return
  const c = echarts.init(mainEl.value)
  charts.push(c)
  c.setOption({
    grid: { left: 46, right: 16, top: 16, bottom: 28 },
    tooltip: { trigger: 'axis', backgroundColor: '#fff', borderColor: '#E6E4D9', borderWidth: 1, textStyle: { color: '#2C2E28' }, extraCssText: 'box-shadow:0 8px 24px rgba(70,80,60,.12);border-radius:10px;' },
    xAxis: { type: 'category', data: timeLabels, boundaryGap: false, axisLine: { lineStyle: { color: '#DEDBCF' } }, axisTick: { show: false }, axisLabel: { color: AX, interval: 11, fontSize: 11 }, splitLine: { show: false } },
    yAxis: { type: 'value', axisLabel: { color: AX, fontSize: 11 }, splitLine: { lineStyle: { color: SPLIT } } },
    series: [
      { name: '日前', type: 'line', data: dayAhead, smooth: true, symbol: 'none', lineStyle: { color: SAGE, width: 2.4 },
        areaStyle: { color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [{ offset: 0, color: 'rgba(111,132,102,.16)' }, { offset: 1, color: 'rgba(111,132,102,0)' }]) } },
      { name: '实时', type: 'line', data: realtime, smooth: true, symbol: 'none', lineStyle: { color: GRAY, width: 1.6, type: 'dashed' } },
    ],
  })
}

function renderNe() {
  if (!neEl.value) return
  const c = echarts.init(neEl.value)
  charts.push(c)
  c.setOption({
    grid: { left: 36, right: 12, top: 12, bottom: 24 },
    tooltip: { trigger: 'axis', backgroundColor: '#fff', borderColor: '#E6E4D9', borderWidth: 1, textStyle: { color: '#2C2E28' }, extraCssText: 'box-shadow:0 8px 24px rgba(70,80,60,.12);border-radius:10px;' },
    xAxis: { type: 'category', data: timeLabels, boundaryGap: false, axisLine: { lineStyle: { color: '#DEDBCF' } }, axisTick: { show: false }, axisLabel: { color: AX, interval: 23, fontSize: 10 } },
    yAxis: { type: 'value', max: 80, axisLabel: { color: AX, formatter: '{value}%', fontSize: 10 }, splitLine: { lineStyle: { color: SPLIT } } },
    series: [{ type: 'line', data: newEnergyShare, smooth: true, symbol: 'none', lineStyle: { color: '#B08A57', width: 2.2 },
      areaStyle: { color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [{ offset: 0, color: 'rgba(176,138,87,.16)' }, { offset: 1, color: 'rgba(176,138,87,0)' }]) } }],
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
.sage-root { position: fixed; inset: 0; overflow: auto; background: #F2F1E9;
  color: #2C2E28; font-family: 'Inter', -apple-system, 'PingFang SC', 'Microsoft YaHei', sans-serif; -webkit-font-smoothing: antialiased; }
.page { max-width: 1320px; margin: 0 auto; padding: 34px 36px 44px; }

.topbar { display: flex; justify-content: space-between; align-items: center; margin-bottom: 26px; }
.brand { display: flex; align-items: center; gap: 14px; }
.mark { width: 44px; height: 44px; border-radius: 14px; display: grid; place-items: center; font-size: 20px; background: #6F8466; color: #fff; box-shadow: 0 6px 16px rgba(111,132,102,.3); }
.brand h1 { margin: 0; font-size: 24px; font-weight: 650; letter-spacing: .2px; color: #2A2C26; }
.brand .sub { margin: 4px 0 0; font-size: 12.5px; color: #8C887C; }
.controls { display: flex; align-items: center; gap: 16px; }
.segment { display: inline-flex; background: #E9E7DC; border-radius: 12px; padding: 4px; }
.seg { border: none; background: transparent; font-size: 13px; color: #6E7268; padding: 6px 15px; border-radius: 9px; cursor: pointer; font-family: inherit; }
.seg.active { background: #fff; color: #2A2C26; box-shadow: 0 2px 6px rgba(70,80,60,.10); font-weight: 500; }
.live { display: inline-flex; align-items: center; gap: 7px; font-size: 13px; color: #8C887C; font-variant-numeric: tabular-nums; }
.live .dot { width: 7px; height: 7px; border-radius: 50%; background: #6F8466; box-shadow: 0 0 0 3px rgba(111,132,102,.18); animation: pulse 2.4s infinite; }

.card { background: #FBFBF7; border: 1px solid #E9E7DC; border-radius: 20px; padding: 20px 22px; box-shadow: 0 4px 18px rgba(80,85,60,.05); }

.kpis { display: grid; grid-template-columns: repeat(6, 1fr); gap: 16px; margin-bottom: 18px; }
.kpi { padding: 18px; }
.kpi-head { display: flex; align-items: center; gap: 9px; margin-bottom: 14px; }
.ico { width: 26px; height: 26px; border-radius: 8px; display: grid; place-items: center; font-size: 13px; color: #5E6E55; flex: none; }
.kpi-label { font-size: 12px; color: #7C7A6F; }
.kpi-value { font-size: 28px; font-weight: 650; color: #2A2C26; line-height: 1; letter-spacing: -.5px; }
.kpi-unit { font-size: 11px; color: #A29D8F; margin-left: 5px; font-weight: 400; }
.kpi-foot { display: flex; justify-content: space-between; align-items: flex-end; margin-top: 14px; }
.delta { font-size: 12px; font-weight: 500; }
.delta.up { color: #5E7D52; }
.delta.down { color: #B56B47; }
.spark { width: 76px; height: 20px; }
.spark polyline { fill: none; stroke: #B6C2A8; stroke-width: 1.8; }

.grid { display: grid; grid-template-columns: 1fr 380px; gap: 18px; align-items: start; }
.side { display: flex; flex-direction: column; gap: 18px; }
.card-head { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 14px; }
.card-head h2 { margin: 0; font-size: 16px; font-weight: 600; color: #2A2C26; }
.muted { margin: 5px 0 0; font-size: 12px; color: #9B978A; }
.legend { display: flex; gap: 16px; font-size: 12px; color: #7C7A6F; }
.legend .sw { display: inline-block; width: 12px; height: 3px; border-radius: 2px; margin-right: 6px; vertical-align: middle; }
.sw.c1 { background: #6F8466; }
.sw.c2 { background: #A9A395; }
.chart-box { height: 320px; }
.chart-box.small { height: 170px; }

.snap { width: 100%; border-collapse: collapse; font-size: 13px; }
.snap th { color: #A29D8F; font-weight: 500; padding: 8px 4px; border-bottom: 1px solid #EDEBE1; text-align: left; font-size: 12px; }
.snap th.r, .snap td.r { text-align: right; }
.snap td { padding: 11px 4px; border-bottom: 1px solid #F2F0E8; color: #4D4F46; }
.snap tbody tr:last-child td { border-bottom: none; }
.snap td.num { font-variant-numeric: tabular-nums; }
.snap .rname { color: #2A2C26; font-weight: 600; }
.pill { font-size: 11px; padding: 3px 11px; border-radius: 999px; }
.pill.tight { color: #B56B47; background: rgba(181,107,71,.12); }
.pill.loose { color: #5E7D52; background: rgba(94,125,82,.14); }
.pill.mid { color: #927B3C; background: rgba(146,123,60,.14); }

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
