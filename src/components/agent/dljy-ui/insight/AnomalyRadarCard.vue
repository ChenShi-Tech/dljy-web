<script setup lang="ts">
// 异动雷达卡（insight · Neon）：消费 bundle.blocks.anomalies，按 severity 呈现情报流 + 呼吸灯。
// 异动由后端 _derive_anomalies 确定性派生（负价/限价逼近/价差异常/弹性陡变），不靠 LLM。
import { computed } from 'vue'
import { arr, num, obj, str } from '../storage/helpers'

const props = defineProps<{ data: Record<string, unknown>; title?: string; basis?: string }>()

const TYPE_LABEL: Record<string, string> = {
  negative_price: '负电价', limit_approach: '限价逼近', spread_outlier: '价差异常', elasticity_steep: '弹性陡变'
}
const SEV: Record<string, { label: string; cls: string }> = {
  high: { label: '高', cls: 'high' }, mid: { label: '中', cls: 'mid' }, low: { label: '低', cls: 'low' }
}

type Row = { type: string; typeLabel: string; sevMeta: { label: string; cls: string }; time: string; message: string }

const items = computed<Row[]>(() => {
  const raw = arr(props.data.anomalies ?? props.data.items ?? props.data)
  return raw.map((r) => {
    const o = obj(r)
    const sev = str(o.severity, 'mid')
    return {
      type: str(o.type),
      typeLabel: TYPE_LABEL[str(o.type)] ?? str(o.type, '异动'),
      sevMeta: SEV[sev] ?? SEV.mid,
      time: str(o.time),
      message: str(o.message, `${num(o.value)} / 阈值 ${num(o.threshold)}`)
    }
  })
})
</script>

<template>
  <section class="mic-radar">
    <header>
      <h3>{{ title || '异动雷达' }}</h3>
      <span class="sub">{{ items.length ? `${items.length} 项异动` : '异动扫描' }}</span>
    </header>
    <ul v-if="items.length" class="flow">
      <li v-for="(it, i) in items" :key="i" class="row" :class="it.sevMeta.cls">
        <span class="beacon"></span>
        <div class="body">
          <div class="line1">
            <span class="type">{{ it.typeLabel }}</span>
            <span class="sev" :class="it.sevMeta.cls">{{ it.sevMeta.label }}</span>
            <span v-if="it.time" class="time">{{ it.time }}</span>
          </div>
          <p class="msg">{{ it.message }}</p>
        </div>
      </li>
    </ul>
    <div v-else class="empty"><span class="ok-dot"></span> 暂无异动事件</div>
  </section>
</template>

<style scoped>
.mic-radar { border: 1px solid var(--line-soft, #e5e7eb); border-radius: 12px; background: var(--panel, #fff); padding: 14px; }
header { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; margin-bottom: 10px; }
h3 { margin: 0; font-size: var(--font-15-5); color: var(--text, #111827); }
.sub { font-size: var(--font-11-5); color: var(--muted, #667085); }
.flow { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 9px; }
.row { display: flex; gap: 10px; padding: 9px 11px; border-radius: 10px; background: var(--panel-sub, #f8fafc); border: 1px solid var(--line-soft, #e5e7eb); }
.row.high { box-shadow: inset 3px 0 0 var(--danger, #fb7185); }
.row.mid { box-shadow: inset 3px 0 0 var(--warning, #fbbf24); }
.row.low { box-shadow: inset 3px 0 0 var(--primary, #22d3ee); }
.beacon { width: 9px; height: 9px; border-radius: 50%; flex: none; margin-top: 4px; animation: mic-pulse 1.6s infinite; }
.row.high .beacon { background: var(--danger, #fb7185); box-shadow: 0 0 10px var(--danger, #fb7185); }
.row.mid .beacon { background: var(--warning, #fbbf24); box-shadow: 0 0 10px var(--warning, #fbbf24); }
.row.low .beacon { background: var(--primary, #22d3ee); box-shadow: 0 0 10px var(--primary, #22d3ee); }
.body { min-width: 0; }
.line1 { display: flex; align-items: center; gap: 8px; }
.type { font-size: var(--font-md); font-weight: 600; color: var(--text, #111827); }
.sev { font-size: var(--font-10-5); padding: 0 7px; border-radius: 999px; }
.sev.high { color: var(--danger, #e11d48); background: var(--danger-tint, rgba(251, 113, 133, .16)); }
.sev.mid { color: var(--warning, #b45309); background: var(--warning-tint, rgba(251, 191, 36, .18)); }
.sev.low { color: var(--primary, #0891b2); background: var(--primary-tint, rgba(34, 211, 238, .16)); }
.time { font-size: var(--font-xs); color: var(--muted, #98a2b3); font-variant-numeric: tabular-nums; }
.msg { margin: 3px 0 0; font-size: var(--font-12-5); color: var(--text-body, #344054); line-height: 1.5; }
.empty { display: flex; align-items: center; gap: 9px; padding: 16px 12px; color: var(--muted, #98a2b3); font-size: var(--font-md); }
.ok-dot { width: 9px; height: 9px; border-radius: 50%; background: var(--success, #4ade80); box-shadow: 0 0 10px var(--success, #4ade80); animation: mic-pulse 1.6s infinite; }
@keyframes mic-pulse { 0%, 100% { opacity: 1; } 50% { opacity: .35; } }
</style>
