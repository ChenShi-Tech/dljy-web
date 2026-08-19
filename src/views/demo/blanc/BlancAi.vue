<template>
  <div class="bl-root">
    <div class="glow" />

    <div class="ai-page">
      <header class="bar fade">
        <span class="tag">问</span>
        <input
          class="task-in"
          v-model="task"
          :disabled="busy"
          placeholder="提一道命题,中枢将延请众智能体共参(回车)…"
          @keydown.enter="startMission()"
        />
        <button class="run" :disabled="busy || !task.trim()" @click="startMission()">
          {{ busy ? '推演中' : '请教' }}
        </button>
      </header>

      <div class="stage">
        <section class="card loom">
          <div class="loom-head">
            <h3>智能体协同</h3>
            <span class="meta">
              <span v-if="plan" class="live" :class="{ on: plan.live }">{{ plan.live ? '实时' : '示例' }}</span>
              <template v-if="phase === 'running' || phase === 'done'">{{ doneCount }} / {{ nAgents }} · {{ phase === 'done' ? '已成' : '协同中' }}</template>
              <template v-else-if="phase === 'planning'">中枢延请中…</template>
            </span>
          </div>

          <div class="constellation">
            <svg v-if="nAgents" class="wires" viewBox="0 0 100 100" preserveAspectRatio="none">
              <path v-for="(a, i) in agents" :key="i" :d="wire(i, nAgents)" class="link" :class="linkCls(i)" />
            </svg>

            <div class="node core" :class="orchState" :style="{ left: '50%', top: '14%' }">
              <div class="tile"><span class="ripple" /><span class="ch">枢</span></div>
              <div class="nlabel">中枢<i>Orchestrator</i></div>
            </div>

            <div v-for="(a, i) in agents" :key="a.name + i" class="node" :class="states[i]" :style="nodeStyle(i)">
              <div class="tile"><span class="ripple" /><span class="ch">{{ a.char }}</span><i class="tick">✓</i></div>
              <div class="nlabel">{{ a.name }}<i>{{ a.role }}</i></div>
            </div>

            <div v-if="phase === 'idle'" class="hint">
              <p>提一道命题,中枢将延请众智能体共参</p>
              <div class="presets">
                <button v-for="p in PRESET_TASKS" :key="p" @click="startMission(p)">{{ p }}</button>
              </div>
            </div>
          </div>

          <div class="legend">
            <span class="lg"><i class="d idle" />待命</span>
            <span class="lg"><i class="d work" />运算</span>
            <span class="lg"><i class="d done" />已成</span>
            <span class="tip">中枢循理派分 · 智能体数量随命题而变</span>
          </div>
        </section>

        <aside ref="scrollEl" class="card log">
          <div class="log-head">纪要</div>
          <transition-group name="rise" tag="div" class="rows">
            <div v-for="(m, i) in minutes" :key="i" class="row" :class="m.tone">
              <span class="who"><i class="mk">{{ m.char }}</i>{{ m.who }}</span>
              <p>{{ m.text }}</p>
            </div>
          </transition-group>

          <transition name="report">
            <div v-if="showReport && plan" class="report">
              <div class="rep-head">
                <span class="rep-kicker">结论{{ plan.live ? ' · 实时' : ' · 示例' }}</span>
                <h4>决策报告</h4>
              </div>
              <p class="rep-sum">{{ plan.report.summary }}</p>
              <div class="rep-sub">关键数据</div>
              <table class="rep-table">
                <thead><tr><th v-for="c in plan.report.columns" :key="c">{{ c }}</th></tr></thead>
                <tbody>
                  <tr v-for="(r, ri) in plan.report.rows" :key="ri">
                    <td v-for="(cell, ci) in r" :key="ci" :class="{ num: ci > 0 }">{{ cell }}</td>
                  </tr>
                </tbody>
              </table>
              <div class="rep-sub">次日 24h 价格预测</div>
              <div ref="repChart" class="rep-chart" />
              <div v-if="plan.report.conclusion" class="rep-conc">{{ plan.report.conclusion }}</div>
              <div class="sign"><span class="seal">瓷</span>本报告由 {{ nAgents }} 位智能体共参 · {{ stamp }}</div>
            </div>
          </transition>
        </aside>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, nextTick } from 'vue'
import * as echarts from 'echarts'
import { planMission, mockPlan, PRESET_TASKS, type MissionPlan, type Agent } from '../tiangong/orchestrator'
import { timeLabels, dayAhead, realtime } from '../mock'

const stamp = new Date().toLocaleDateString('zh-CN')
const task = ref(PRESET_TASKS[0])
const phase = ref<'idle' | 'planning' | 'running' | 'done'>('idle')
const plan = ref<MissionPlan | null>(null)
const states = ref<string[]>([])
const orchState = ref<'idle' | 'work' | 'done'>('idle')
const minutes = ref<{ char: string; who: string; text: string; tone: string }[]>([])
const showReport = ref(false)

const agents = computed<Agent[]>(() => plan.value?.agents ?? [])
const nAgents = computed(() => agents.value.length)
const doneCount = computed(() => states.value.filter((s) => s === 'done').length)
const busy = computed(() => phase.value === 'planning' || phase.value === 'running')
const nodeSize = computed(() => { const n = nAgents.value; return n > 8 ? 52 : n > 6 ? 58 : 66 })

function geo(i: number, n: number) {
  const cx = 50, cy = 14, Rx = 42, Ry = 60
  const alpha = Math.min(75, 26 + n * 5)
  const t = n <= 1 ? 0 : (i / (n - 1)) * 2 - 1
  const phi = (t * alpha * Math.PI) / 180
  return { x: cx + Rx * Math.sin(phi), y: cy + Ry * Math.cos(phi) }
}
function nodeStyle(i: number) {
  const p = geo(i, nAgents.value)
  return { left: p.x + '%', top: p.y + '%', '--ns': nodeSize.value + 'px' } as Record<string, string>
}
function wire(i: number, n: number) { const p = geo(i, n); return `M50 14 L${p.x} ${p.y}` }
const linkCls = (i: number) => (states.value[i] === 'work' ? 'flow' : states.value[i] === 'done' ? 'on' : '')

const scrollEl = ref<HTMLElement>()
const repChart = ref<HTMLElement>()
let chart: echarts.ECharts | null = null
const timers: number[] = []
const T = (fn: () => void, ms: number) => timers.push(window.setTimeout(fn, ms))
function clearTimers() { timers.forEach(clearTimeout); timers.length = 0 }
function scrollDown() { nextTick(() => { if (scrollEl.value) scrollEl.value.scrollTop = scrollEl.value.scrollHeight }) }

async function startMission(t?: string, forceMock = false) {
  const q = (t ?? task.value).trim()
  if (!q || busy.value) return
  task.value = q
  clearTimers(); chart?.dispose(); chart = null
  plan.value = null; states.value = []; minutes.value = []; showReport.value = false
  orchState.value = 'work'; phase.value = 'planning'
  minutes.value.push({ char: '枢', who: '中枢', tone: 'orch', text: '接此命题,正分解为若干子题,延请智能体共参…' })
  scrollDown()

  const p = forceMock ? mockPlan(q) : await planMission(q)
  plan.value = p
  states.value = Array(p.agents.length).fill('idle')
  phase.value = 'running'
  minutes.value.push({ char: '枢', who: '中枢', tone: 'orch', text: `已延请 ${p.agents.length} 位智能体${p.live ? '' : '(示例)'},循理派分。` })
  scrollDown()

  const step = Math.max(360, Math.round(1700 / p.agents.length))
  p.agents.forEach((a, i) => {
    T(() => { states.value[i] = 'work' }, 260 + i * step)
    T(() => { states.value[i] = 'done'; minutes.value.push({ char: a.char, who: a.name, tone: 'agent', text: a.finding }); scrollDown() }, 260 + i * step + step * 0.66)
  })
  const end = 260 + p.agents.length * step + 220
  T(() => { orchState.value = 'done'; minutes.value.push({ char: '枢', who: '中枢', tone: 'orch', text: '已汇众智之论,成此决策报告。' }); scrollDown() }, end)
  T(() => { phase.value = 'done'; showReport.value = true; nextTick(renderReport); scrollDown() }, end + 260)
}

function renderReport() {
  if (!repChart.value) return
  chart = echarts.init(repChart.value)
  const hours = timeLabels.filter((_, i) => i % 4 === 0)
  const da = dayAhead.filter((_, i) => i % 4 === 0)
  const rt = realtime.filter((_, i) => i % 4 === 0)
  const CELADON = '#7BA391', AX = '#9AA09A'
  chart.setOption({
    grid: { left: 42, right: 14, top: 16, bottom: 24 },
    tooltip: { trigger: 'axis', backgroundColor: '#fff', borderColor: 'rgba(123,163,145,.3)', borderWidth: 1, textStyle: { color: '#3A3D3A' }, extraCssText: 'box-shadow:0 8px 26px rgba(92,132,117,.16);border-radius:8px;' },
    legend: { data: ['日前', '实时'], textStyle: { color: AX, fontSize: 11 }, right: 6, top: 0 },
    xAxis: { type: 'category', data: hours, axisLine: { lineStyle: { color: 'rgba(123,163,145,.25)' } }, axisTick: { show: false }, axisLabel: { color: AX, fontSize: 10 } },
    yAxis: { type: 'value', axisLabel: { color: AX, fontSize: 10 }, splitLine: { lineStyle: { color: 'rgba(123,163,145,.12)' } } },
    series: [
      { name: '日前', type: 'line', data: da, smooth: true, symbol: 'none', lineStyle: { color: CELADON, width: 2.2 },
        areaStyle: { color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [{ offset: 0, color: 'rgba(123,163,145,.18)' }, { offset: 1, color: 'rgba(123,163,145,0)' }]) } },
      { name: '实时', type: 'line', data: rt, smooth: true, symbol: 'none', lineStyle: { color: '#B7A98C', width: 1.5, type: 'dashed' } },
    ],
  })
}

const onResize = () => chart?.resize()
onMounted(() => { window.addEventListener('resize', onResize); startMission(PRESET_TASKS[0], true) })
onBeforeUnmount(() => { window.removeEventListener('resize', onResize); clearTimers(); chart?.dispose() })
</script>

<style scoped>
.bl-root {
  --bone: #F7F6F2; --bone-2: #FCFCFA; --glaze: #ECF1EE;
  --celadon: #7BA391; --celadon-2: #A9C5B8; --celadon-deep: #5C8475;
  --ink: #3A3D3A; --ink-2: #6E726B; --ink-3: #9AA09A;
  --line: rgba(92,132,117,.16); --line-2: rgba(92,132,117,.08);
  position: fixed; inset: 0; overflow: hidden; background: var(--bone); color: var(--ink);
  font-family: -apple-system, 'PingFang SC', 'Helvetica Neue', sans-serif; -webkit-font-smoothing: antialiased; letter-spacing: .2px;
}
.glow { position: fixed; inset: 0; z-index: 0; pointer-events: none;
  background: radial-gradient(70% 50% at 50% 0%, rgba(123,163,145,.08), transparent 60%), radial-gradient(50% 40% at 100% 100%, rgba(169,197,184,.1), transparent 70%); }

.ai-page { position: relative; z-index: 1; height: 100%; display: flex; flex-direction: column; padding: 26px 30px 28px; gap: 20px; box-sizing: border-box; }
.fade { animation: fadeUp .6s cubic-bezier(.22,.61,.36,1) both; }
@keyframes fadeUp { from { opacity: 0; transform: translateY(11px); } to { opacity: 1; transform: none; } }

.bar { display: flex; align-items: center; gap: 16px; padding: 14px 20px; background: var(--bone-2); border: 1px solid var(--line); border-radius: 16px; box-shadow: 0 12px 34px -22px rgba(92,132,117,.5); }
.tag { flex: none; width: 30px; height: 30px; display: grid; place-items: center; font-size: var(--font-lg); color: #fff; background: var(--celadon); border-radius: 9px; }
.task-in { flex: 1; min-width: 0; border: none; background: transparent; font-size: var(--font-15); color: var(--ink); outline: none; font-family: inherit; letter-spacing: .3px; }
.task-in::placeholder { color: var(--ink-3); }
.run { flex: none; cursor: pointer; border: 1px solid var(--celadon); color: var(--celadon-deep); background: transparent; font-size: var(--font-lg); padding: 8px 18px; border-radius: 20px; transition: all .2s; font-family: inherit; }
.run:hover:not(:disabled) { background: var(--celadon); color: #fff; }
.run:disabled { opacity: .4; cursor: default; }

.stage { flex: 1; min-height: 0; display: grid; grid-template-columns: 1fr 392px; gap: 20px; }
.card { background: var(--bone-2); border: 1px solid var(--line); border-radius: 18px; box-shadow: 0 16px 44px -28px rgba(92,132,117,.55); }

.loom { display: flex; flex-direction: column; min-height: 0; padding: 22px 24px; }
.loom-head { display: flex; justify-content: space-between; align-items: baseline; }
.loom-head h3 { margin: 0; font-size: var(--font-xl); font-weight: 500; letter-spacing: 3px; color: var(--ink); }
.meta { font-size: var(--font-12-5); color: var(--ink-3); display: inline-flex; align-items: center; gap: 8px; }
.live { font-size: var(--font-xs); padding: 2px 9px; border-radius: 10px; background: var(--glaze); color: var(--ink-2); }
.live.on { background: rgba(123,163,145,.16); color: var(--celadon-deep); }

.constellation { flex: 1; position: relative; min-height: 380px; margin: 10px 0; }
.wires { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; }
.link { fill: none; stroke: rgba(92,132,117,.18); stroke-width: 1; vector-effect: non-scaling-stroke; transition: stroke .5s; }
.link.flow { stroke: var(--celadon); stroke-width: 1.4; stroke-dasharray: 2 5; vector-effect: non-scaling-stroke; animation: dash .7s linear infinite; }
.link.on { stroke: var(--celadon-2); stroke-width: 1.2; vector-effect: non-scaling-stroke; }
@keyframes dash { to { stroke-dashoffset: -7; } }

.node { position: absolute; transform: translate(-50%, -50%); display: flex; flex-direction: column; align-items: center; gap: 9px; width: calc(var(--ns, 66px) + 36px); }
.tile { position: relative; width: var(--ns, 66px); height: var(--ns, 66px); display: grid; place-items: center; border-radius: 50%;
  background: radial-gradient(circle at 42% 34%, #fff, var(--glaze)); box-shadow: 0 6px 16px -8px rgba(92,132,117,.5), inset 0 0 0 1px rgba(92,132,117,.12); }
.ripple { position: absolute; inset: 0; border-radius: 50%; pointer-events: none; }
.ch { font-size: calc(var(--ns, 66px) * .38); color: var(--ink-2); z-index: 1; font-weight: 500; transition: color .4s; }
.tick { position: absolute; top: -1px; right: -1px; width: 19px; height: 19px; border-radius: 50%; background: var(--celadon); color: #fff; font-size: var(--font-xs); display: grid; place-items: center; opacity: 0; transform: scale(.4); transition: all .3s; }
.nlabel { font-size: var(--font-12-5); color: var(--ink-2); text-align: center; line-height: 1.3; }
.nlabel i { display: block; font-style: normal; font-size: var(--font-9); letter-spacing: 1.5px; color: var(--ink-3); margin-top: 2px; text-transform: uppercase; }

.node.work .tile { box-shadow: 0 8px 22px -8px rgba(123,163,145,.7), inset 0 0 0 1.5px var(--celadon); }
.node.work .ch { color: var(--ink); }
.node.work .ripple { animation: ripple 1.6s ease-out infinite; }
.node.work .ripple::before, .node.work .ripple::after { content: ''; position: absolute; inset: 0; border-radius: 50%; border: 1.5px solid var(--celadon); }
.node.work .ripple::after { animation: ripple 1.6s ease-out infinite .8s; }
.node.done .tile { box-shadow: 0 6px 16px -8px rgba(123,163,145,.5), inset 0 0 0 1.5px var(--celadon-2); }
.node.done .ch { color: var(--ink); }
.node.done .tick { opacity: 1; transform: scale(1); }

.node.core { width: 116px; }
.node.core .tile { width: 78px; height: 78px; }
.node.core .ch { font-size: var(--font-32); color: var(--celadon-deep); }
.node.core.work .tile { box-shadow: 0 10px 28px -8px rgba(123,163,145,.75), inset 0 0 0 1.5px var(--celadon-deep); }

@keyframes ripple { 0% { transform: scale(1); opacity: .5; } 100% { transform: scale(1.5); opacity: 0; } }

.legend { display: flex; align-items: center; gap: 18px; padding-top: 14px; border-top: 1px solid var(--line-2); font-size: var(--font-11-5); color: var(--ink-3); }
.lg { display: inline-flex; align-items: center; gap: 6px; }
.lg .d { width: 7px; height: 7px; border-radius: 50%; }
.d.idle { background: var(--ink-3); opacity: .5; } .d.work { background: var(--celadon); } .d.done { background: var(--celadon-2); }
.tip { margin-left: auto; }

.hint { position: absolute; left: 50%; top: 54%; transform: translateX(-50%); text-align: center; width: 88%; }
.hint p { margin: 0 0 16px; font-size: var(--font-15); color: var(--ink-2); letter-spacing: 2px; }
.presets { display: flex; flex-wrap: wrap; gap: 10px; justify-content: center; }
.presets button { cursor: pointer; font-family: inherit; border: 1px solid var(--line); background: var(--bone); color: var(--ink-2); font-size: var(--font-12-5); padding: 9px 16px; border-radius: 20px; transition: all .2s; }
.presets button:hover { border-color: var(--celadon); color: var(--celadon-deep); background: var(--glaze); }

.log { overflow: auto; display: flex; flex-direction: column; gap: 13px; padding: 22px; }
.log::-webkit-scrollbar { width: 6px; } .log::-webkit-scrollbar-thumb { background: rgba(92,132,117,.2); border-radius: 3px; }
.log-head { font-size: var(--font-lg); font-weight: 500; letter-spacing: 4px; color: var(--ink-2); }
.rows { display: flex; flex-direction: column; gap: 11px; }
.row { padding: 13px 15px; border-radius: 14px; background: var(--bone); border: 1px solid var(--line-2); }
.row .who { display: flex; align-items: center; gap: 9px; font-size: var(--font-12-5); font-weight: 600; color: var(--ink); margin-bottom: 6px; }
.row .mk { width: 22px; height: 22px; border-radius: 8px; display: grid; place-items: center; font-size: var(--font-sm); background: var(--glaze); color: var(--celadon-deep); }
.row p { margin: 0; font-size: var(--font-md); line-height: 1.75; color: var(--ink-2); }
.row.orch { border-color: rgba(123,163,145,.3); background: linear-gradient(180deg, rgba(123,163,145,.06), var(--bone)); }
.row.orch .mk { background: rgba(123,163,145,.18); color: var(--celadon-deep); }

.report { margin-top: 4px; padding: 20px; border-radius: 16px; background: var(--bone); border: 1px solid var(--celadon-2); box-shadow: 0 16px 40px -26px rgba(92,132,117,.7); }
.rep-head { margin-bottom: 14px; }
.rep-kicker { font-size: var(--font-xs); letter-spacing: 2px; color: var(--celadon-deep); }
.rep-head h4 { margin: 4px 0 0; font-size: var(--font-18); font-weight: 500; letter-spacing: 1px; color: var(--ink); }
.rep-sum { margin: 0 0 14px; font-size: var(--font-12-5); line-height: 1.9; color: var(--ink-2); padding: 12px 15px; border-left: 2px solid var(--celadon); background: var(--glaze); border-radius: 0 10px 10px 0; }
.rep-sub { font-size: var(--font-sm); color: var(--celadon-deep); margin: 14px 0 8px; letter-spacing: 1px; }
.rep-table { width: 100%; border-collapse: collapse; font-size: var(--font-sm); }
.rep-table th { text-align: left; color: var(--ink-3); font-weight: 500; padding: 7px 8px; border-bottom: 1px solid var(--line); font-size: var(--font-11-5); }
.rep-table td { padding: 8px; border-bottom: 1px solid var(--line-2); color: var(--ink-2); }
.rep-table td.num { font-variant-numeric: tabular-nums; color: var(--ink); }
.rep-chart { height: 168px; margin-top: 4px; }
.rep-conc { margin-top: 12px; padding: 11px 15px; background: var(--glaze); border-radius: 10px; font-size: var(--font-md); color: var(--celadon-deep); }
.sign { display: flex; align-items: center; gap: 10px; margin-top: 16px; padding-top: 13px; border-top: 1px solid var(--line-2); font-size: var(--font-11-5); color: var(--ink-3); }
.seal { width: 24px; height: 24px; border-radius: 7px; border: 1px solid var(--celadon); color: var(--celadon-deep); display: grid; place-items: center; font-size: var(--font-sm); }

.rise-enter-active { transition: all .5s cubic-bezier(.22,.61,.36,1); }
.rise-enter-from { opacity: 0; transform: translateY(12px); }
.report-enter-active { transition: all .6s cubic-bezier(.22,.61,.36,1); }
.report-enter-from { opacity: 0; transform: translateY(18px); }

@media (max-width: 768px) {
  .stage { grid-template-columns: 1fr; }
}
</style>
