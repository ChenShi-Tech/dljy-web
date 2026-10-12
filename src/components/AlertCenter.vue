<script setup lang="ts">
// 盯盘告警中心：固定在右上角的铃铛 + 徽章数 + 下拉面板。轮询 /api/agent/alerts，
// 支持「扫描今日」（按当前地区扫实时vs日前价差异动）与逐条消除。贴合现货实时风控。
import { ref, onBeforeUnmount, computed, watch } from 'vue'
import { Bell, Trash2 } from 'lucide-vue-next'
import { ElMessage, ElMessageBox } from 'element-plus'
import { listAlerts, scanAlerts, dismissAlert, clearAllAlerts, type Alert } from '@/services/alertClient'
import { currentRegion } from '@/services/region/regionContext'
import { onRegionChange } from '../composables/useRegionReload'
import DataBasisBadge from './DataBasisBadge.vue'
import type { DataBasis } from '@/services/dataBasis'

const alerts = ref<Alert[]>([])
const open = ref(false)
const scanning = ref(false)
let timer: number | undefined

const count = computed(() => alerts.value.length)

function todayISO() {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

async function refresh() {
  // listAlerts 失败抛错（告警链路不可用不得冒充「无告警」）；顶栏角标保持静默——
  // 保留旧值不打断页面，风控页等其他消费方自行按失败呈现。
  try {
    alerts.value = (await listAlerts()).alerts
  } catch {
    /* 后端离线：保留上一次告警值 */
  }
}
async function scanNow() {
  scanning.value = true
  const r = await scanAlerts(todayISO(), currentRegion.value.id, currentRegion.value.name)
  scanning.value = false
  if (r.ok) {
    ElMessage.success(r.created ? `新增 ${r.created} 条告警` : '未发现价差异动')
    await refresh()
  } else {
    ElMessage.error(`扫描失败：${r.msg ?? '智能体后端未运行？'}`)
  }
}
async function dismiss(a: Alert) {
  if (await dismissAlert(a.id)) alerts.value = alerts.value.filter((x) => x.id !== a.id)
}

const clearing = ref(false)
async function clearAll() {
  try {
    await ElMessageBox.confirm('确定清空全部告警？此操作不可撤销。', '清空告警', {
      type: 'warning', confirmButtonText: '清空', cancelButtonText: '取消'
    })
  } catch {
    return // 用户取消
  }
  clearing.value = true
  const ok = await clearAllAlerts()
  clearing.value = false
  if (ok) {
    ElMessage.success('已清空全部告警')
    await refresh()
  } else {
    ElMessage.error('清空失败（智能体后端未运行？）')
  }
}

watch(open, (visible) => {
  if (!visible) {
    if (timer) window.clearInterval(timer)
    timer = undefined
    return
  }
  refresh()
  if (!timer) timer = window.setInterval(refresh, 60000)
})
onBeforeUnmount(() => {
  if (timer) clearInterval(timer)
})
// 切换全局地区：立即按新地区刷新告警（listAlerts 经 identityHeaders 带 x-region-id，
// 后端按地区过滤），使铃铛徽章数与面板反映当前地区，不滞留旧地区告警。
onRegionChange(() => { void refresh() })
</script>

<template>
  <div class="ac-wrap">
    <button class="ac-bell" :class="{ active: count }" title="盯盘告警" @click="open = !open">
      <Bell :size="17" />
      <span v-if="count" class="ac-badge">{{ count > 99 ? '99+' : count }}</span>
    </button>
    <transition name="ac-fade">
      <div v-if="open" class="ac-panel">
        <header class="ac-head">
          <span class="ac-h-title">盯盘告警 <span class="ac-cnt">{{ count }}</span></span>
          <div class="ac-head-actions">
            <button v-if="count" class="ac-clear" :disabled="clearing" @click="clearAll">
              <Trash2 :size="13" />{{ clearing ? '清理中…' : '清空全部' }}
            </button>
            <button class="ac-scan" :disabled="scanning" @click="scanNow">{{ scanning ? '扫描中…' : '扫描今日' }}</button>
          </div>
        </header>
        <div v-if="!count" class="ac-empty">暂无未处理告警。点「扫描今日」检查实时与日前价差异动。</div>
        <ul v-else class="ac-list">
          <li v-for="a in alerts" :key="a.id" class="ac-item">
            <div class="ac-item-top">
              <span class="ac-sev" :class="a.severity">{{ a.severity === 'high' ? '高' : a.severity === 'medium' ? '中' : '低' }}</span>
              <span class="ac-title">{{ a.title }}</span>
              <button class="ac-x" title="消除" @click="dismiss(a)">×</button>
            </div>
            <div class="ac-detail">{{ a.detail }}</div>
            <DataBasisBadge v-if="a.basis" :basis="(a.basis as DataBasis)" class="ac-basis" />
          </li>
        </ul>
      </div>
    </transition>
  </div>
</template>

<style scoped>
.ac-wrap { position: relative; display: inline-flex; }
.ac-bell {
  position: relative; width: 38px; height: 38px; border-radius: 50%;
  border: 1px solid var(--line, #d9e2ec); background: var(--panel, #fff);
  color: var(--muted, #667085); cursor: pointer; display: grid; place-items: center;
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.1);
}
.ac-bell.active { color: var(--accent, #d97706); border-color: var(--accent, #d97706); }
.ac-badge {
  position: absolute; top: -4px; right: -4px; min-width: 16px; height: 16px; padding: 0 4px;
  border-radius: 8px; background: #dc2626; color: #fff; font-size: var(--font-10); line-height: 16px;
  text-align: center; font-weight: 700;
}
.ac-panel {
  position: absolute; top: 46px; right: 0; width: 360px; max-width: 92vw; max-height: 72vh; overflow: auto;
  background: var(--panel, #fff); border: 1px solid var(--line, #d9e2ec); border-radius: 12px;
  box-shadow: 0 12px 36px rgba(0, 0, 0, 0.22); padding: 10px 12px;
}
.ac-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
.ac-h-title { font-weight: 700; font-size: var(--font-13-5); color: var(--text, #111); }
.ac-cnt { color: var(--accent, #d97706); }
.ac-scan {
  border: 1px solid var(--primary, #0f766e); background: var(--primary, #0f766e); color: #fff;
  font-size: var(--font-sm); padding: 4px 12px; border-radius: 999px; cursor: pointer;
}
.ac-scan:disabled { opacity: 0.6; cursor: default; }
.ac-head-actions { display: flex; gap: 6px; align-items: center; }
.ac-clear {
  display: inline-flex; align-items: center; gap: 3px;
  border: 1px solid var(--line, #e5e7eb); background: var(--panel, #fff); color: var(--muted, #667085);
  font-size: var(--font-sm); padding: 4px 10px; border-radius: 999px; cursor: pointer;
}
.ac-clear:hover:not(:disabled) { color: #dc2626; border-color: #fecaca; }
.ac-clear:disabled { opacity: 0.6; cursor: default; }
.ac-empty { font-size: var(--font-12-5); color: var(--muted, #667085); padding: 16px 6px; line-height: 1.6; }
.ac-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
.ac-item { border: 1px solid var(--line-faint, #eef1f4); border-radius: 9px; padding: 8px 10px; }
.ac-item-top { display: flex; align-items: center; gap: 8px; }
.ac-sev { font-size: var(--font-xs); font-weight: 700; padding: 1px 7px; border-radius: 999px; color: #fff; flex-shrink: 0; }
.ac-sev.high { background: #dc2626; }
.ac-sev.medium { background: #d97706; }
.ac-sev.low { background: #2563eb; }
.ac-title { font-size: var(--font-12-5); font-weight: 600; color: var(--text-body, #222); line-height: 1.4; }
.ac-x {
  margin-left: auto; border: none; background: none; cursor: pointer; font-size: var(--font-xl); line-height: 1;
  color: var(--muted, #888); flex-shrink: 0;
}
.ac-detail { font-size: var(--font-sm); color: var(--muted, #667085); margin: 5px 0; line-height: 1.5; }
.ac-basis { transform: scale(0.92); transform-origin: left; }
.ac-fade-enter-active, .ac-fade-leave-active { transition: opacity 0.2s, transform 0.2s; }
.ac-fade-enter-from, .ac-fade-leave-to { opacity: 0; transform: translateY(-6px); }
</style>
