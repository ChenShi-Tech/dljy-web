<template>
  <div class="hud-root">
    <div class="scanlines" />
    <div class="sweep" />
    <div class="vignette" />

    <div class="ai-wrap">
      <header class="topbar">
        <div class="prompt">
          <span class="user">root@dljy-ai</span><span class="path">:~$</span>
          <span class="cmd"> ./copilot --analyze --province=SX</span><span class="cur">█</span>
        </div>
        <span class="modetag">[ HUD_TERMINAL ]</span>
      </header>

      <div class="cols">
        <section class="hud-card chat">
          <div class="chan-head">▣ AI_COPILOT <span class="dim">// NEURAL_TRADING_AGENT</span></div>
          <div class="thread">
            <div v-if="showUser" class="line user fade"><span class="tag-u">USER&gt;</span> 分析山西现货市场次日价格走势,并给出关键时段交易建议。</div>

            <div v-if="showAssistant" class="ai-block fade">
              <div class="steps">
                <div v-for="(s, i) in steps" :key="s" class="step" :class="{ done: stepDone > i }">
                  <span class="br">[{{ stepDone > i ? 'OK' : '..' }}]</span> {{ s }}
                </div>
              </div>
              <div class="line ai"><span class="tag-a">AI&gt;</span> <span class="stream">{{ streamed }}</span><span v-if="!streamDone" class="cur">█</span></div>
            </div>
          </div>

          <div class="composer">
            <div class="chips">
              <button v-for="c in aiChips" :key="c" class="chip">{{ c }}</button>
            </div>
            <div class="inputbar">
              <span class="ip">&gt;</span>
              <input placeholder="输入指令,例如: 复盘本周持仓收益" />
              <button class="send">RUN ⏎</button>
            </div>
          </div>
        </section>

        <section class="hud-card canvas">
          <div class="canvas-head">
            <h3>▣ {{ showArtifact ? 'ANALYSIS_REPORT' : 'OUTPUT_BUFFER' }} <span class="dim">// stdout</span></h3>
            <span v-if="showArtifact" class="badge">[ GENERATED ]</span>
          </div>

          <transition name="rise">
            <div v-if="showArtifact" class="artifact">
              <p class="summary">{{ aiAnalysisText }}</p>
              <div class="art-title">▸ {{ aiArtifactTable.title }}</div>
              <table class="art-table">
                <thead>
                  <tr><th v-for="c in aiArtifactTable.columns" :key="c">{{ c }}</th></tr>
                </thead>
                <tbody>
                  <tr v-for="(r, ri) in aiArtifactTable.rows" :key="ri">
                    <td v-for="(cell, ci) in r" :key="ci" :class="{ adv: ci === 4, num: ci > 0 && ci < 4 }">{{ cell }}</td>
                  </tr>
                </tbody>
              </table>
              <div class="art-title">▸ 次日 24h 价格预测曲线 // FORECAST</div>
              <div ref="chartEl" class="art-chart" />
            </div>
            <div v-else class="placeholder">
              <pre class="boot">[ booting neural engine ]
[ loading market tensors ... ]
&gt; analyzing<span class="cur">█</span></pre>
            </div>
          </transition>
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
const steps = ['parse_intent → lock_metrics', 'query spot/load/renewable', 'regress → price_forecast', 'render report + charts']
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
    const GREEN = '#00ff9c', AMBER = '#ffb000', AX = 'rgba(0,255,156,.55)'
    chart.setOption({
      grid: { left: 46, right: 16, top: 22, bottom: 28 },
      tooltip: { trigger: 'axis', backgroundColor: 'rgba(0,12,8,.95)', borderColor: GREEN, textStyle: { color: GREEN, fontFamily: 'monospace' } },
      legend: { data: ['DAY_AHEAD', 'REALTIME'], textStyle: { color: AX, fontFamily: 'monospace' }, right: 8, top: 0 },
      xAxis: { type: 'category', data: hourLabels, axisLabel: { color: AX, fontSize: 10, fontFamily: 'monospace' }, axisLine: { lineStyle: { color: 'rgba(0,255,156,.4)' } } },
      yAxis: { type: 'value', axisLabel: { color: AX, fontFamily: 'monospace' }, splitLine: { lineStyle: { color: 'rgba(0,255,156,.1)', type: 'dashed' } } },
      series: [
        { name: 'DAY_AHEAD', type: 'line', data: da, smooth: false, symbol: 'none', lineStyle: { color: GREEN, width: 1.8, shadowColor: GREEN, shadowBlur: 8 },
          areaStyle: { color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [{ offset: 0, color: 'rgba(0,255,156,.22)' }, { offset: 1, color: 'rgba(0,255,156,0)' }]) } },
        { name: 'REALTIME', type: 'line', data: rt, smooth: false, symbol: 'none', lineStyle: { color: AMBER, width: 1.6, type: 'dashed' } },
      ],
    })
  })
}

onMounted(() => {
  T(() => (showUser.value = true), 150)
  T(() => (showAssistant.value = true), 380)
  T(() => (stepDone.value = 1), 520)
  T(() => (stepDone.value = 2), 760)
  T(() => (stepDone.value = 3), 1000)
  T(() => { stepDone.value = 4; streamText() }, 1240)
})
onBeforeUnmount(() => { timers.forEach(clearTimeout); chart?.dispose() })
</script>

<style scoped>
.hud-root { position: fixed; inset: 0; overflow: auto; background-color: #020603;
  color: #00ff9c; font-family: 'JetBrains Mono', 'SF Mono', Menlo, Consolas, monospace; }
.scanlines { position: fixed; inset: 0; z-index: 5; pointer-events: none;
  background: repeating-linear-gradient(0deg, rgba(0,0,0,0) 0px, rgba(0,0,0,0) 2px, rgba(0,40,25,.35) 3px); opacity: .5; }
.sweep { position: fixed; left: 0; right: 0; height: 120px; z-index: 4; pointer-events: none;
  background: linear-gradient(180deg, rgba(0,255,156,0), rgba(0,255,156,.08), rgba(0,255,156,0)); animation: sweep 6s linear infinite; }
.vignette { position: fixed; inset: 0; z-index: 1; pointer-events: none;
  background: radial-gradient(120% 90% at 50% 40%, rgba(0,0,0,0) 55%, rgba(0,0,0,.6) 100%),
    linear-gradient(rgba(0,255,156,.025) 1px, transparent 1px), linear-gradient(90deg, rgba(0,255,156,.025) 1px, transparent 1px);
  background-size: 100% 100%, 40px 40px, 40px 40px; }

.ai-wrap { position: relative; z-index: 2; min-height: 100%; padding: 18px 22px 24px; display: flex; flex-direction: column; gap: 14px; }
.topbar { display: flex; justify-content: space-between; align-items: center; border: 1px solid rgba(0,255,156,.25); padding: 10px 14px; background: rgba(0,20,12,.4); }
.prompt { font-size: var(--font-lg); }
.prompt .user { color: #00ff9c; } .prompt .path { color: #5af; } .prompt .cmd { color: #cfffe9; }
.cur { color: #00ff9c; animation: blink 1s steps(2) infinite; }
.modetag { color: #ffb000; font-size: var(--font-sm); }
.dim { color: rgba(0,255,156,.45); font-weight: 400; }

.cols { display: grid; grid-template-columns: 40% 1fr; gap: 14px; flex: 1; min-height: 0; }
.hud-card { position: relative; padding: 14px 16px; background: rgba(0,22,13,.55);
  border: 1px solid rgba(0,255,156,.26); box-shadow: inset 0 0 24px rgba(0,255,156,.05); }
.hud-card::before, .hud-card::after { content: ''; position: absolute; width: 12px; height: 12px; pointer-events: none; }
.hud-card::before { top: -1px; left: -1px; border-top: 2px solid #00ff9c; border-left: 2px solid #00ff9c; }
.hud-card::after { bottom: -1px; right: -1px; border-bottom: 2px solid #00ff9c; border-right: 2px solid #00ff9c; }

.chat { display: flex; flex-direction: column; }
.chan-head { font-size: var(--font-md); color: #00ff9c; margin-bottom: 10px; }
.thread { flex: 1; overflow: auto; display: flex; flex-direction: column; gap: 12px; font-size: var(--font-md); line-height: 1.7; }
.line { white-space: pre-wrap; }
.tag-u { color: #5af; } .tag-a { color: #ffb000; }
.line.user { color: #cfffe9; }
.line.ai { color: #bfffe6; }
.steps { display: flex; flex-direction: column; gap: 4px; margin-bottom: 8px; padding: 8px 10px; border: 1px dashed rgba(0,255,156,.25); background: rgba(0,255,156,.03); }
.step { font-size: var(--font-sm); color: rgba(0,255,156,.45); transition: color .3s; }
.step.done { color: #00ff9c; }
.step .br { color: rgba(0,255,156,.4); }
.step.done .br { color: #00ff9c; }
.stream { color: #bfffe6; }

.composer { margin-top: 12px; }
.chips { display: flex; flex-wrap: wrap; gap: 7px; margin-bottom: 10px; }
.chip { font-size: var(--font-xs); padding: 5px 10px; cursor: pointer; color: #00ff9c; background: rgba(0,255,156,.06); border: 1px solid rgba(0,255,156,.3); }
.inputbar { display: flex; align-items: center; gap: 8px; border: 1px solid rgba(0,255,156,.35); padding: 8px 12px; background: rgba(0,0,0,.4); }
.inputbar .ip { color: #00ff9c; }
.inputbar input { flex: 1; background: transparent; border: none; color: #cfffe9; font-size: var(--font-md); outline: none; font-family: inherit; }
.inputbar input::placeholder { color: rgba(0,255,156,.4); }
.send { padding: 5px 12px; border: 1px solid #00ff9c; cursor: pointer; font-weight: 600; color: #020603; background: #00ff9c; font-family: inherit; }

.canvas { display: flex; flex-direction: column; overflow: auto; }
.canvas-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
.canvas-head h3 { margin: 0; font-size: var(--font-md); color: #00ff9c; }
.badge { font-size: var(--font-xs); padding: 2px 9px; color: #020603; font-weight: 700; background: #ffb000; }
.placeholder { flex: 1; display: grid; place-content: center; }
.boot { color: rgba(0,255,156,.7); font-size: var(--font-md); line-height: 1.8; }

.artifact { display: flex; flex-direction: column; gap: 12px; }
.summary { margin: 0; font-size: var(--font-md); line-height: 1.85; color: #cfffe9; padding: 12px; border-left: 2px solid #00ff9c; background: rgba(0,255,156,.04); }
.art-title { font-size: var(--font-sm); color: #ffb000; }
.art-table { width: 100%; border-collapse: collapse; font-size: var(--font-sm); }
.art-table th { text-align: left; color: rgba(0,255,156,.55); font-weight: 500; padding: 8px; border-bottom: 1px solid rgba(0,255,156,.3); background: rgba(0,255,156,.05); }
.art-table td { padding: 8px; border-bottom: 1px solid rgba(0,255,156,.12); color: #bfffe6; }
.art-table td.num { color: #cfffe9; }
.art-table td.adv { color: #ffb000; font-weight: 600; }
.art-chart { height: 240px; width: 100%; }

@keyframes blink { 50% { opacity: 0; } }
@keyframes sweep { 0% { top: -120px; } 100% { top: 100%; } }
.fade { animation: fadeUp .5s ease; }
@keyframes fadeUp { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: none; } }
.rise-enter-active { transition: all .4s ease; }
.rise-enter-from { opacity: 0; transform: translateY(14px); }

@media (max-width: 768px) {
  .cols { grid-template-columns: 1fr; }
}
</style>
