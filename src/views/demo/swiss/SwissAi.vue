<template>
  <div class="swiss-root">
    <div class="page">
      <header class="topbar fade" style="--d: 0ms">
        <div class="brand">
          <span class="mark" />
          <div>
            <h1>AI 分析助手</h1>
            <div class="eyebrow">NEURAL TRADING COPILOT</div>
          </div>
        </div>
        <span class="meta mono">NL → ANALYSIS + TABLE + CHART</span>
      </header>
      <div class="rule fade" style="--d: 40ms" />

      <div class="cols">
        <section class="chat fade" style="--d: 80ms">
          <div class="col-head"><span class="ci mono">01</span>对话 / SESSION</div>
          <div class="thread">
            <div v-if="showUser" class="msg user"><div class="bubble">分析山西现货市场次日价格走势,并给出关键时段交易建议。</div></div>
            <div v-if="showAssistant" class="msg ai">
              <span class="avatar">AI</span>
              <div class="ai-body">
                <div class="steps">
                  <div v-for="(s, i) in steps" :key="s" class="step" :class="{ done: stepDone > i }">
                    <i class="ck mono">{{ stepDone > i ? '[✓]' : '[ ]' }}</i>{{ s }}
                  </div>
                </div>
                <p class="stream">{{ streamed }}<span v-if="!streamDone" class="cursor">▍</span></p>
                <p v-if="streamDone" class="done-note">→ 已在右侧生成分析报告</p>
              </div>
            </div>
          </div>
          <div class="composer">
            <div class="chips">
              <button v-for="c in aiChips" :key="c" class="chip">{{ c }}</button>
            </div>
            <div class="inputbar">
              <input placeholder="输入指令,例如:复盘本周持仓收益…" />
              <button class="send">↑</button>
            </div>
          </div>
        </section>

        <section class="artifact-wrap fade" style="--d: 160ms">
          <div class="col-head between">
            <span><span class="ci mono">02</span>分析报告 / ARTIFACT</span>
            <span v-if="showArtifact" class="tag mono">GENERATED</span>
          </div>
          <div class="artifact-body">
            <transition name="rise">
              <div v-if="showArtifact" class="artifact">
                <h2 class="art-h">山西现货次日价格分析</h2>
                <p class="summary">{{ aiAnalysisText }}</p>
                <div class="art-sub"><span class="mono">▸</span> {{ aiArtifactTable.title }}</div>
                <table class="art-table">
                  <thead><tr><th v-for="c in aiArtifactTable.columns" :key="c">{{ c }}</th></tr></thead>
                  <tbody>
                    <tr v-for="(r, ri) in aiArtifactTable.rows" :key="ri">
                      <td v-for="(cell, ci) in r" :key="ci" :class="{ adv: ci === 4, num: ci > 0 && ci < 4 }">{{ cell }}</td>
                    </tr>
                  </tbody>
                </table>
                <div class="art-sub"><span class="mono">▸</span> 次日 24h 价格预测曲线</div>
                <div ref="chartEl" class="art-chart" />
              </div>
              <div v-else class="placeholder">
                <div class="spinner" /><p class="mono">ANALYZING…</p>
              </div>
            </transition>
          </div>
        </section>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, nextTick } from 'vue'
import * as echarts from 'echarts'
import { aiAnalysisText, aiArtifactTable, aiChips, timeLabels, dayAhead, realtime } from '../mock'

const showUser = ref(false)
const showAssistant = ref(false)
const showArtifact = ref(false)
const streamed = ref('')
const streamDone = ref(false)
const steps = ['解析意图 · 锁定指标', '查询现货 / 负荷 / 新能源数据', '回归建模 · 价格预测', '生成分析报告与图表']
const stepDone = ref(0)

const chartEl = ref<HTMLElement>()
let chart: echarts.ECharts | null = null
const timers: number[] = []
const T = (fn: () => void, ms: number) => timers.push(window.setTimeout(fn, ms))

function streamText() {
  const full = aiAnalysisText
  let i = 0
  const tick = () => {
    i += 4
    streamed.value = full.slice(0, i)
    if (i < full.length) timers.push(window.setTimeout(tick, 14))
    else { streamDone.value = true; revealArtifact() }
  }
  tick()
}

function revealArtifact() {
  showArtifact.value = true
  nextTick(() => {
    if (!chartEl.value) return
    chart = echarts.init(chartEl.value)
    const hourLabels = timeLabels.filter((_, i) => i % 4 === 0)
    const da = dayAhead.filter((_, i) => i % 4 === 0)
    const rt = realtime.filter((_, i) => i % 4 === 0)
    chart.setOption({
      grid: { left: 44, right: 14, top: 24, bottom: 26 },
      tooltip: { trigger: 'axis', backgroundColor: '#1A1A1A', borderColor: '#1A1A1A', textStyle: { color: '#fff', fontSize: 12 }, extraCssText: 'border-radius:6px;' },
      legend: { data: ['日前预测', '实时预测'], textStyle: { color: '#76746C' }, right: 4, top: 0, icon: 'roundRect', itemWidth: 12, itemHeight: 4 },
      xAxis: { type: 'category', data: hourLabels, axisLabel: { color: '#8E8C86', fontSize: 10 }, axisTick: { show: false }, axisLine: { lineStyle: { color: '#DAD8D0' } } },
      yAxis: { type: 'value', axisLabel: { color: '#8E8C86', fontSize: 10 }, splitLine: { lineStyle: { color: '#EBEAE4' } } },
      series: [
        { name: '日前预测', type: 'line', data: da, smooth: false, symbol: 'none', lineStyle: { color: '#3B5BDB', width: 2 },
          areaStyle: { color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [{ offset: 0, color: 'rgba(59,91,219,.10)' }, { offset: 1, color: 'rgba(59,91,219,0)' }]) } },
        { name: '实时预测', type: 'line', data: rt, smooth: false, symbol: 'none', lineStyle: { color: '#9A988F', width: 1.4, type: 'dashed' } },
      ],
    })
  })
}

onMounted(() => {
  T(() => (showUser.value = true), 200)
  T(() => (showAssistant.value = true), 460)
  T(() => (stepDone.value = 1), 620)
  T(() => (stepDone.value = 2), 860)
  T(() => (stepDone.value = 3), 1100)
  T(() => { stepDone.value = 4; streamText() }, 1340)
})
onBeforeUnmount(() => { timers.forEach(clearTimeout); chart?.dispose() })
</script>

<style scoped>
.swiss-root { position: fixed; inset: 0; overflow: auto; background: #F7F7F4;
  color: #1A1A1A; font-family: 'Inter', -apple-system, 'PingFang SC', 'Microsoft YaHei', sans-serif; -webkit-font-smoothing: antialiased; }
.mono { font-family: 'SF Mono', 'JetBrains Mono', Menlo, Consolas, monospace; }
.page { max-width: 1340px; margin: 0 auto; padding: 32px 36px 26px; display: flex; flex-direction: column; height: 100%; box-sizing: border-box; }

.topbar { display: flex; justify-content: space-between; align-items: center; }
.brand { display: flex; align-items: center; gap: 14px; }
.mark { width: 28px; height: 28px; background: #3B5BDB; }
.brand h1 { margin: 0; font-size: 23px; font-weight: 700; letter-spacing: -.3px; color: #141414; }
.eyebrow { font-size: 10.5px; letter-spacing: 1.8px; color: #9A988F; font-weight: 500; margin-top: 4px; }
.meta { font-size: 11px; color: #8E8C86; letter-spacing: 1px; }
.rule { height: 1px; background: #1A1A1A; margin: 16px 0 20px; opacity: .85; }

.cols { display: grid; grid-template-columns: 42% 1fr; gap: 20px; flex: 1; min-height: 0; }
.col-head { font-size: 12px; color: #76746C; font-weight: 600; letter-spacing: .5px; margin-bottom: 14px; display: flex; align-items: center; }
.col-head.between { justify-content: space-between; }
.ci { color: #3B5BDB; margin-right: 9px; font-size: 11px; }

.chat { display: flex; flex-direction: column; background: #fff; border: 1px solid #E2E0D8; padding: 20px 22px; }
.thread { flex: 1; overflow: auto; display: flex; flex-direction: column; gap: 18px; }
.msg.user { display: flex; justify-content: flex-end; }
.msg.user .bubble { max-width: 86%; background: #F3F3EF; border: 1px solid #E6E4DC; color: #2B2B28; padding: 11px 15px; font-size: 14px; line-height: 1.6; border-radius: 2px; }
.msg.ai { display: flex; gap: 12px; align-items: flex-start; }
.avatar { width: 30px; height: 30px; flex: none; display: grid; place-items: center; background: #3B5BDB; color: #fff; font-size: 11px; font-weight: 700; border-radius: 2px; }
.ai-body { font-size: 14.5px; line-height: 1.75; color: #2B2B28; padding-top: 2px; }
.steps { display: flex; flex-direction: column; gap: 5px; margin-bottom: 12px; }
.step { font-size: 12.5px; color: #A8A69D; display: flex; align-items: center; gap: 8px; transition: color .3s; }
.step.done { color: #3B5BDB; }
.step .ck { font-size: 11px; }
.stream { margin: 0; white-space: pre-wrap; }
.cursor { color: #3B5BDB; animation: blink 1s steps(2) infinite; }
.done-note { margin: 12px 0 0; font-size: 12.5px; color: #3B5BDB; font-weight: 500; }

.composer { margin-top: 18px; }
.chips { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 12px; }
.chip { font-size: 12.5px; padding: 7px 12px; cursor: pointer; color: #5C5A53; background: #F4F4F0; border: 1px solid #E6E4DC; font-family: inherit; border-radius: 2px; transition: all .2s; }
.chip:hover { border-color: #3B5BDB; color: #3B5BDB; }
.inputbar { display: flex; align-items: center; gap: 10px; border: 1px solid #1A1A1A; padding: 8px 8px 8px 14px; background: #fff; }
.inputbar input { flex: 1; border: none; background: transparent; font-size: 14px; color: #2B2B28; outline: none; font-family: inherit; }
.inputbar input::placeholder { color: #A8A69D; }
.send { width: 34px; height: 34px; border: none; cursor: pointer; background: #3B5BDB; color: #fff; font-size: 16px; flex: none; }

.artifact-wrap { display: flex; flex-direction: column; background: #fff; border: 1px solid #E2E0D8; padding: 20px 0 0; }
.artifact-wrap .col-head { padding: 0 22px; }
.tag { font-size: 10px; padding: 2px 8px; color: #3B5BDB; border: 1px solid #C7CEE8; letter-spacing: 1px; }
.artifact-body { flex: 1; overflow: auto; padding: 8px 24px 22px; }
.placeholder { height: 100%; display: grid; place-content: center; justify-items: center; gap: 14px; color: #A8A69D; font-size: 12px; letter-spacing: 1px; }
.spinner { width: 36px; height: 36px; border: 2.5px solid #ECEAE3; border-top-color: #3B5BDB; animation: spin 1s linear infinite; }

.artifact { display: flex; flex-direction: column; }
.art-h { margin: 6px 0 14px; font-size: 20px; font-weight: 700; color: #141414; letter-spacing: -.3px; }
.summary { margin: 0 0 22px; font-size: 14px; line-height: 1.85; color: #3D3B35; }
.art-sub { margin: 6px 0 12px; font-size: 12.5px; font-weight: 600; color: #5C5A53; }
.art-sub .mono { color: #3B5BDB; margin-right: 6px; }
.art-table { width: 100%; border-collapse: collapse; font-size: 13px; margin-bottom: 24px; }
.art-table th { text-align: left; color: #ADABA2; font-weight: 500; padding: 9px 10px; border-bottom: 1px solid #1A1A1A; font-size: 11px; letter-spacing: .3px; }
.art-table td { padding: 10px 10px; border-bottom: 1px solid #F0EEE7; color: #45433D; }
.art-table tbody tr:last-child td { border-bottom: none; }
.art-table td.num { font-variant-numeric: tabular-nums; }
.art-table td.adv { color: #3B5BDB; font-weight: 600; }
.art-chart { height: 230px; width: 100%; }

@keyframes spin { to { transform: rotate(360deg); } }
@keyframes blink { 50% { opacity: 0; } }
.fade { opacity: 0; transform: translateY(10px); animation: fadeUp .6s cubic-bezier(.22,.61,.36,1) forwards; animation-delay: var(--d, 0ms); }
@keyframes fadeUp { to { opacity: 1; transform: none; } }
.rise-enter-active { transition: all .5s cubic-bezier(.22,.61,.36,1); }
.rise-enter-from { opacity: 0; transform: translateY(12px); }

@media (max-width: 768px) {
  .cols { grid-template-columns: 1fr; }
}
</style>
