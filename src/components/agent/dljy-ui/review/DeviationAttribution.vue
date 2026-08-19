<script setup lang="ts">
// review/DeviationAttribution —— 偏差归因分解（Epic #2033 · #2038 预留位 / #2042 转正消费）
// ---------------------------------------------------------------------------
// dljy-ui artifact 渲染件：偏差总量按成因分解（S1 业务成因四因子 / 周月责任归因二轴，
// 两轴正交不合并——Epic 拍板）。数据由智能体按 quant /review 聚合下发；
// 占比合计应为 1，缺归因部分显式「未归因」，不摊到其它因子假装闭合。
// 责任归因二轴仅周聚合人工补填（AI 只给映射建议）——本渲染件对二轴数据只读呈现。
import { computed } from 'vue'
import { fmt, num, obj } from '../storage/helpers'

const props = defineProps<{ data: Record<string, unknown>; title?: string; basis?: string }>()

type Factor = { label: string; mwh: number; share: number }

const factors = computed<Factor[]>(() => {
  const raw = props.data.factors
  if (!Array.isArray(raw)) return []
  return raw
    .map((r) => {
      const o = obj(r)
      return { label: String(o.label ?? ''), mwh: num(o.mwh, NaN), share: num(o.share, NaN) }
    })
    .filter((f) => f.label && Number.isFinite(f.mwh))
})

const totalMwh = computed(() => num(props.data.totalDeviationMwh, NaN))
/** 未归因 = 总量 − 已归因之和；>0.5% 时显式成行（不假装闭合）。 */
const unattributedMwh = computed(() => {
  if (!Number.isFinite(totalMwh.value)) return NaN
  const sum = factors.value.reduce((a, f) => a + Math.abs(f.mwh), 0)
  return totalMwh.value - sum
})

const rows = computed(() => {
  const base = factors.value.map((f) => ({ ...f, kind: 'factor' as const }))
  if (Number.isFinite(unattributedMwh.value) && unattributedMwh.value > Math.abs(totalMwh.value) * 0.005) {
    const t = Math.abs(totalMwh.value) || 1
    base.push({ label: '未归因（待分析）', mwh: unattributedMwh.value, share: unattributedMwh.value / t, kind: 'factor' as const })
  }
  return base
})
const maxAbs = computed(() => Math.max(1, ...rows.value.map((r) => Math.abs(r.mwh))))
const axisNote = computed(() => (typeof props.data.axisNote === 'string' ? props.data.axisNote : ''))
</script>

<template>
  <section class="da-card">
    <header>
      <h3>{{ title || '偏差归因分解' }}</h3>
      <span>总偏差 {{ Number.isFinite(totalMwh) ? `${fmt(totalMwh)} MWh` : '—' }}</span>
    </header>

    <p v-if="!factors.length && !Number.isFinite(totalMwh)" class="da-empty">
      暂无归因数据：周/月聚合归因由模板七聚合服务产出（#2042），日度四因子归因在 S1 面板。
    </p>

    <template v-else>
      <div class="da-bars">
        <div v-for="r in rows" :key="r.label" class="da-row" :class="{ unatt: r.label.startsWith('未归因') }">
          <span class="da-label">{{ r.label }}</span>
          <div class="da-track">
            <div class="da-bar" :class="r.label.startsWith('未归因') ? 'unatt' : 'factor'" :style="{ width: `${Math.max(6, (Math.abs(r.mwh) / maxAbs) * 100)}%` }" />
          </div>
          <strong>{{ fmt(r.mwh) }} MWh</strong>
          <em>{{ Number.isFinite(r.share) ? `${(r.share * 100).toFixed(1)}%` : '—' }}</em>
        </div>
      </div>
      <p v-if="axisNote" class="da-note">{{ axisNote }}</p>
      <p class="da-note">责任归因（预测不准/突发/策略失误/操作失误）为第二轴，仅周聚合人工补填；与业务成因四因子正交，不合并。</p>
    </template>
  </section>
</template>

<style scoped>
.da-card { border: 1px solid var(--line-soft, #e5e7eb); border-radius: 8px; background: var(--panel, #fff); padding: 14px; }
header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; }
h3 { margin: 0; font-size: var(--font-16); color: var(--text, #111827); }
header span { font-size: var(--font-sm); color: var(--muted, #667085); font-variant-numeric: tabular-nums; }
.da-empty { margin: 4px 0 2px; font-size: var(--font-12-5); line-height: 1.7; color: var(--muted, #667085); }
.da-bars { display: grid; gap: 8px; }
.da-row { display: grid; grid-template-columns: 120px minmax(0, 1fr) 92px 48px; gap: 8px; align-items: center; }
.da-label { font-size: var(--font-sm); color: var(--text-body, #344054); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.da-track { height: 13px; background: rgba(148, 163, 184, 0.16); border-radius: 999px; overflow: hidden; }
.da-bar { height: 100%; border-radius: inherit; }
.da-bar.factor { background: #2563eb; }
.da-bar.unatt { background: #d97706; }
strong { text-align: right; font-size: var(--font-sm); color: var(--text, #111827); font-variant-numeric: tabular-nums; }
em { font-style: normal; font-size: var(--font-xs); color: var(--muted, #667085); text-align: right; font-variant-numeric: tabular-nums; }
.da-note { margin: 10px 0 0; font-size: var(--font-xs); line-height: 1.6; color: var(--muted, #667085); }
</style>
