<template>
  <div class="tg-root">
    <div class="grain" />
    <div class="warp" />

    <div class="ai-page">
      <!-- 诏令:输入任务,让中枢实时调度 -->
      <header class="edict fade">
        <span class="tag serif">诏令</span>
        <input
          class="task-in"
          v-model="task"
          :disabled="busy"
          placeholder="下一道任务,天工现场调度多智能体协同(回车开始)…"
          @keydown.enter="startMission()"
        />
        <button class="cast serif" :disabled="busy || !task.trim()" @click="startMission()">
          {{ busy ? '调度中…' : '开始调度' }}
        </button>
        <span class="seal" aria-hidden="true">
          <svg viewBox="0 0 48 48"><rect x="3" y="3" width="42" height="42" rx="5" /><text x="24" y="20">天</text><text x="24" y="38">工</text></svg>
        </span>
      </header>

      <div class="stage">
        <!-- 智能体协作图(数量随任务动态) -->
        <section class="loom">
          <div class="loom-head">
            <h3 class="serif">智能体协作 · 编排图</h3>
            <span class="prog">
              <span v-if="plan" class="live" :class="{ on: plan.live }">{{ plan.live ? '实时 · LLM' : '示例阵容' }}</span>
              <template v-if="phase === 'running' || phase === 'done'">{{ doneCount }} / {{ nAgents }} · {{ phase === 'done' ? '协作完成' : '协作中…' }}</template>
              <template v-else-if="phase === 'planning'">调度中枢规划阵容中…</template>
            </span>
          </div>

          <div class="constellation">
            <svg v-if="nAgents" class="wires" viewBox="0 0 100 100" preserveAspectRatio="none">
              <path v-for="(a, i) in agents" :key="i" :d="wire(i, nAgents)" class="link" :class="linkCls(i)" />
            </svg>

            <!-- 调度中枢 -->
            <div class="node orch" :class="orchState" :style="{ left: '50%', top: '14%' }">
              <div class="seal-c">
                <svg class="ring" viewBox="0 0 44 44"><circle cx="22" cy="22" r="20" /></svg>
                <span class="ch serif">枢</span>
              </div>
              <div class="nlabel">调度中枢<i>Orchestrator</i></div>
            </div>

            <!-- N 个智能体(坐标公式算,自适应) -->
            <div v-for="(a, i) in agents" :key="a.name + i" class="node" :class="states[i]" :style="nodeStyle(i)">
              <div class="seal-c">
                <svg class="ring" viewBox="0 0 44 44"><circle cx="22" cy="22" r="20" /></svg>
                <span class="ch serif">{{ a.char }}</span>
                <i class="tick">✓</i>
              </div>
              <div class="nlabel">{{ a.name }}<i>{{ a.role }}</i></div>
            </div>

            <!-- 空闲:引导下诏令 -->
            <div v-if="phase === 'idle'" class="hint">
              <p class="serif">请下诏令,天工将现场调度智能体</p>
              <div class="presets">
                <button v-for="p in PRESET_TASKS" :key="p" @click="startMission(p)">{{ p }}</button>
              </div>
            </div>
          </div>

          <div class="loom-foot">
            <span class="lg"><i class="d idle" />待命</span>
            <span class="lg"><i class="d work" />运算中</span>
            <span class="lg"><i class="d done" />已完成</span>
            <span class="orch-tip">中枢按工作流派发 · 智能体数量随任务而变</span>
          </div>
        </section>

        <!-- 协作纪要 + 产出 -->
        <aside ref="scrollEl" class="scroll">
          <div class="minutes-head serif">协作纪要</div>
          <transition-group name="rise" tag="div" class="minutes">
            <div v-for="(m, i) in minutes" :key="i" class="bubble" :class="m.tone">
              <span class="who"><i class="mk serif">{{ m.char }}</i>{{ m.who }}</span>
              <p>{{ m.text }}</p>
            </div>
          </transition-group>

          <transition name="report">
            <div v-if="showReport && plan" class="report">
              <div class="rep-head">
                <span class="rep-kicker serif">协作产出{{ plan.live ? ' · 实时生成' : ' · 示例' }}</span>
                <h4 class="serif">决策报告</h4>
              </div>
              <p class="rep-sum">{{ plan.report.summary }}</p>
              <div class="rep-sub serif">▸ 关键数据</div>
              <table class="rep-table">
                <thead><tr><th v-for="c in plan.report.columns" :key="c">{{ c }}</th></tr></thead>
                <tbody>
                  <tr v-for="(r, ri) in plan.report.rows" :key="ri">
                    <td v-for="(cell, ci) in r" :key="ci" :class="{ num: ci > 0 }">{{ cell }}</td>
                  </tr>
                </tbody>
              </table>
              <div class="rep-sub serif">▸ 次日 24h 价格预测曲线</div>
              <div ref="repChart" class="rep-chart" />
              <div v-if="plan.report.conclusion" class="rep-conc serif">{{ plan.report.conclusion }}</div>
              <div class="sign"><span class="seal-mini serif">天工</span>本报告由 {{ nAgents }} 个智能体协作完成 · {{ stamp }}</div>
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
import { planMission, mockPlan, PRESET_TASKS, type MissionPlan, type Agent } from './orchestrator'
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
const nodeSize = computed(() => { const n = nAgents.value; return n > 8 ? 50 : n > 6 ? 56 : 64 })

// 半环布局:N 个节点以中枢(50,14)为顶点,在下方扇形均匀展开;n 多则张得更开。
function geo(i: number, n: number) {
  const cx = 50, cy = 14, Rx = 42, Ry = 60
  const alpha = Math.min(75, 26 + n * 5) // 半张角(度)
  const t = n <= 1 ? 0 : (i / (n - 1)) * 2 - 1 // -1..1
  const phi = (t * alpha * Math.PI) / 180
  return { x: cx + Rx * Math.sin(phi), y: cy + Ry * Math.cos(phi) }
}
function nodeStyle(i: number) {
  const p = geo(i, nAgents.value)
  return { left: p.x + '%', top: p.y + '%', '--ns': nodeSize.value + 'px' } as Record<string, string>
}
function wire(i: number, n: number) {
  const p = geo(i, n)
  return `M50 14 L${p.x} ${p.y}`
}
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
  minutes.value.push({ char: '枢', who: '调度中枢', tone: 'orch', text: '接到诏令,正在拆解任务、规划智能体阵容…' })
  scrollDown()

  const p = forceMock ? mockPlan(q) : await planMission(q)
  plan.value = p
  states.value = Array(p.agents.length).fill('idle')
  phase.value = 'running'
  minutes.value.push({ char: '枢', who: '调度中枢', tone: 'orch', text: `已规划 ${p.agents.length} 个智能体${p.live ? '' : '(示例)'},开始派发协同。` })
  scrollDown()

  const step = Math.max(360, Math.round(1700 / p.agents.length))
  p.agents.forEach((a, i) => {
    T(() => { states.value[i] = 'work' }, 260 + i * step)
    T(() => { states.value[i] = 'done'; minutes.value.push({ char: a.char, who: a.name + ' Agent', tone: 'agent', text: a.finding }); scrollDown() }, 260 + i * step + step * 0.66)
  })
  const end = 260 + p.agents.length * step + 220
  T(() => { orchState.value = 'done'; minutes.value.push({ char: '枢', who: '调度中枢', tone: 'orch', text: '已汇总各智能体结论,生成决策报告。' }); scrollDown() }, end)
  T(() => { phase.value = 'done'; showReport.value = true; nextTick(renderReport); scrollDown() }, end + 260)
}

function renderReport() {
  if (!repChart.value) return
  chart = echarts.init(repChart.value)
  const hours = timeLabels.filter((_, i) => i % 4 === 0)
  const da = dayAhead.filter((_, i) => i % 4 === 0)
  const rt = realtime.filter((_, i) => i % 4 === 0)
  const BRASS = '#A8823C', INK = '#1C1A17', AX = '#8C8273'
  chart.setOption({
    grid: { left: 42, right: 14, top: 16, bottom: 24 },
    tooltip: { trigger: 'axis', backgroundColor: '#FBF8F0', borderColor: 'rgba(28,26,23,.12)', borderWidth: 1, textStyle: { color: INK }, extraCssText: 'box-shadow:0 8px 26px rgba(60,46,24,.14);border-radius:6px;' },
    legend: { data: ['日前', '实时'], textStyle: { color: AX, fontSize: 11 }, right: 6, top: 0 },
    xAxis: { type: 'category', data: hours, axisLine: { lineStyle: { color: 'rgba(28,26,23,.16)' } }, axisTick: { show: false }, axisLabel: { color: AX, fontSize: 10 } },
    yAxis: { type: 'value', axisLabel: { color: AX, fontSize: 10 }, splitLine: { lineStyle: { color: 'rgba(28,26,23,.07)' } } },
    series: [
      { name: '日前', type: 'line', data: da, smooth: true, symbol: 'none', lineStyle: { color: BRASS, width: 2.2 },
        areaStyle: { color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [{ offset: 0, color: 'rgba(168,130,60,.16)' }, { offset: 1, color: 'rgba(168,130,60,0)' }]) } },
      { name: '实时', type: 'line', data: rt, smooth: true, symbol: 'none', lineStyle: { color: INK, width: 1.4, type: 'dashed' } },
    ],
  })
}

const onResize = () => chart?.resize()
onMounted(() => {
  window.addEventListener('resize', onResize)
  startMission(PRESET_TASKS[0], true) // 进场先用示例阵容跑一遍,有内容;输入任务即走 LLM 实时
})
onBeforeUnmount(() => { window.removeEventListener('resize', onResize); clearTimers(); chart?.dispose() })
</script>

<style scoped>
.tg-root {
  --paper: #F4F0E6; --paper-2: #EFEADD; --card: #FBF8F0;
  --ink: #1C1A17; --ink-2: #4A463E; --ink-3: #8C8273;
  --brass: #A8823C; --brass-2: #C9A35B; --cinnabar: #B23A2E; --celadon: #5E8268;
  --line: rgba(28,26,23,.11); --line-2: rgba(28,26,23,.06);
  --serif: 'Songti SC', 'STSong', 'Source Han Serif SC', 'Noto Serif SC', Georgia, serif;
  position: fixed; inset: 0; overflow: hidden; background: var(--paper); color: var(--ink);
  font-family: -apple-system, 'PingFang SC', 'Microsoft YaHei', sans-serif; -webkit-font-smoothing: antialiased;
}
.serif { font-family: var(--serif); }
.grain { position: fixed; inset: 0; z-index: 0; pointer-events: none; opacity: .5; mix-blend-mode: multiply;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.8' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.045'/%3E%3C/svg%3E"); }
.warp { position: fixed; inset: 0; z-index: 0; pointer-events: none;
  background-image: linear-gradient(var(--line-2) 1px, transparent 1px), linear-gradient(90deg, var(--line-2) 1px, transparent 1px);
  background-size: 30px 30px; mask-image: radial-gradient(130% 100% at 50% 0%, #000 28%, transparent 80%); }

.ai-page { position: relative; z-index: 1; height: 100%; display: flex; flex-direction: column; padding: 22px 26px 24px; gap: 16px; box-sizing: border-box; }

.edict { display: flex; align-items: center; gap: 14px; padding: 12px 16px; background: var(--card); border: 1px solid var(--line); border-radius: 12px; box-shadow: 0 10px 30px -20px rgba(60,46,24,.5); }
.tag { flex: none; font-size: 14px; color: #fff; background: var(--cinnabar); padding: 6px 13px; border-radius: 6px; letter-spacing: 2px; }
.task-in { flex: 1; min-width: 0; border: none; background: transparent; font-size: 15px; color: var(--ink); outline: none; font-family: inherit; }
.task-in::placeholder { color: var(--ink-3); }
.task-in:disabled { opacity: .7; }
.cast { flex: none; cursor: pointer; border: 1px solid var(--brass); color: var(--ink); background: rgba(168,130,60,.14); font-size: 14px; padding: 8px 16px; border-radius: 8px; letter-spacing: 1px; transition: all .18s; }
.cast:hover:not(:disabled) { background: var(--brass); color: #fff; }
.cast:disabled { opacity: .45; cursor: default; }
.seal { flex: none; }
.seal svg { width: 42px; height: 42px; }
.seal rect { fill: none; stroke: var(--cinnabar); stroke-width: 1.6; }
.seal text { fill: var(--cinnabar); font-family: var(--serif); font-size: 14px; font-weight: 600; text-anchor: middle; }

.stage { flex: 1; min-height: 0; display: grid; grid-template-columns: 1fr 392px; gap: 18px; }

.loom { display: flex; flex-direction: column; min-height: 0; background: var(--card); border: 1px solid var(--line); border-radius: 14px; padding: 18px 20px; box-shadow: 0 12px 36px -22px rgba(60,46,24,.5); }
.loom-head { display: flex; justify-content: space-between; align-items: baseline; }
.loom-head h3 { margin: 0; font-size: 17px; font-weight: 600; letter-spacing: 1px; }
.prog { font-size: 12.5px; color: var(--ink-3); font-variant-numeric: tabular-nums; display: inline-flex; align-items: center; gap: 8px; }
.live { font-size: 11px; padding: 2px 8px; border-radius: 5px; background: rgba(28,26,23,.07); color: var(--ink-3); letter-spacing: .5px; }
.live.on { background: rgba(94,130,104,.16); color: var(--celadon); }

.constellation { flex: 1; position: relative; min-height: 380px; margin: 6px 0; }
.wires { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; }
.link { fill: none; stroke: rgba(28,26,23,.14); stroke-width: 1.2; vector-effect: non-scaling-stroke; transition: stroke .5s; }
.link.flow { stroke: var(--brass); stroke-width: 1.6; stroke-dasharray: 3 5; vector-effect: non-scaling-stroke; animation: dash .6s linear infinite; }
.link.on { stroke: var(--brass-2); stroke-width: 1.4; vector-effect: non-scaling-stroke; }
@keyframes dash { to { stroke-dashoffset: -8; } }

.node { position: absolute; transform: translate(-50%, -50%); display: flex; flex-direction: column; align-items: center; gap: 7px; width: calc(var(--ns, 64px) + 34px); }
.seal-c { position: relative; width: var(--ns, 64px); height: var(--ns, 64px); display: grid; place-items: center; border-radius: 50%; background: radial-gradient(circle at 50% 36%, #fff, var(--card)); }
.seal-c .ring { position: absolute; inset: 0; width: 100%; height: 100%; transform: rotate(-90deg); }
.seal-c .ring circle { fill: none; stroke: rgba(28,26,23,.18); stroke-width: 1.4; stroke-dasharray: 2.5 3; }
.ch { font-size: calc(var(--ns, 64px) * .4); color: var(--ink-3); transition: color .4s; z-index: 1; }
.tick { position: absolute; top: -2px; right: -2px; width: 19px; height: 19px; border-radius: 50%; background: var(--celadon); color: #fff; font-size: 11px; display: grid; place-items: center; opacity: 0; transform: scale(.4); transition: all .3s; }
.nlabel { font-size: 12px; color: var(--ink-2); text-align: center; line-height: 1.3; font-weight: 500; }
.nlabel i { display: block; font-style: normal; font-size: 9px; letter-spacing: 1px; color: var(--ink-3); opacity: .7; margin-top: 1px; }

.node.idle .seal-c { box-shadow: 0 4px 14px -8px rgba(60,46,24,.5); }
.node.work .seal-c { box-shadow: 0 0 0 1.5px var(--brass), 0 8px 22px -8px rgba(168,130,60,.7); animation: breathe 1.5s ease-in-out infinite; }
.node.work .ch { color: var(--ink); }
.node.work .ring { animation: spin 2.2s linear infinite; }
.node.work .ring circle { stroke: var(--brass); stroke-dasharray: 28 100; stroke-width: 1.8; }
.node.done .seal-c { box-shadow: 0 0 0 1.5px var(--brass-2), 0 8px 20px -10px rgba(168,130,60,.5); }
.node.done .ch { color: var(--ink); }
.node.done .ring circle { stroke: var(--brass-2); stroke-dasharray: none; stroke-width: 1.4; }
.node.done .tick { opacity: 1; transform: scale(1); }

.node.orch { width: 106px; }
.node.orch .seal-c { width: 72px; height: 72px; background: radial-gradient(circle at 50% 34%, #fff, #F3E7DD); }
.node.orch .ch { font-size: 30px; color: var(--cinnabar); }
.node.orch.work .seal-c { box-shadow: 0 0 0 1.5px var(--cinnabar), 0 10px 26px -8px rgba(178,58,46,.55); animation: breathe 1.8s ease-in-out infinite; }
.node.orch.work .ring { animation: spin 3s linear infinite; }
.node.orch.work .ring circle { stroke: var(--cinnabar); stroke-dasharray: 32 120; stroke-width: 1.8; }
.node.orch.done .seal-c { box-shadow: 0 0 0 1.5px var(--cinnabar), 0 8px 20px -10px rgba(178,58,46,.4); }

@keyframes breathe { 0%,100% { transform: scale(1); } 50% { transform: scale(1.05); } }
@keyframes spin { to { transform: rotate(270deg); } }

.hint { position: absolute; left: 50%; top: 56%; transform: translateX(-50%); text-align: center; width: 86%; }
.hint p { margin: 0 0 14px; font-size: 16px; color: var(--ink-2); letter-spacing: 1px; }
.presets { display: flex; flex-wrap: wrap; gap: 9px; justify-content: center; }
.presets button { cursor: pointer; border: 1px solid var(--line); background: var(--paper); color: var(--ink-2); font-size: 12.5px; padding: 8px 14px; border-radius: 20px; font-family: inherit; transition: all .18s; }
.presets button:hover { border-color: var(--brass); color: var(--ink); background: rgba(168,130,60,.08); }

.loom-foot { display: flex; align-items: center; gap: 16px; padding-top: 10px; border-top: 1px solid var(--line-2); font-size: 11.5px; color: var(--ink-3); }
.lg { display: inline-flex; align-items: center; gap: 6px; }
.lg .d { width: 8px; height: 8px; border-radius: 50%; }
.d.idle { background: rgba(28,26,23,.2); } .d.work { background: var(--brass); } .d.done { background: var(--brass-2); box-shadow: 0 0 0 2px rgba(201,163,91,.25); }
.orch-tip { margin-left: auto; font-style: italic; opacity: .8; }

.scroll { overflow: auto; display: flex; flex-direction: column; gap: 12px; padding-right: 4px; }
.scroll::-webkit-scrollbar { width: 6px; } .scroll::-webkit-scrollbar-thumb { background: rgba(28,26,23,.16); border-radius: 3px; }
.minutes-head { font-size: 14px; font-weight: 600; letter-spacing: 2px; color: var(--ink-2); }
.minutes { display: flex; flex-direction: column; gap: 10px; }
.bubble { padding: 12px 14px; border-radius: 11px; background: var(--card); border: 1px solid var(--line); box-shadow: 0 8px 22px -18px rgba(60,46,24,.5); }
.bubble .who { display: flex; align-items: center; gap: 9px; font-size: 12.5px; font-weight: 600; color: var(--ink); margin-bottom: 6px; }
.bubble .mk { width: 22px; height: 22px; border-radius: 6px; display: grid; place-items: center; font-size: 13px; background: rgba(168,130,60,.13); color: var(--brass); }
.bubble p { margin: 0; font-size: 13px; line-height: 1.7; color: var(--ink-2); }
.bubble.orch { border-color: rgba(178,58,46,.28); background: linear-gradient(180deg, rgba(178,58,46,.05), var(--card)); }
.bubble.orch .mk { background: rgba(178,58,46,.13); color: var(--cinnabar); }

.report { margin-top: 4px; padding: 18px; border-radius: 13px; background: var(--card); border: 1px solid var(--brass); box-shadow: 0 16px 40px -24px rgba(168,130,60,.8); }
.rep-head { margin-bottom: 12px; }
.rep-kicker { font-size: 11px; letter-spacing: 2px; color: var(--brass); }
.rep-head h4 { margin: 3px 0 0; font-size: 18px; font-weight: 600; letter-spacing: .5px; }
.rep-sum { margin: 0 0 14px; font-size: 12.5px; line-height: 1.85; color: var(--ink-2); padding: 12px 14px; border-left: 2px solid var(--brass); background: rgba(168,130,60,.05); border-radius: 0 8px 8px 0; }
.rep-sub { font-size: 12.5px; color: var(--brass); margin: 12px 0 8px; }
.rep-table { width: 100%; border-collapse: collapse; font-size: 12px; }
.rep-table th { text-align: left; color: var(--ink-3); font-weight: 500; padding: 7px 8px; border-bottom: 1px solid var(--line); font-size: 11.5px; }
.rep-table td { padding: 8px; border-bottom: 1px solid var(--line-2); color: var(--ink-2); }
.rep-table td.num { font-variant-numeric: tabular-nums; color: var(--ink); }
.rep-chart { height: 168px; margin-top: 4px; }
.rep-conc { margin-top: 12px; padding: 10px 14px; background: rgba(178,58,46,.05); border-radius: 8px; font-size: 13px; color: var(--cinnabar); }
.sign { display: flex; align-items: center; gap: 9px; margin-top: 14px; padding-top: 12px; border-top: 1px solid var(--line-2); font-size: 11.5px; color: var(--ink-3); }
.seal-mini { width: 34px; height: 22px; border: 1px solid var(--cinnabar); color: var(--cinnabar); border-radius: 4px; display: grid; place-items: center; font-size: 11px; letter-spacing: 1px; }

.fade { animation: fadeUp .6s cubic-bezier(.22,.61,.36,1) both; }
@keyframes fadeUp { from { opacity: 0; transform: translateY(11px); } to { opacity: 1; transform: none; } }
.rise-enter-active { transition: all .45s cubic-bezier(.22,.61,.36,1); }
.rise-enter-from { opacity: 0; transform: translateY(12px); }
.report-enter-active { transition: all .6s cubic-bezier(.22,.61,.36,1); }
.report-enter-from { opacity: 0; transform: translateY(18px); }

@media (max-width: 768px) {
  .stage { grid-template-columns: 1fr; }
}
</style>
