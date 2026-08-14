<template>
  <div class="neon-root">
    <div class="blob b1" />
    <div class="blob b2" />
    <div class="grid-overlay" />

    <div class="ai-wrap">
      <header class="topbar">
        <div class="brand">
          <div class="logo">✦</div>
          <div>
            <h1>AI 分析驾驶舱</h1>
            <p>NEURAL TRADING COPILOT · 自然语言直出分析</p>
          </div>
        </div>
        <span class="tag">霓虹暗色 · NEON</span>
      </header>

      <div class="cols">
        <!-- chat column -->
        <section class="card chat">
          <div class="thread">
            <div v-if="showUser" class="msg user fade">
              <div class="bubble">分析山西现货市场次日价格走势,并给出关键时段交易建议。</div>
              <div class="avatar u">我</div>
            </div>

            <div v-if="showAssistant" class="msg ai fade">
              <div class="avatar a">AI</div>
              <div class="bubble ai-bubble">
                <div class="steps">
                  <div v-for="(s, i) in steps" :key="s" class="step" :class="{ done: stepDone > i }">
                    <i class="ck">{{ stepDone > i ? '✓' : '◐' }}</i>{{ s }}
                  </div>
                </div>
                <p class="stream">{{ streamed }}<span v-if="!streamDone" class="cursor">▋</span></p>
              </div>
            </div>
          </div>

          <div class="composer">
            <div class="chips">
              <button v-for="c in aiChips" :key="c" class="chip">{{ c }}</button>
            </div>
            <div class="inputbar">
              <input placeholder="向 AI 提问,例如:复盘本周持仓收益…" />
              <button class="send">发送 ➤</button>
            </div>
          </div>
        </section>

        <!-- artifact canvas -->
        <section class="card canvas">
          <div class="canvas-head">
            <h2>{{ showArtifact ? 'AI 生成 · 分析报告' : '分析画布' }}</h2>
            <span v-if="showArtifact" class="badge">GENERATED</span>
          </div>

          <transition name="rise">
            <div v-if="showArtifact" class="artifact">
              <p class="summary">{{ aiAnalysisText }}</p>

              <h3 class="art-title">{{ aiArtifactTable.title }}</h3>
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

              <h3 class="art-title">次日 24h 价格预测曲线</h3>
              <div ref="chartEl" class="art-chart" />
            </div>
            <div v-else class="placeholder">
              <div class="spinner" />
              <p>AI 正在分析数据并生成报告…</p>
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
const steps = ['解析意图 · 锁定指标', '查询现货/负荷/新能源数据', '回归建模 · 价格预测', '生成分析报告与图表']
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
      grid: { left: 46, right: 16, top: 22, bottom: 28 },
      tooltip: { trigger: 'axis', backgroundColor: 'rgba(8,12,24,.92)', borderColor: '#22d3ee', textStyle: { color: '#cde9ff' } },
      legend: { data: ['日前预测', '实时预测'], textStyle: { color: '#9bb6dd' }, right: 8, top: 0 },
      xAxis: { type: 'category', data: hourLabels, axisLabel: { color: '#7fa8d6', fontSize: 10 }, axisLine: { lineStyle: { color: 'rgba(120,160,220,.35)' } } },
      yAxis: { type: 'value', name: '元/MWh', nameTextStyle: { color: '#7fa8d6' }, axisLabel: { color: '#7fa8d6' }, splitLine: { lineStyle: { color: 'rgba(90,120,180,.14)' } } },
      series: [
        { name: '日前预测', type: 'line', data: da, smooth: true, symbol: 'none', lineStyle: { color: '#22d3ee', width: 2.4, shadowColor: '#22d3ee', shadowBlur: 12 },
          areaStyle: { color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [{ offset: 0, color: 'rgba(34,211,238,.4)' }, { offset: 1, color: 'rgba(34,211,238,0)' }]) } },
        { name: '实时预测', type: 'line', data: rt, smooth: true, symbol: 'none', lineStyle: { color: '#e879f9', width: 2.4, shadowColor: '#e879f9', shadowBlur: 12 } },
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
.neon-root {
  position: fixed; inset: 0; overflow: auto;
  background: radial-gradient(1200px 700px at 80% -10%, #122046 0%, #060914 55%), #04060f;
  color: #e6f0ff; font-family: 'Inter', -apple-system, 'PingFang SC', sans-serif;
}
.blob { position: fixed; border-radius: 50%; filter: blur(90px); opacity: .5; pointer-events: none; z-index: 0; }
.b1 { width: 480px; height: 480px; background: #6d5cff; top: -140px; right: -60px; }
.b2 { width: 420px; height: 420px; background: #00d4ff; bottom: -160px; left: -80px; opacity: .4; }
.grid-overlay { position: fixed; inset: 0; z-index: 0; pointer-events: none;
  background-image: linear-gradient(rgba(70,120,200,.06) 1px, transparent 1px), linear-gradient(90deg, rgba(70,120,200,.06) 1px, transparent 1px); background-size: 44px 44px; }

.ai-wrap { position: relative; z-index: 1; min-height: 100%; padding: 22px 26px 26px; display: flex; flex-direction: column; gap: 16px; }
.topbar { display: flex; justify-content: space-between; align-items: center; }
.brand { display: flex; align-items: center; gap: 14px; }
.logo { width: 48px; height: 48px; border-radius: 14px; display: grid; place-items: center; font-size: 24px; background: linear-gradient(135deg, #e879f9, #6d5cff); box-shadow: 0 0 26px rgba(168,85,247,.6); }
.brand h1 { margin: 0; font-size: 22px; letter-spacing: 1px; background: linear-gradient(90deg, #eed6ff, #9fb8ff); -webkit-background-clip: text; background-clip: text; color: transparent; }
.brand p { margin: 3px 0 0; font-size: 11px; color: #6d8fc0; letter-spacing: 2px; }
.tag { padding: 4px 10px; border-radius: 999px; font-size: 11px; color: #e879f9; border: 1px solid rgba(232,121,249,.4); background: rgba(232,121,249,.08); }

.cols { display: grid; grid-template-columns: 38% 1fr; gap: 16px; flex: 1; min-height: 0; }
.card { position: relative; border-radius: 16px; padding: 18px;
  background: linear-gradient(160deg, rgba(20,30,56,.72), rgba(10,16,34,.66));
  border: 1px solid rgba(90,130,200,.22);
  box-shadow: 0 10px 30px rgba(0,0,0,.4), inset 0 1px 0 rgba(255,255,255,.05); backdrop-filter: blur(8px); }
.card::before { content: ''; position: absolute; inset: 0; border-radius: 16px; padding: 1px; pointer-events: none;
  background: linear-gradient(120deg, rgba(34,211,238,.7), rgba(232,121,249,.5), transparent 60%);
  -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0); -webkit-mask-composite: xor; mask-composite: exclude; opacity: .5; }

.chat { display: flex; flex-direction: column; }
.thread { flex: 1; overflow: auto; display: flex; flex-direction: column; gap: 16px; padding-right: 4px; }
.msg { display: flex; gap: 10px; align-items: flex-start; }
.msg.user { flex-direction: row-reverse; }
.avatar { width: 34px; height: 34px; border-radius: 10px; display: grid; place-items: center; font-size: 12px; font-weight: 700; flex: none; }
.avatar.u { background: rgba(34,211,238,.16); color: #67e8f9; border: 1px solid rgba(34,211,238,.4); }
.avatar.a { background: linear-gradient(135deg, #e879f9, #6d5cff); color: #fff; }
.bubble { max-width: 90%; padding: 12px 14px; border-radius: 14px; font-size: 14px; line-height: 1.65; }
.msg.user .bubble { background: rgba(34,211,238,.12); border: 1px solid rgba(34,211,238,.28); color: #d6f3ff; border-top-right-radius: 4px; }
.ai-bubble { background: rgba(15,22,44,.85); border: 1px solid rgba(120,90,220,.3); color: #dbe6ff; border-top-left-radius: 4px; }
.steps { display: flex; flex-direction: column; gap: 6px; margin-bottom: 10px; padding-bottom: 10px; border-bottom: 1px dashed rgba(120,140,200,.2); }
.step { font-size: 12px; color: #6f86b3; display: flex; align-items: center; gap: 7px; transition: color .3s; }
.step.done { color: #a3e635; }
.step .ck { font-style: normal; width: 14px; }
.stream { margin: 0; white-space: pre-wrap; }
.cursor { color: #22d3ee; animation: blink 1s steps(2) infinite; }

.composer { margin-top: 14px; }
.chips { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 10px; }
.chip { font-size: 12px; padding: 6px 11px; border-radius: 999px; cursor: pointer;
  background: rgba(34,211,238,.08); border: 1px solid rgba(34,211,238,.28); color: #8fd6e6; }
.inputbar { display: flex; gap: 10px; }
.inputbar input { flex: 1; background: rgba(8,14,30,.8); border: 1px solid rgba(90,130,200,.3); border-radius: 12px; padding: 12px 14px; color: #e6f0ff; font-size: 14px; outline: none; }
.inputbar input::placeholder { color: #5e789f; }
.send { padding: 0 18px; border-radius: 12px; border: none; cursor: pointer; font-weight: 600; color: #04121a;
  background: linear-gradient(135deg, #22d3ee, #34d399); box-shadow: 0 0 18px rgba(34,211,238,.5); }

.canvas { display: flex; flex-direction: column; overflow: auto; }
.canvas-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
.canvas-head h2 { margin: 0; font-size: 16px; color: #cfe2ff; }
.badge { font-size: 11px; padding: 3px 10px; border-radius: 999px; color: #04121a; font-weight: 700; background: linear-gradient(135deg, #a3e635, #22d3ee); }
.placeholder { flex: 1; display: grid; place-content: center; justify-items: center; gap: 16px; color: #6f86b3; }
.spinner { width: 46px; height: 46px; border-radius: 50%; border: 3px solid rgba(34,211,238,.2); border-top-color: #22d3ee; animation: spin 1s linear infinite; }

.artifact { display: flex; flex-direction: column; gap: 14px; }
.summary { margin: 0; font-size: 14px; line-height: 1.8; color: #d3e2fb; padding: 14px; border-radius: 12px;
  background: rgba(12,20,42,.7); border-left: 3px solid #22d3ee; }
.art-title { margin: 4px 0 2px; font-size: 14px; color: #9fd0ff; }
.art-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.art-table th { text-align: left; color: #7e9bc6; font-weight: 500; padding: 9px 8px; border-bottom: 1px solid rgba(90,130,200,.25); background: rgba(20,30,56,.5); }
.art-table td { padding: 9px 8px; border-bottom: 1px solid rgba(90,130,200,.1); color: #d6e4fb; }
.art-table td.num { font-variant-numeric: tabular-nums; }
.art-table td.adv { color: #a3e635; font-weight: 600; }
.art-chart { height: 240px; width: 100%; }

@keyframes spin { to { transform: rotate(360deg); } }
@keyframes blink { 50% { opacity: 0; } }
.fade { animation: fadeUp .5s ease; }
@keyframes fadeUp { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: none; } }
.rise-enter-active { transition: all .5s ease; }
.rise-enter-from { opacity: 0; transform: translateY(16px); }

@media (max-width: 768px) {
  .cols { grid-template-columns: 1fr; }
}
</style>
