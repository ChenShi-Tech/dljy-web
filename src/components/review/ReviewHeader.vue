<script setup lang="ts">
// 复盘中心头部（#2038）：标题 · 地区 · 日期步进 · 周期 · 状态徽标 · ⚙ 考核参数 · 生成报告。
// 参数不进门面：免考核带/考核单价/规则版本收进 ⚙ 弹层；模拟/覆盖区/降级只以徽标出现。
import { ref } from 'vue'
import { ChevronLeft, ChevronRight, Settings2, Sparkles } from 'lucide-vue-next'
import { shiftDate } from '@/services/review/reviewDashboard'

export type HeaderBadge = { text: string; tone: 'ok' | 'warn' | 'info' | 'danger' | 'off'; title?: string }

const props = withDefaults(
  defineProps<{
    date: string
    regionLabel: string
    tolerancePct: number
    penaltyPrice: number
    /** 规则版本文案（如 shanxi-draft-0.1 · 草稿）；空 = 未参数化 */
    ruleLabel: string
    badges?: HeaderBadge[]
    generating?: boolean
  }>(),
  { badges: () => [], generating: false }
)
const emit = defineEmits<{
  (e: 'update:date', v: string): void
  (e: 'update:tolerancePct', v: number): void
  (e: 'update:penaltyPrice', v: number): void
  (e: 'generate'): void
}>()

const paramsOpen = ref(false)

function step(days: number) {
  emit('update:date', shiftDate(props.date, days))
}
function onDateInput(ev: Event) {
  const v = (ev.target as HTMLInputElement).value
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) emit('update:date', v)
}
function onNumber(ev: Event, key: 'tolerancePct' | 'penaltyPrice') {
  const v = Number((ev.target as HTMLInputElement).value)
  if (!Number.isFinite(v) || v < 0) return
  if (key === 'tolerancePct') emit('update:tolerancePct', v)
  else emit('update:penaltyPrice', v)
}
</script>

<template>
  <header class="hd">
    <h1>复盘中心</h1>
    <span class="chip region">{{ regionLabel }}</span>

    <span class="stepper">
      <button type="button" aria-label="前一天" @click="step(-1)"><ChevronLeft :size="14" /></button>
      <input class="d" type="date" :value="date" aria-label="复盘日期" @change="onDateInput" />
      <button type="button" aria-label="后一天" @click="step(1)"><ChevronRight :size="14" /></button>
    </span>

    <!-- 周/月聚合随 M2（#2042）上线；此处先占位置、禁用不假装 -->
    <span class="seg" role="group" aria-label="周期">
      <button type="button" aria-pressed="true">日</button>
      <button type="button" aria-pressed="false" disabled title="周度聚合尚未上线">周</button>
      <button type="button" aria-pressed="false" disabled title="月度聚合尚未上线">月</button>
    </span>

    <span v-for="(b, i) in badges" :key="i" class="badge" :class="b.tone" :title="b.title">{{ b.text }}</span>

    <span class="sp" />

    <el-popover v-model:visible="paramsOpen" placement="bottom-end" :width="260" trigger="click" popper-class="review-params-pop">
      <template #reference>
        <button type="button" class="icon-btn" aria-label="考核参数" :aria-expanded="paramsOpen">
          <Settings2 :size="15" />
        </button>
      </template>
      <div class="params">
        <label><span>免考核带</span><span class="in"><input type="number" min="0" max="50" step="0.5" :value="tolerancePct" @change="onNumber($event, 'tolerancePct')" /> %</span></label>
        <label><span>考核单价</span><span class="in"><input type="number" min="0" step="1" :value="penaltyPrice" @change="onNumber($event, 'penaltyPrice')" /> 元/MWh</span></label>
        <div class="rule"><span>规则版本</span><b :class="{ none: !ruleLabel }">{{ ruleLabel || '未参数化 · 通用默认' }}</b></div>
      </div>
    </el-popover>

    <button type="button" class="btn-primary" :disabled="generating" @click="emit('generate')">
      <Sparkles :size="13" /> {{ generating ? '生成中…' : '生成报告' }}
    </button>
  </header>
</template>

<style scoped>
.hd { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; min-height: 34px; }
h1 { margin: 0 6px 0 0; font-size: var(--font-xl); font-weight: 650; letter-spacing: -0.01em; }
.sp { flex: 1; }

.chip, .stepper, .seg, .icon-btn {
  height: 28px; border: 1px solid var(--line); border-radius: var(--radius-sm); background: var(--panel);
}
.chip { display: inline-flex; align-items: center; padding: 0 10px; font-size: var(--font-md); color: var(--text-body); white-space: nowrap; }

.stepper { display: inline-flex; overflow: hidden; }
.stepper button {
  width: 28px; border: 0; background: transparent; color: var(--muted); display: grid; place-items: center; cursor: pointer;
}
.stepper button:hover { background: var(--panel-sub); color: var(--text); }
.stepper .d {
  border: 0; border-left: 1px solid var(--line-soft); border-right: 1px solid var(--line-soft);
  padding: 0 8px; background: transparent; color: var(--text); font: inherit; font-size: var(--font-12-5);
  font-family: ui-monospace, monospace; height: 100%;
}

.seg { display: inline-flex; overflow: hidden; }
.seg button {
  padding: 0 12px; border: 0; background: transparent; color: var(--muted); font: inherit; font-size: var(--font-md);
  border-right: 1px solid var(--line-soft); cursor: pointer;
}
.seg button:last-child { border-right: 0; }
.seg button[aria-pressed='true'] { background: var(--primary-tint); color: var(--primary-strong); font-weight: 600; }
.seg button:disabled { cursor: not-allowed; opacity: 0.55; }

.badge {
  position: relative; display: inline-flex; align-items: center; height: 20px; padding: 0 8px; border-radius: 999px;
  font-size: var(--font-tb-11); font-weight: 600; white-space: nowrap; isolation: isolate;
}
.badge::before { content: ''; position: absolute; inset: 0; border-radius: inherit; background: currentColor; opacity: 0.12; z-index: -1; }
.badge.ok { color: var(--success); }
.badge.warn { color: var(--warning); }
.badge.info { color: var(--accent); }
.badge.danger { color: var(--danger); }
.badge.off { color: var(--muted); font-weight: 500; }

.icon-btn { width: 28px; color: var(--muted); display: grid; place-items: center; cursor: pointer; }
.icon-btn:hover { color: var(--text); }

.btn-primary {
  height: 28px; padding: 0 12px; border: 0; border-radius: var(--radius-sm); cursor: pointer;
  background: var(--primary); color: #fff; font: inherit; font-weight: 600; font-size: var(--font-md);
  display: inline-flex; align-items: center; gap: 6px;
}
.btn-primary:hover { background: var(--primary-strong); }
.btn-primary:disabled { opacity: 0.6; cursor: default; }

.params { display: flex; flex-direction: column; gap: 9px; font-size: var(--font-12-5); color: var(--text-body); }
.params label, .params .rule { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.params .in { display: inline-flex; align-items: center; gap: 5px; }
.params input {
  width: 72px; height: 26px; padding: 0 8px; text-align: right; font: inherit; font-size: var(--font-12-5);
  border: 1px solid var(--line); border-radius: var(--radius-sm); background: var(--panel-sub); color: var(--text);
  font-variant-numeric: tabular-nums;
}
.params .rule b { font-family: ui-monospace, monospace; font-size: var(--font-xs); font-weight: 600; color: var(--warning); }
.params .rule b.none { color: var(--muted); font-weight: 500; }
</style>
