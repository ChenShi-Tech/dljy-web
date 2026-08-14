<template>
  <div class="paper-root">
    <div class="page">
      <header class="topbar fade" style="--d: 0ms">
        <div class="brand">
          <span class="mark" />
          <div>
            <div class="eyebrow">NEURAL TRADING COPILOT</div>
            <h1>AI 分析助手</h1>
          </div>
        </div>
        <span class="hint">自然语言提问 · 直出分析与图表</span>
      </header>

      <div class="cols">
        <!-- chat -->
        <section class="chat fade" style="--d: 80ms">
          <div class="thread">
            <div v-if="showUser" class="msg user">
              <div class="bubble">分析山西现货市场次日价格走势,并给出关键时段交易建议。</div>
            </div>

            <div v-if="showAssistant" class="msg ai">
              <span class="avatar">✦</span>
              <div class="ai-body">
                <div class="steps">
                  <div v-for="(s, i) in steps" :key="s" class="step" :class="{ done: stepDone > i }">
                    <i class="ck">{{ stepDone > i ? '✓' : '·' }}</i>{{ s }}
                  </div>
                </div>
                <p class="stream">{{ streamed }}<span v-if="!streamDone" class="cursor">▍</span></p>
                <p v-if="streamDone" class="done-note">已在右侧生成分析报告 →</p>
              </div>
            </div>
          </div>

          <div class="composer">
            <div class="chips">
              <button v-for="c in aiChips" :key="c" class="chip">{{ c }}</button>
            </div>
            <div class="inputbar">
              <input placeholder="向 AI 提问,例如:复盘本周持仓收益…" />
              <button class="send" aria-label="send">↑</button>
            </div>
          </div>
        </section>

        <!-- artifact -->
        <section class="artifact-wrap fade" style="--d: 160ms">
          <div class="artifact-head">
            <div class="ah-left"><span class="doc-ico">▤</span><span>分析报告</span></div>
            <span v-if="showArtifact" class="tag">已生成</span>
          </div>

          <div class="artifact-body">
            <transition name="rise">
              <div v-if="showArtifact" class="artifact">
                <h2 class="serif art-h">山西现货次日价格分析</h2>
                <p class="summary">{{ aiAnalysisText }}</p>

                <h3 class="art-sub">{{ aiArtifactTable.title }}</h3>
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

                <h3 class="art-sub">次日 24h 价格预测曲线</h3>
                <div ref="chartEl" class="art-chart" />
              </div>
              <div v-else class="placeholder">
                <div class="spinner" />
                <p>正在分析数据并生成报告…</p>
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
      tooltip: { trigger: 'axis', backgroundColor: '#fff', borderColor: '#ECE8DF', borderWidth: 1, textStyle: { color: '#1F1D1A' }, extraCssText: 'box-shadow:0 6px 20px rgba(80,60,40,.1);border-radius:8px;' },
      legend: { data: ['日前预测', '实时预测'], textStyle: { color: '#7A746A' }, right: 4, top: 0, icon: 'roundRect', itemWidth: 12, itemHeight: 4 },
      xAxis: { type: 'category', data: hourLabels, axisLabel: { color: '#9A958C', fontSize: 10 }, axisTick: { show: false }, axisLine: { lineStyle: { color: '#E4E0D6' } } },
      yAxis: { type: 'value', axisLabel: { color: '#9A958C', fontSize: 10 }, splitLine: { lineStyle: { color: '#EFEDE7' } } },
      series: [
        { name: '日前预测', type: 'line', data: da, smooth: true, symbol: 'none', lineStyle: { color: '#C45B36', width: 2.2 },
          areaStyle: { color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [{ offset: 0, color: 'rgba(196,91,54,.10)' }, { offset: 1, color: 'rgba(196,91,54,0)' }]) } },
        { name: '实时预测', type: 'line', data: rt, smooth: true, symbol: 'none', lineStyle: { color: '#8A8378', width: 1.6, type: 'dashed' } },
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
.paper-root { position: fixed; inset: 0; overflow: auto; background: #FAF9F6;
  color: #1F1D1A; font-family: 'Inter', -apple-system, 'PingFang SC', 'Microsoft YaHei', sans-serif; -webkit-font-smoothing: antialiased; }
.serif { font-family: 'Source Serif 4', 'Source Serif Pro', Georgia, 'Songti SC', serif; }
.page { max-width: 1320px; margin: 0 auto; padding: 34px 36px 28px; display: flex; flex-direction: column; height: 100%; box-sizing: border-box; }

.topbar { display: flex; justify-content: space-between; align-items: flex-end; margin-bottom: 22px; }
.brand { display: flex; align-items: center; gap: 14px; }
.mark { width: 30px; height: 30px; border-radius: 9px; background: #C45B36; box-shadow: inset 0 0 0 4px rgba(255,255,255,.55); }
.eyebrow { font-size: 11px; letter-spacing: 2.5px; color: #A4998A; font-weight: 600; margin-bottom: 4px; }
.brand h1 { margin: 0; font-size: 25px; font-weight: 600; color: #211F1B; }
.hint { font-size: 13px; color: #9A958C; }

.cols { display: grid; grid-template-columns: 42% 1fr; gap: 20px; flex: 1; min-height: 0; }

/* chat */
.chat { display: flex; flex-direction: column; background: #FFFFFF; border: 1px solid #ECE8DF; border-radius: 16px; padding: 22px; }
.thread { flex: 1; overflow: auto; display: flex; flex-direction: column; gap: 18px; }
.msg.user { display: flex; justify-content: flex-end; }
.msg.user .bubble { max-width: 86%; background: #F1ECE3; border: 1px solid #E7E1D5; color: #2C2925; padding: 11px 15px; border-radius: 14px 14px 4px 14px; font-size: 14px; line-height: 1.6; }
.msg.ai { display: flex; gap: 12px; align-items: flex-start; }
.avatar { width: 30px; height: 30px; border-radius: 9px; flex: none; display: grid; place-items: center; background: #FBEEE7; color: #C45B36; font-size: 15px; border: 1px solid #F0DDD1; }
.ai-body { font-size: 14.5px; line-height: 1.75; color: #2C2925; padding-top: 2px; }
.steps { display: flex; flex-direction: column; gap: 5px; margin-bottom: 12px; }
.step { font-size: 12.5px; color: #A8A296; display: flex; align-items: center; gap: 8px; transition: color .3s; }
.step.done { color: #5B7355; }
.step .ck { font-style: normal; width: 13px; text-align: center; }
.stream { margin: 0; white-space: pre-wrap; }
.cursor { color: #C45B36; animation: blink 1s steps(2) infinite; }
.done-note { margin: 12px 0 0; font-size: 12.5px; color: #C45B36; }

.composer { margin-top: 18px; }
.chips { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 12px; }
.chip { font-size: 12.5px; padding: 7px 13px; border-radius: 999px; cursor: pointer; color: #6B6760; background: #F6F2EA; border: 1px solid #ECE6DB; font-family: inherit; transition: all .2s; }
.chip:hover { border-color: #DDD3C4; color: #3D3A34; }
.inputbar { display: flex; align-items: center; gap: 10px; border: 1px solid #E2DBCD; border-radius: 14px; padding: 8px 8px 8px 16px; background: #FCFBF8; }
.inputbar input { flex: 1; border: none; background: transparent; font-size: 14px; color: #2C2925; outline: none; font-family: inherit; }
.inputbar input::placeholder { color: #A8A296; }
.send { width: 34px; height: 34px; border-radius: 10px; border: none; cursor: pointer; background: #C45B36; color: #fff; font-size: 16px; flex: none; }

/* artifact */
.artifact-wrap { display: flex; flex-direction: column; background: #FFFFFF; border: 1px solid #ECE8DF; border-radius: 16px; overflow: hidden; }
.artifact-head { display: flex; justify-content: space-between; align-items: center; padding: 14px 20px; border-bottom: 1px solid #F0ECE3; background: #FCFBF8; }
.ah-left { display: flex; align-items: center; gap: 9px; font-size: 13.5px; color: #6B6760; font-weight: 500; }
.doc-ico { color: #C45B36; }
.tag { font-size: 11px; padding: 3px 10px; border-radius: 999px; color: #C45B36; background: rgba(196,91,54,.10); font-weight: 500; }
.artifact-body { flex: 1; overflow: auto; padding: 24px 26px; }
.placeholder { height: 100%; display: grid; place-content: center; justify-items: center; gap: 14px; color: #A8A296; font-size: 13px; }
.spinner { width: 38px; height: 38px; border-radius: 50%; border: 2.5px solid #EFEAE0; border-top-color: #C45B36; animation: spin 1s linear infinite; }

.artifact { display: flex; flex-direction: column; }
.art-h { margin: 0 0 14px; font-size: 22px; font-weight: 600; color: #211F1B; letter-spacing: .2px; }
.summary { margin: 0 0 22px; font-size: 14.5px; line-height: 1.85; color: #3D3A34; }
.art-sub { margin: 6px 0 12px; font-size: 13px; font-weight: 600; color: #6B6760; }
.art-table { width: 100%; border-collapse: collapse; font-size: 13px; margin-bottom: 24px; }
.art-table th { text-align: left; color: #A4998A; font-weight: 500; padding: 9px 10px; border-bottom: 1px solid #E7E1D5; font-size: 12px; }
.art-table td { padding: 10px 10px; border-bottom: 1px solid #F4F1EA; color: #4A463F; }
.art-table tbody tr:last-child td { border-bottom: none; }
.art-table td.num { font-variant-numeric: tabular-nums; }
.art-table td.adv { color: #C45B36; font-weight: 600; }
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
