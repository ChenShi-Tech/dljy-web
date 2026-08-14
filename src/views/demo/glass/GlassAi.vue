<template>
  <div class="glass-root">
    <div class="aurora a1" />
    <div class="aurora a2" />
    <div class="aurora a3" />
    <div class="noise" />

    <div class="ai-wrap">
      <header class="topbar">
        <div class="brand">
          <div class="logo">✦</div>
          <div>
            <h1>AI 分析驾驶舱</h1>
            <p>NEURAL TRADING COPILOT · 自然语言直出分析</p>
          </div>
        </div>
        <span class="tag">玻璃拟态 · AURORA</span>
      </header>

      <div class="cols">
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
      tooltip: { trigger: 'axis', backgroundColor: 'rgba(40,30,70,.82)', borderColor: 'rgba(255,255,255,.25)', textStyle: { color: '#fff' } },
      legend: { data: ['日前预测', '实时预测'], textStyle: { color: 'rgba(255,255,255,.8)' }, right: 8, top: 0 },
      xAxis: { type: 'category', data: hourLabels, axisLabel: { color: 'rgba(255,255,255,.66)', fontSize: 10 }, axisLine: { lineStyle: { color: 'rgba(255,255,255,.3)' } } },
      yAxis: { type: 'value', name: '元/MWh', nameTextStyle: { color: 'rgba(255,255,255,.66)' }, axisLabel: { color: 'rgba(255,255,255,.66)' }, splitLine: { lineStyle: { color: 'rgba(255,255,255,.12)' } } },
      series: [
        { name: '日前预测', type: 'line', data: da, smooth: true, symbol: 'none', lineStyle: { color: '#c4b5fd', width: 2.6 },
          areaStyle: { color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [{ offset: 0, color: 'rgba(167,139,250,.5)' }, { offset: 1, color: 'rgba(167,139,250,0)' }]) } },
        { name: '实时预测', type: 'line', data: rt, smooth: true, symbol: 'none', lineStyle: { color: '#5eead4', width: 2.6 } },
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
.glass-root { position: fixed; inset: 0; overflow: auto;
  background: linear-gradient(135deg, #1e1b4b 0%, #312e81 38%, #1e3a5f 72%, #155e75 100%);
  color: #fff; font-family: 'Inter', -apple-system, 'PingFang SC', sans-serif; }
.aurora { position: fixed; border-radius: 50%; filter: blur(80px); opacity: .7; pointer-events: none; z-index: 0; }
.a1 { width: 520px; height: 520px; background: #a855f7; top: -160px; right: -60px; animation: drift1 16s ease-in-out infinite; }
.a2 { width: 460px; height: 460px; background: #22d3ee; left: -120px; top: 80px; opacity: .6; animation: drift2 19s ease-in-out infinite; }
.a3 { width: 420px; height: 420px; background: #34d399; bottom: -180px; left: 40%; opacity: .5; animation: drift1 22s ease-in-out infinite reverse; }
.noise { position: fixed; inset: 0; z-index: 0; pointer-events: none; opacity: .04; background-image: radial-gradient(rgba(255,255,255,.8) 1px, transparent 1px); background-size: 4px 4px; }

.ai-wrap { position: relative; z-index: 1; min-height: 100%; padding: 22px 26px 26px; display: flex; flex-direction: column; gap: 16px; }
.topbar { display: flex; justify-content: space-between; align-items: center; }
.brand { display: flex; align-items: center; gap: 14px; }
.logo { width: 48px; height: 48px; border-radius: 15px; display: grid; place-items: center; font-size: 24px;
  background: linear-gradient(135deg, rgba(255,255,255,.4), rgba(255,255,255,.08)); border: 1px solid rgba(255,255,255,.4); backdrop-filter: blur(10px); }
.brand h1 { margin: 0; font-size: 22px; letter-spacing: 1px; color: #fff; text-shadow: 0 2px 14px rgba(0,0,0,.3); }
.brand p { margin: 3px 0 0; font-size: 11px; color: rgba(255,255,255,.7); letter-spacing: 2px; }
.tag { padding: 5px 12px; border-radius: 999px; font-size: 11px; color: #fff; border: 1px solid rgba(255,255,255,.35); background: rgba(255,255,255,.14); backdrop-filter: blur(8px); }

.cols { display: grid; grid-template-columns: 38% 1fr; gap: 16px; flex: 1; min-height: 0; }
.card { position: relative; border-radius: 20px; padding: 18px;
  background: rgba(255,255,255,.10); border: 1px solid rgba(255,255,255,.22);
  box-shadow: 0 12px 40px rgba(20,10,50,.28), inset 0 1px 0 rgba(255,255,255,.35);
  backdrop-filter: blur(22px) saturate(140%); -webkit-backdrop-filter: blur(22px) saturate(140%); }

.chat { display: flex; flex-direction: column; }
.thread { flex: 1; overflow: auto; display: flex; flex-direction: column; gap: 16px; padding-right: 4px; }
.msg { display: flex; gap: 10px; align-items: flex-start; }
.msg.user { flex-direction: row-reverse; }
.avatar { width: 34px; height: 34px; border-radius: 11px; display: grid; place-items: center; font-size: 12px; font-weight: 700; flex: none; }
.avatar.u { background: rgba(255,255,255,.2); color: #fff; border: 1px solid rgba(255,255,255,.4); }
.avatar.a { background: linear-gradient(135deg, #a855f7, #22d3ee); color: #fff; }
.bubble { max-width: 90%; padding: 12px 14px; border-radius: 16px; font-size: 14px; line-height: 1.65; }
.msg.user .bubble { background: rgba(255,255,255,.18); border: 1px solid rgba(255,255,255,.3); color: #fff; border-top-right-radius: 5px; }
.ai-bubble { background: rgba(255,255,255,.12); border: 1px solid rgba(255,255,255,.24); color: #fff; border-top-left-radius: 5px; }
.steps { display: flex; flex-direction: column; gap: 6px; margin-bottom: 10px; padding-bottom: 10px; border-bottom: 1px dashed rgba(255,255,255,.25); }
.step { font-size: 12px; color: rgba(255,255,255,.6); display: flex; align-items: center; gap: 7px; transition: color .3s; }
.step.done { color: #6ee7b7; }
.step .ck { font-style: normal; width: 14px; }
.stream { margin: 0; white-space: pre-wrap; color: rgba(255,255,255,.95); }
.cursor { color: #5eead4; animation: blink 1s steps(2) infinite; }

.composer { margin-top: 14px; }
.chips { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 10px; }
.chip { font-size: 12px; padding: 7px 12px; border-radius: 999px; cursor: pointer; color: #fff;
  background: rgba(255,255,255,.12); border: 1px solid rgba(255,255,255,.28); backdrop-filter: blur(8px); }
.inputbar { display: flex; gap: 10px; }
.inputbar input { flex: 1; background: rgba(255,255,255,.12); border: 1px solid rgba(255,255,255,.3); border-radius: 14px; padding: 12px 14px; color: #fff; font-size: 14px; outline: none; }
.inputbar input::placeholder { color: rgba(255,255,255,.55); }
.send { padding: 0 18px; border-radius: 14px; border: none; cursor: pointer; font-weight: 600; color: #fff;
  background: linear-gradient(135deg, #a855f7, #22d3ee); box-shadow: 0 6px 18px rgba(168,85,247,.4); }

.canvas { display: flex; flex-direction: column; overflow: auto; }
.canvas-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
.canvas-head h2 { margin: 0; font-size: 16px; color: #fff; }
.badge { font-size: 11px; padding: 4px 11px; border-radius: 999px; color: #1e1b4b; font-weight: 700; background: linear-gradient(135deg, #5eead4, #c4b5fd); }
.placeholder { flex: 1; display: grid; place-content: center; justify-items: center; gap: 16px; color: rgba(255,255,255,.7); }
.spinner { width: 46px; height: 46px; border-radius: 50%; border: 3px solid rgba(255,255,255,.25); border-top-color: #fff; animation: spin 1s linear infinite; }

.artifact { display: flex; flex-direction: column; gap: 14px; }
.summary { margin: 0; font-size: 14px; line-height: 1.8; color: #fff; padding: 14px; border-radius: 14px;
  background: rgba(255,255,255,.1); border-left: 3px solid #5eead4; }
.art-title { margin: 4px 0 2px; font-size: 14px; color: rgba(255,255,255,.92); }
.art-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.art-table th { text-align: left; color: rgba(255,255,255,.66); font-weight: 500; padding: 9px 8px; border-bottom: 1px solid rgba(255,255,255,.25); background: rgba(255,255,255,.06); }
.art-table td { padding: 9px 8px; border-bottom: 1px solid rgba(255,255,255,.12); color: rgba(255,255,255,.92); }
.art-table td.num { font-variant-numeric: tabular-nums; }
.art-table td.adv { color: #6ee7b7; font-weight: 600; }
.art-chart { height: 240px; width: 100%; }

@keyframes spin { to { transform: rotate(360deg); } }
@keyframes blink { 50% { opacity: 0; } }
@keyframes drift1 { 0%,100% { transform: translate(0,0); } 50% { transform: translate(60px, 40px); } }
@keyframes drift2 { 0%,100% { transform: translate(0,0); } 50% { transform: translate(-50px, 50px); } }
.fade { animation: fadeUp .5s ease; }
@keyframes fadeUp { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: none; } }
.rise-enter-active { transition: all .5s ease; }
.rise-enter-from { opacity: 0; transform: translateY(16px); }

@media (max-width: 768px) {
  .cols { grid-template-columns: 1fr; }
}
</style>
