<script setup lang="ts">
// 顶栏现货参考价带：当前时段徽标 + 最新价 + 环比（红涨绿跌）+ 24点走势火花线。
// 数据优先取回放服务出清价；不可用时退化为按时段形态的模拟序列（标注"演示"）。
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { fetchRaw, timeoutSignal } from '@/services/api'
import { periodLabel, themeState } from '@/services/theme'

type Pt = { t: number; v: number }

const series = ref<Pt[]>([])
const isDemo = ref(false)
const pulse = ref(false)
let timer: number | undefined

const latest = computed(() => series.value[series.value.length - 1]?.v ?? 0)
const prev = computed(() => series.value[series.value.length - 2]?.v ?? latest.value)
const delta = computed(() => latest.value - prev.value)
const deltaPct = computed(() => (prev.value ? (delta.value / prev.value) * 100 : 0))

// 模拟序列：双峰日内形态 + 时间种子扰动（与后端合成逻辑同形）
function synthPoint(date: Date): number {
  const h = date.getHours() + date.getMinutes() / 60
  const shape =
    Math.sin(((h - 6) / 24) * 2 * Math.PI) * 0.6 +
    Math.exp(-((h - 11) ** 2) / 8) * 0.5 +
    Math.exp(-((h - 19) ** 2) / 6) * 0.8
  const noise = Math.sin(date.getDate() * 7 + h * 3.1) * 0.08
  return Math.round((420 + 180 * (shape + noise)) * 100) / 100
}

function buildSynthetic(): Pt[] {
  const now = Date.now()
  const pts: Pt[] = []
  for (let i = 23; i >= 0; i--) {
    const t = now - i * 15 * 60 * 1000
    pts.push({ t, v: synthPoint(new Date(t)) })
  }
  return pts
}

async function load() {
  try {
    const res = await fetchRaw('/real', { family: 'sdpt_zcqxhdl' }, { signal: timeoutSignal(4000) })
    if (res.ok) {
      const data = await res.json()
      const flat: number[] = []
      const walk = (n: unknown) => {
        if (Array.isArray(n)) n.forEach(walk)
        else if (n && typeof n === 'object') Object.values(n).forEach(walk)
        else if (typeof n === 'number' && n > 10 && n < 5000) flat.push(n)
      }
      walk(data)
      if (flat.length >= 24) {
        const now = Date.now()
        series.value = flat.slice(-24).map((v, i) => ({ t: now - (23 - i) * 15 * 60 * 1000, v }))
        isDemo.value = false
        flash()
        return
      }
    }
  } catch {
    /* 回放服务不可用 → 模拟 */
  }
  series.value = buildSynthetic()
  isDemo.value = true
  flash()
}

function flash() {
  pulse.value = true
  setTimeout(() => (pulse.value = false), 950)
}

// 火花线 path（120×26 视窗）
const sparkPath = computed(() => {
  const pts = series.value
  if (pts.length < 2) return ''
  const vs = pts.map((p) => p.v)
  const min = Math.min(...vs)
  const span = Math.max(1e-6, Math.max(...vs) - min)
  return pts
    .map((p, i) => {
      const x = (i / (pts.length - 1)) * 120
      const y = 24 - ((p.v - min) / span) * 22 + 1
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')
})

onMounted(() => {
  load()
  timer = window.setInterval(load, 30_000)
})
onBeforeUnmount(() => window.clearInterval(timer))
</script>

<template>
  <div class="price-ticker" :class="{ 'arc-pulse': pulse }" :title="isDemo ? '演示数据（回放服务未连接）' : '现货出清参考价'">
    <span class="pt-period">{{ periodLabel[themeState.period] }}</span>
    <span class="pt-price">{{ latest.toFixed(1) }}<span class="pt-unit"> 元/MWh{{ isDemo ? '·演示' : '' }}</span></span>
    <span class="pt-delta" :class="delta >= 0 ? 'num-up' : 'num-down'">
      {{ delta >= 0 ? '▲' : '▼' }}{{ Math.abs(deltaPct).toFixed(2) }}%
    </span>
    <svg width="120" height="26" viewBox="0 0 120 26" aria-hidden="true">
      <path :d="sparkPath" fill="none" stroke="var(--period-accent, #38bdf8)" stroke-width="1.6" stroke-linejoin="round" />
    </svg>
  </div>
</template>
