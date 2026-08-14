<template>
  <div class="bz-root">
    <div class="grain" />
    <div class="brushed" />

    <div class="ai-page">
      <!-- 指令条 -->
      <header class="bar fade">
        <span class="tag">指令 · CMD</span>
        <input
          class="task-in"
          v-model="task"
          :disabled="busy"
          placeholder="录入一项任务,主控将现场编排多智能体(回车执行)…"
          @keydown.enter="startMission()"
        />
        <button class="run" :disabled="busy || !task.trim()" @click="startMission()">
          {{ busy ? '运行中' : '▶ 执行' }}
        </button>
        <span class="gauge-mini" aria-hidden="true">
          <svg viewBox="0 0 40 40"><circle cx="20" cy="20" r="17" /><path d="M20 20 L20 7" /><circle cx="20" cy="20" r="2.2" class="hub" /></svg>
        </span>
      </header>

      <div class="stage">
        <!-- 仪表编排盘 -->
        <section class="panel loom">
          <div class="panel-head">
            <h3>多智能体编排盘 · ORCHESTRATION</h3>
            <span class="readout">
              <span v-if="plan" class="live" :class="{ on: plan.live }">{{ plan.live ? 'LIVE · LLM' : 'DEMO' }}</span>
              <template v-if="phase === 'running' || phase === 'done'">{{ doneCount }}/{{ nAgents }} · {{ phase === 'done' ? 'DONE' : 'RUNNING' }}</template>
              <template v-else-if="phase === 'planning'">主控编排中…</template>
            </span>
          </div>

          <div class="constellation">
            <svg v-if="nAgents" class="wires" viewBox="0 0 100 100" preserveAspectRatio="none">
              <path v-for="(a, i) in agents" :key="i" :d="wire(i, nAgents)" class="link" :class="linkCls(i)" />
            </svg>

            <!-- 主控仪表 -->
            <div class="node core" :class="orchState" :style="{ left: '50%', top: '14%' }">
              <div class="dial">
                <svg class="ticks" viewBox="0 0 80 80"><circle cx="40" cy="40" r="36" /></svg>
                <svg class="sweep" viewBox="0 0 80 80"><circle cx="40" cy="40" r="30" /></svg>
                <span class="ch">枢</span>
              </div>
              <div class="nlabel">主控中枢<i>CORE</i></div>
            </div>

            <!-- N 个智能体仪表 -->
            <div v-for="(a, i) in agents" :key="a.name + i" class="node" :class="states[i]" :style="nodeStyle(i)">
              <div class="dial">
                <svg class="ticks" viewBox="0 0 80 80"><circle cx="40" cy="40" r="36" /></svg>
                <svg class="sweep" viewBox="0 0 80 80"><circle cx="40" cy="40" r="30" /></svg>
                <span class="ch">{{ a.char }}</span>
                <i class="led" />
              </div>
              <div class="nlabel">{{ a.name }}<i>{{ a.role }}</i></div>
            </div>

            <div v-if="phase === 'idle'" class="hint">
              <p>录入指令,主控将现场编排智能体</p>
              <div class="presets">
                <button v-for="p in PRESET_TASKS" :key="p" @click="startMission(p)">{{ p }}</button>
              </div>
            </div>
          </div>

          <div class="legend">
            <span class="lg"><i class="d idle" />待命</span>
            <span class="lg"><i class="d work" />运算</span>
            <span class="lg"><i class="d done" />完成</span>
            <span class="tip">主控按工作流派发 · 智能体数量随任务而变</span>
          </div>
        </section>

        <!-- 协同日志 + 输出 -->
        <aside ref="scrollEl" class="panel log">
          <div class="log-head">协同日志 · LOG</div>
          <transition-group name="rise" tag="div" class="rows">
            <div v-for="(m, i) in minutes" :key="i" class="row" :class="m.tone">
              <span class="who"><i class="mk">{{ m.char }}</i>{{ m.who }}</span>
              <p>{{ m.text }}</p>
            </div>
          </transition-group>

          <transition name="report">
            <div v-if="showReport && plan" class="report">
              <div class="rep-head">
                <span class="rep-kicker">OUTPUT{{ plan.live ? ' · LIVE' : ' · DEMO' }}</span>
                <h4>决策报告</h4>
              </div>
              <p class="rep-sum">{{ plan.report.summary }}</p>
              <div class="rep-sub">▸ 关键数据</div>
              <table class="rep-table">
                <thead><tr><th v-for="c in plan.report.columns" :key="c">{{ c }}</th></tr></thead>
                <tbody>
                  <tr v-for="(r, ri) in plan.report.rows" :key="ri">
                    <td v-for="(cell, ci) in r" :key="ci" :class="{ num: ci > 0 }">{{ cell }}</td>
                  </tr>
                </tbody>
              </table>
              <div class="rep-sub">▸ 次日 24h 价格预测</div>
              <div ref="repChart" class="rep-chart" />
              <div v-if="plan.report.conclusion" class="rep-conc">{{ plan.report.conclusion }}</div>
              <div class="sign"><span class="stamp">⚙ {{ nAgents }} AGENTS</span>{{ stamp }}</div>
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
  minutes.value.push({ char: '枢', who: '主控中枢', tone: 'orch', text: '接收指令,正在拆解任务、编排智能体阵容…' })
  scrollDown()

  const p = forceMock ? mockPlan(q) : await planMission(q)
  plan.value = p
  states.value = Array(p.agents.length).fill('idle')
  phase.value = 'running'
  minutes.value.push({ char: '枢', who: '主控中枢', tone: 'orch', text: `已编排 ${p.agents.length} 个智能体${p.live ? '' : '(示例)'},开始派发协同。` })
  scrollDown()

  const step = Math.max(360, Math.round(1700 / p.agents.length))
  p.agents.forEach((a, i) => {
    T(() => { states.value[i] = 'work' }, 260 + i * step)
    T(() => { states.value[i] = 'done'; minutes.value.push({ char: a.char, who: a.name + ' Agent', tone: 'agent', text: a.finding }); scrollDown() }, 260 + i * step + step * 0.66)
  })
  const end = 260 + p.agents.length * step + 220
  T(() => { orchState.value = 'done'; minutes.value.push({ char: '枢', who: '主控中枢', tone: 'orch', text: '已汇总各智能体结论,生成决策报告。' }); scrollDown() }, end)
  T(() => { phase.value = 'done'; showReport.value = true; nextTick(renderReport); scrollDown() }, end + 260)
}

function renderReport() {
  if (!repChart.value) return
  chart = echarts.init(repChart.value)
  const hours = timeLabels.filter((_, i) => i % 4 === 0)
  const da = dayAhead.filter((_, i) => i % 4 === 0)
  const rt = realtime.filter((_, i) => i % 4 === 0)
  const BRASS = '#C2A05A', AX = '#9A8A66'
  chart.setOption({
    grid: { left: 42, right: 14, top: 16, bottom: 24 },
    tooltip: { trigger: 'axis', backgroundColor: '#23201B', borderColor: 'rgba(201,168,106,.35)', borderWidth: 1, textStyle: { color: '#E9DEC6' }, extraCssText: 'border-radius:4px;' },
    legend: { data: ['日前', '实时'], textStyle: { color: AX, fontSize: 11 }, right: 6, top: 0 },
    xAxis: { type: 'category', data: hours, axisLine: { lineStyle: { color: 'rgba(201,168,106,.3)' } }, axisTick: { show: false }, axisLabel: { color: AX, fontSize: 10 } },
    yAxis: { type: 'value', axisLabel: { color: AX, fontSize: 10 }, splitLine: { lineStyle: { color: 'rgba(201,168,106,.1)' } } },
    series: [
      { name: '日前', type: 'line', data: da, smooth: true, symbol: 'none', lineStyle: { color: BRASS, width: 2.2, shadowColor: 'rgba(201,168,106,.5)', shadowBlur: 6 },
        areaStyle: { color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [{ offset: 0, color: 'rgba(201,168,106,.22)' }, { offset: 1, color: 'rgba(201,168,106,0)' }]) } },
      { name: '实时', type: 'line', data: rt, smooth: true, symbol: 'none', lineStyle: { color: '#5E8A7B', width: 1.5, type: 'dashed' } },
    ],
  })
}

const onResize = () => chart?.resize()
onMounted(() => { window.addEventListener('resize', onResize); startMission(PRESET_TASKS[0], true) })
onBeforeUnmount(() => { window.removeEventListener('resize', onResize); clearTimers(); chart?.dispose() })
</script>

<style scoped>
.bz-root {
  --metal: #23201B; --metal-2: #2C2820; --panel: #2E2A22;
  --brass: #C2A05A; --brass-2: #D9BE84; --brass-dim: #7E673A;
  --cream: #E9DEC6; --cream-2: #B3A788; --patina: #6FA08D; --rust: #B5603E;
  --line: rgba(201,168,106,.2); --line-2: rgba(201,168,106,.1);
  --mono: ui-monospace, 'SF Mono', 'JetBrains Mono', Menlo, Consolas, monospace;
  position: fixed; inset: 0; overflow: hidden; background: var(--metal); color: var(--cream);
  font-family: -apple-system, 'PingFang SC', sans-serif; -webkit-font-smoothing: antialiased;
}
.grain { position: fixed; inset: 0; z-index: 0; pointer-events: none; opacity: .5; mix-blend-mode: overlay;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.05'/%3E%3C/svg%3E"); }
.brushed { position: fixed; inset: 0; z-index: 0; pointer-events: none; opacity: .5;
  background: repeating-linear-gradient(90deg, rgba(201,168,106,.025) 0 1px, transparent 1px 3px), radial-gradient(120% 80% at 50% 0%, rgba(201,168,106,.06), transparent 60%); }

.ai-page { position: relative; z-index: 1; height: 100%; display: flex; flex-direction: column; padding: 22px 26px 24px; gap: 16px; box-sizing: border-box; }
.fade { animation: fadeUp .6s cubic-bezier(.22,.61,.36,1) both; }
@keyframes fadeUp { from { opacity: 0; transform: translateY(11px); } to { opacity: 1; transform: none; } }

.bar { display: flex; align-items: center; gap: 14px; padding: 11px 16px; background: linear-gradient(180deg, var(--panel), var(--metal-2)); border: 1px solid var(--line); border-radius: 8px; box-shadow: inset 0 1px 0 rgba(217,190,132,.12), 0 10px 30px -18px #000; }
.tag { flex: none; font-family: var(--mono); font-size: 12px; letter-spacing: 1px; color: var(--metal); background: var(--brass); padding: 5px 11px; border-radius: 4px; font-weight: 600; }
.task-in { flex: 1; min-width: 0; border: none; background: transparent; font-size: 15px; color: var(--cream); outline: none; font-family: inherit; }
.task-in::placeholder { color: var(--cream-2); opacity: .7; }
.run { flex: none; cursor: pointer; font-family: var(--mono); border: 1px solid var(--brass); color: var(--brass-2); background: rgba(201,168,106,.1); font-size: 13px; padding: 7px 15px; border-radius: 6px; letter-spacing: 1px; transition: all .18s; }
.run:hover:not(:disabled) { background: var(--brass); color: var(--metal); }
.run:disabled { opacity: .4; cursor: default; }
.gauge-mini svg { width: 38px; height: 38px; }
.gauge-mini circle { fill: none; stroke: var(--brass); stroke-width: 1.4; }
.gauge-mini path { stroke: var(--rust); stroke-width: 1.6; }
.gauge-mini .hub { fill: var(--brass); stroke: none; }

.stage { flex: 1; min-height: 0; display: grid; grid-template-columns: 1fr 392px; gap: 18px; }
.panel { background: linear-gradient(180deg, var(--panel), var(--metal-2)); border: 1px solid var(--line); border-radius: 10px; box-shadow: inset 0 1px 0 rgba(217,190,132,.1), 0 16px 40px -26px #000; }

.loom { display: flex; flex-direction: column; min-height: 0; padding: 16px 18px; }
.panel-head { display: flex; justify-content: space-between; align-items: baseline; }
.panel-head h3 { margin: 0; font-family: var(--mono); font-size: 13px; letter-spacing: 1.5px; color: var(--brass-2); font-weight: 600; }
.readout { font-family: var(--mono); font-size: 12px; color: var(--cream-2); display: inline-flex; align-items: center; gap: 8px; }
.live { font-size: 10.5px; padding: 2px 7px; border-radius: 3px; background: rgba(201,168,106,.14); color: var(--cream-2); letter-spacing: .5px; }
.live.on { background: rgba(111,160,141,.2); color: var(--patina); }

.constellation { flex: 1; position: relative; min-height: 380px; margin: 8px 0; }
.wires { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; }
.link { fill: none; stroke: rgba(201,168,106,.16); stroke-width: 1.4; vector-effect: non-scaling-stroke; transition: stroke .5s; }
.link.flow { stroke: var(--brass); stroke-width: 2; stroke-dasharray: 2 4; vector-effect: non-scaling-stroke; animation: dash .55s linear infinite; filter: drop-shadow(0 0 2px rgba(201,168,106,.6)); }
.link.on { stroke: var(--brass-dim); stroke-width: 1.6; vector-effect: non-scaling-stroke; }
@keyframes dash { to { stroke-dashoffset: -6; } }

.node { position: absolute; transform: translate(-50%, -50%); display: flex; flex-direction: column; align-items: center; gap: 7px; width: calc(var(--ns, 66px) + 32px); }
.dial { position: relative; width: var(--ns, 66px); height: var(--ns, 66px); display: grid; place-items: center; border-radius: 50%;
  background: radial-gradient(circle at 50% 38%, #3A352B, #211E18); box-shadow: inset 0 0 0 1px rgba(201,168,106,.22), inset 0 2px 5px rgba(0,0,0,.6); }
.dial .ticks { position: absolute; inset: 0; width: 100%; height: 100%; }
.dial .ticks circle { fill: none; stroke: var(--brass-dim); stroke-width: 5; stroke-dasharray: 1 4.6; opacity: .55; }
.dial .sweep { position: absolute; inset: 0; width: 100%; height: 100%; transform: rotate(-90deg); }
.dial .sweep circle { fill: none; stroke: transparent; stroke-width: 2.2; }
.ch { font-family: var(--mono); font-size: calc(var(--ns, 66px) * .36); color: var(--cream-2); z-index: 1; transition: color .4s; }
.led { position: absolute; bottom: 8px; width: 6px; height: 6px; border-radius: 50%; background: var(--brass-dim); transition: all .3s; }
.nlabel { font-size: 12px; color: var(--cream); text-align: center; line-height: 1.3; font-weight: 500; }
.nlabel i { display: block; font-style: normal; font-family: var(--mono); font-size: 9px; letter-spacing: 1px; color: var(--cream-2); opacity: .65; margin-top: 1px; }

.node.work .dial { box-shadow: inset 0 0 0 1px var(--brass), 0 0 18px -2px rgba(201,168,106,.55), inset 0 2px 5px rgba(0,0,0,.5); }
.node.work .ch { color: var(--brass-2); }
.node.work .sweep { animation: spin 1.6s linear infinite; }
.node.work .sweep circle { stroke: var(--brass-2); stroke-dasharray: 30 130; }
.node.work .led { background: var(--brass-2); box-shadow: 0 0 7px var(--brass-2); animation: blink 1s infinite; }
.node.done .dial { box-shadow: inset 0 0 0 1px var(--brass-dim), 0 0 10px -4px rgba(201,168,106,.4), inset 0 2px 5px rgba(0,0,0,.5); }
.node.done .ch { color: var(--cream); }
.node.done .led { background: var(--patina); box-shadow: 0 0 6px var(--patina); }

.node.core { width: 112px; }
.node.core .dial { width: 76px; height: 76px; background: radial-gradient(circle at 50% 36%, #463E2E, #221F18); }
.node.core .ch { font-size: 30px; color: var(--brass-2); }
.node.core.work .dial { box-shadow: inset 0 0 0 1.5px var(--brass-2), 0 0 24px -2px rgba(217,190,132,.6), inset 0 2px 6px rgba(0,0,0,.5); }
.node.core.work .sweep { animation: spin 2.6s linear infinite; }
.node.core.work .sweep circle { stroke: var(--brass-2); stroke-dasharray: 36 150; }

@keyframes spin { to { transform: rotate(270deg); } }
@keyframes blink { 50% { opacity: .35; } }

.legend { display: flex; align-items: center; gap: 16px; padding-top: 10px; border-top: 1px solid var(--line-2); font-family: var(--mono); font-size: 11px; color: var(--cream-2); }
.lg { display: inline-flex; align-items: center; gap: 6px; }
.lg .d { width: 7px; height: 7px; border-radius: 50%; }
.d.idle { background: var(--brass-dim); } .d.work { background: var(--brass-2); box-shadow: 0 0 6px var(--brass-2); } .d.done { background: var(--patina); }
.tip { margin-left: auto; opacity: .7; }

.hint { position: absolute; left: 50%; top: 54%; transform: translateX(-50%); text-align: center; width: 88%; }
.hint p { margin: 0 0 14px; font-size: 15px; color: var(--cream-2); letter-spacing: 1px; }
.presets { display: flex; flex-wrap: wrap; gap: 9px; justify-content: center; }
.presets button { cursor: pointer; font-family: inherit; border: 1px solid var(--line); background: rgba(201,168,106,.06); color: var(--cream-2); font-size: 12px; padding: 8px 14px; border-radius: 6px; transition: all .18s; }
.presets button:hover { border-color: var(--brass); color: var(--brass-2); background: rgba(201,168,106,.12); }

.log { overflow: auto; display: flex; flex-direction: column; gap: 11px; padding: 16px; }
.log::-webkit-scrollbar { width: 6px; } .log::-webkit-scrollbar-thumb { background: rgba(201,168,106,.25); border-radius: 3px; }
.log-head { font-family: var(--mono); font-size: 13px; letter-spacing: 1.5px; color: var(--brass-2); font-weight: 600; }
.rows { display: flex; flex-direction: column; gap: 9px; }
.row { padding: 11px 13px; border-radius: 7px; background: var(--metal-2); border: 1px solid var(--line-2); }
.row .who { display: flex; align-items: center; gap: 9px; font-size: 12.5px; font-weight: 600; color: var(--cream); margin-bottom: 6px; }
.row .mk { width: 22px; height: 22px; border-radius: 4px; display: grid; place-items: center; font-family: var(--mono); font-size: 12px; background: rgba(201,168,106,.16); color: var(--brass-2); }
.row p { margin: 0; font-size: 13px; line-height: 1.7; color: var(--cream-2); }
.row.orch { border-color: rgba(181,96,62,.4); background: linear-gradient(180deg, rgba(181,96,62,.08), var(--metal-2)); }
.row.orch .mk { background: rgba(181,96,62,.18); color: var(--rust); }

.report { margin-top: 4px; padding: 17px; border-radius: 9px; background: var(--metal-2); border: 1px solid var(--brass); box-shadow: 0 0 24px -10px rgba(201,168,106,.5); }
.rep-head { margin-bottom: 12px; }
.rep-kicker { font-family: var(--mono); font-size: 10.5px; letter-spacing: 1.5px; color: var(--brass); }
.rep-head h4 { margin: 3px 0 0; font-size: 17px; font-weight: 600; color: var(--cream); }
.rep-sum { margin: 0 0 14px; font-size: 12.5px; line-height: 1.8; color: var(--cream-2); padding: 11px 13px; border-left: 2px solid var(--brass); background: rgba(201,168,106,.06); }
.rep-sub { font-family: var(--mono); font-size: 11.5px; color: var(--brass); margin: 12px 0 8px; letter-spacing: .5px; }
.rep-table { width: 100%; border-collapse: collapse; font-size: 12px; }
.rep-table th { text-align: left; font-family: var(--mono); color: var(--cream-2); font-weight: 500; padding: 7px 8px; border-bottom: 1px solid var(--line); font-size: 11px; }
.rep-table td { padding: 8px; border-bottom: 1px solid var(--line-2); color: var(--cream-2); }
.rep-table td.num { font-family: var(--mono); color: var(--cream); }
.rep-chart { height: 168px; margin-top: 4px; }
.rep-conc { margin-top: 12px; padding: 10px 13px; background: rgba(181,96,62,.1); border-radius: 6px; font-size: 13px; color: #E0A07E; }
.sign { display: flex; align-items: center; gap: 10px; margin-top: 14px; padding-top: 12px; border-top: 1px solid var(--line-2); font-family: var(--mono); font-size: 11px; color: var(--cream-2); }
.stamp { color: var(--brass); border: 1px solid var(--brass-dim); padding: 2px 8px; border-radius: 4px; letter-spacing: 1px; }

.rise-enter-active { transition: all .45s cubic-bezier(.22,.61,.36,1); }
.rise-enter-from { opacity: 0; transform: translateY(12px); }
.report-enter-active { transition: all .6s cubic-bezier(.22,.61,.36,1); }
.report-enter-from { opacity: 0; transform: translateY(18px); }

@media (max-width: 768px) {
  .stage { grid-template-columns: 1fr; }
}
</style>
