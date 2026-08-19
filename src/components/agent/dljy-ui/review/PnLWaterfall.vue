<script setup lang="ts">
// review/PnLWaterfall —— 收益三层拆解瀑布（Epic #2033 · #2038 预留位 / #2043 转正消费）
// ---------------------------------------------------------------------------
// dljy-ui artifact 渲染件：分品种/分时段/单笔的收益拆解结构（后端成文走 generate_report，
// 分层数据由智能体按 backtest_declaration + settlement-review 聚合后下发）。
// 金额一律 self-computed 口径（结算细则未核验），caliber 注脚必须随图带出。
// 空/缺数据诚实呈现：没有 segments 就说没有，不画假柱。
import { computed } from 'vue'
import { fmt, num, obj } from '../storage/helpers'

const props = defineProps<{ data: Record<string, unknown>; title?: string; basis?: string }>()

type Seg = { label: string; valueYuan: number; kind: 'gain' | 'cost' | 'total' }

const segments = computed<Seg[]>(() => {
  const raw = props.data.segments
  if (!Array.isArray(raw)) return []
  return raw
    .map((r) => {
      const o = obj(r)
      const kind: Seg['kind'] = o.kind === 'cost' || o.kind === 'total' ? o.kind : 'gain'
      const value = num(o.valueYuan, NaN)
      return { label: String(o.label ?? ''), valueYuan: value, kind }
    })
    .filter((s) => s.label && Number.isFinite(s.valueYuan))
})

const totalYuan = computed(() => {
  const t = num(props.data.totalYuan, NaN)
  return Number.isFinite(t) ? t : NaN
})
const caliber = computed(() => {
  const c = props.data.caliber
  return typeof c === 'string' && c ? c : 'self-computed'
})
const note = computed(() => (typeof props.data.note === 'string' ? props.data.note : ''))
const maxAbs = computed(() => Math.max(1, ...segments.value.map((s) => Math.abs(s.valueYuan))))
</script>

<template>
  <section class="pw-card">
    <header>
      <h3>{{ title || '收益拆解瀑布' }}</h3>
      <span>元 · 口径 {{ caliber }}</span>
    </header>

    <p v-if="!segments.length" class="pw-empty">
      暂无拆解数据：三层拆解（分品种/分时段/单笔 Top5）由月度聚合服务产出（#2043），
      未生成前不画示意柱。
    </p>

    <template v-else>
      <div class="pw-bars">
        <div v-for="s in segments" :key="s.label" class="pw-row">
          <span class="pw-label">{{ s.label }}</span>
          <div class="pw-track">
            <div class="pw-bar" :class="s.kind" :style="{ width: `${Math.max(6, (Math.abs(s.valueYuan) / maxAbs) * 100)}%` }" />
          </div>
          <strong :class="{ neg: s.valueYuan < 0 }">{{ fmt(s.valueYuan, 0) }}</strong>
        </div>
        <div v-if="Number.isFinite(totalYuan)" class="pw-row pw-total">
          <span class="pw-label">合计</span>
          <div class="pw-track">
            <div class="pw-bar total" :style="{ width: `${Math.max(6, (Math.abs(totalYuan) / maxAbs) * 100)}%` }" />
          </div>
          <strong :class="{ neg: totalYuan < 0 }">{{ fmt(totalYuan, 0) }}</strong>
        </div>
      </div>
      <p v-if="note" class="pw-note">{{ note }}</p>
      <p class="pw-note">金额为平台自算口径（结算细则未核验），不可作为结算依据。</p>
    </template>
  </section>
</template>

<style scoped>
.pw-card { border: 1px solid var(--line-soft, #e5e7eb); border-radius: 8px; background: var(--panel, #fff); padding: 14px; }
header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; }
h3 { margin: 0; font-size: var(--font-16); color: var(--text, #111827); }
header span { font-size: var(--font-sm); color: var(--muted, #667085); }
.pw-empty { margin: 4px 0 2px; font-size: var(--font-12-5); line-height: 1.7; color: var(--muted, #667085); }
.pw-bars { display: grid; gap: 8px; }
.pw-row { display: grid; grid-template-columns: 96px minmax(0, 1fr) 92px; gap: 10px; align-items: center; }
.pw-label { font-size: var(--font-sm); color: var(--text-body, #344054); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pw-track { height: 13px; background: rgba(148, 163, 184, 0.16); border-radius: 999px; overflow: hidden; }
.pw-bar { height: 100%; border-radius: inherit; }
.pw-bar.gain { background: #16a34a; }
.pw-bar.cost { background: #dc2626; }
.pw-bar.total { background: #2563eb; }
strong { text-align: right; font-size: var(--font-12-5); color: var(--text, #111827); font-variant-numeric: tabular-nums; }
strong.neg { color: #b91c1c; }
.pw-total .pw-label { font-weight: 600; }
.pw-note { margin: 10px 0 0; font-size: var(--font-xs); line-height: 1.6; color: var(--muted, #667085); }
</style>
