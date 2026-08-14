<script setup lang="ts">
// 定时任务调度 + 结果中心：配置定时任务（5 kind）/启停/参数/立即执行/执行历史，
// 并把任务落盘的报告以 artifact 富渲染。第一版仅站内落库+历史+手动触发，不外发推送。
import { ref, reactive, computed, onDeactivated, onMounted, onBeforeUnmount, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  getTaskNotify,
  saveTaskNotify,
  type ChannelKey,
} from '@/services/agent/notifyClient'
import {
  listSchedules,
  createSchedule,
  updateSchedule,
  deleteSchedule,
  triggerSchedule,
  getExecutions,
  listReports,
  getReportContent,
  SCHEDULE_KIND_META,
  scheduleKindMeta,
  type ScheduledTask,
  type TaskExecution,
  type ScheduleKind,
  type ReportItem
} from '@/services/agent/scheduleClient'
import { provinceRegionProfiles } from '@/data/regions'
import { parseArtifactBlocks, type ArtifactBlock } from '@/utils/artifactBlocks'
import ArtifactRenderer from '@/components/agent/artifacts/ArtifactRenderer.vue'

const regionOptions = provinceRegionProfiles.map((r) => ({ id: r.id, name: r.name }))
const kindMetaList = SCHEDULE_KIND_META

const tasks = ref<ScheduledTask[]>([])
const loading = ref(false)
const saving = ref(false)
const selectedId = ref<string>('')

// C2 每任务推送开关（引用全局渠道凭证）：随选中任务加载，独立保存
const CHANNEL_OPTIONS: { key: ChannelKey; label: string }[] = [
  { key: 'webhook', label: 'Webhook' },
  { key: 'smtp', label: '邮件' },
  { key: 'feishu', label: '飞书' },
  { key: 'wecom', label: '企业微信' },
  { key: 'dingtalk', label: '钉钉' },
]
const notifyCfg = reactive({ enabled: false, on_success: true, on_error: true, channels: [] as ChannelKey[] })
const notifySaving = ref(false)
async function loadNotify(taskId: string) {
  try {
    const c = await getTaskNotify(taskId)
    notifyCfg.enabled = c.enabled
    notifyCfg.on_success = c.on_success
    notifyCfg.on_error = c.on_error
    notifyCfg.channels = c.channels
  } catch { notifyCfg.enabled = false; notifyCfg.channels = [] }
}
async function saveNotify() {
  if (!selectedId.value) return
  notifySaving.value = true
  try {
    await saveTaskNotify(selectedId.value, { ...notifyCfg })
    ElMessage.success('已保存推送开关')
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '保存失败')
  } finally {
    notifySaving.value = false
  }
}
watch(selectedId, (id) => { if (id) loadNotify(id) })

const form = reactive({
  isNew: true,
  kind: 'morning_brief' as ScheduleKind,
  at: '08:00',
  enabled: true,
  title: '',
  params: {} as Record<string, unknown>
})

const currentParamFields = computed(() => scheduleKindMeta(form.kind)?.params ?? [])
const currentKindMeta = computed(() => scheduleKindMeta(form.kind))

function kindLabel(kind: string): string {
  return scheduleKindMeta(kind)?.label ?? kind
}
function kindChar(kind: string): string {
  return scheduleKindMeta(kind)?.char ?? '·'
}

async function refreshTasks() {
  loading.value = true
  try {
    tasks.value = await listSchedules()
  } catch (e) {
    ElMessage.error('加载任务失败：' + (e as Error).message)
  } finally {
    loading.value = false
  }
}

function startNew() {
  selectedId.value = ''
  form.isNew = true
  form.kind = 'morning_brief'
  form.at = '08:00'
  form.enabled = true
  form.title = ''
  form.params = {}
  executions.value = []
}

function selectTask(t: ScheduledTask) {
  selectedId.value = t.id
  form.isNew = false
  form.kind = t.kind
  form.at = t.at
  form.enabled = t.enabled
  form.title = t.title
  form.params = { ...t.params }
  loadExecutions(t.id)
}

function cleanParams(): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const f of currentParamFields.value) {
    const v = form.params[f.key]
    if (v !== undefined && v !== null && v !== '') {
      out[f.key] = f.type === 'number' ? Number(v) : v
    }
  }
  return out
}

async function save() {
  if (!/^\d{2}:\d{2}$/.test(form.at)) {
    ElMessage.warning('请填写每日触发时刻（HH:MM）')
    return
  }
  saving.value = true
  try {
    if (form.isNew) {
      const created = await createSchedule({
        kind: form.kind,
        at: form.at,
        params: cleanParams(),
        enabled: form.enabled,
        title: form.title
      })
      ElMessage.success('已创建定时任务')
      await refreshTasks()
      selectTask(created)
    } else {
      const updated = await updateSchedule(selectedId.value, {
        at: form.at,
        params: cleanParams(),
        enabled: form.enabled,
        title: form.title
      })
      ElMessage.success('已保存')
      await refreshTasks()
      selectTask(updated)
    }
  } catch (e) {
    ElMessage.error('保存失败：' + (e as Error).message)
  } finally {
    saving.value = false
  }
}

async function removeTask(t: ScheduledTask) {
  try {
    await ElMessageBox.confirm(
      `确认删除任务「${kindLabel(t.kind)}${t.title ? ' · ' + t.title : ''}」？`,
      '删除确认',
      { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' }
    )
  } catch {
    return
  }
  try {
    await deleteSchedule(t.id)
    ElMessage.success('已删除')
    if (selectedId.value === t.id) startNew()
    await refreshTasks()
  } catch (e) {
    ElMessage.error('删除失败：' + (e as Error).message)
  }
}

async function toggleEnabled(t: ScheduledTask, val: boolean) {
  try {
    await updateSchedule(t.id, { enabled: val })
  } catch (e) {
    ElMessage.error('切换失败：' + (e as Error).message)
  } finally {
    await refreshTasks()
  }
}

// ── 执行历史 ──────────────────────────────────────────────────────────────
const executions = ref<TaskExecution[]>([])
let pollTimer: number | undefined

async function loadExecutions(taskId: string) {
  try {
    executions.value = await getExecutions(taskId)
  } catch {
    executions.value = []
  }
}

async function runNow(t: ScheduledTask) {
  try {
    await triggerSchedule(t.id)
    ElMessage.success('已触发，正在执行…')
    selectTask(t)
    startPolling(t.id)
  } catch (e) {
    ElMessage.error('触发失败：' + (e as Error).message)
  }
}

function startPolling(taskId: string) {
  stopPolling()
  pollTimer = window.setInterval(async () => {
    if (selectedId.value !== taskId) {
      stopPolling()
      return
    }
    await loadExecutions(taskId)
    await refreshTasks()
    if (!executions.value.some((e) => e.status === 'running')) stopPolling()
  }, 4000)
}
function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = undefined
  }
}

// ── 结果中心 ──────────────────────────────────────────────────────────────
const reportType = ref('market_brief')
const reportTypeOptions = [
  { value: 'market_brief', label: '交易晨报' },
  { value: 'daily_review', label: '日度复盘' },
  { value: 'risk_alert', label: '风控告警' }
]
const reports = ref<ReportItem[]>([])
const reportLoading = ref(false)
const activeReport = ref<{ title: string; blocks: ArtifactBlock[] } | null>(null)

async function refreshReports() {
  reportLoading.value = true
  try {
    reports.value = await listReports(reportType.value)
  } catch (e) {
    ElMessage.error('加载报告失败：' + (e as Error).message)
    reports.value = []
  } finally {
    reportLoading.value = false
  }
}

async function openReport(r: ReportItem) {
  try {
    const data = await getReportContent(r.session_id, r.path)
    activeReport.value = { title: r.title, blocks: parseArtifactBlocks(data.content) }
  } catch (e) {
    ElMessage.error('打开报告失败：' + (e as Error).message)
  }
}

function fmtTime(ts?: number | null): string {
  if (!ts) return '—'
  return new Date(ts * 1000).toLocaleString('zh-CN', { hour12: false })
}
function statusType(s: string): 'success' | 'danger' | 'warning' | 'info' {
  // skipped=前置条件未满足的如实留痕（如 forecast_run 数据未到位），非成功非失败非执行中
  return s === 'ok' ? 'success' : s === 'error' ? 'danger' : s === 'skipped' ? 'warning' : 'info'
}
function statusLabel(s: string): string {
  return s === 'ok' ? '成功' : s === 'error' ? '失败' : s === 'skipped' ? '已跳过' : '执行中'
}

onMounted(() => {
  refreshTasks()
  startNew()
  refreshReports()
})
// KeepAlive 缓存下切走触发 onDeactivated（非 onBeforeUnmount）：runNow 启动的 4s 轮询须暂停，
// 否则离开 /system/schedules 后服务端任务 running 期间仍持续打 getExecutions+refreshTasks（#1737）。
// 不随 onActivated 自动恢复——轮询由 runNow 显式触发，切回可重新触发或刷新执行历史。
onDeactivated(stopPolling)
onBeforeUnmount(stopPolling)
</script>

<template>
  <div class="schedule-view">
    <header class="head">
      <div>
        <p class="sub">智能体定时任务的配置 · 启停 · 参数 · 立即执行 · 执行历史 · 结果查看</p>
      </div>
      <el-button :loading="loading" @click="refreshTasks">刷新</el-button>
    </header>

    <el-alert
      type="info"
      :closable="false"
      show-icon
      title="第一版仅站内落库 + 执行历史 + 手动触发，不外发推送"
      description="定时任务由 agent-backend 调度（服务器本地时区）。任务产出报告由真实出清/结算/披露数据生成；现货盯盘演示数据走合成回放、交易晨报的次日预测带为预测值（非真实出清价），结果中已显式标注。"
    />

    <el-alert
      type="info"
      :closable="false"
      show-icon
      title="报告三引擎分工 · 本页结果中心 = 站内定时报告（调度自动生成 + 归档，只看不手动生成）。需手动模板结算报表 → 「报表中心」；需 AI 叙事报告 → 「报告工坊」。"
      style="margin-top: 12px;"
    />

    <section class="grid">
      <!-- 任务列表 -->
      <div class="panel list">
        <div class="panel-head">
          <span>任务列表（{{ tasks.length }}）</span>
          <el-button type="primary" size="small" @click="startNew">+ 新建任务</el-button>
        </div>
        <el-table
          :data="tasks"
          size="small"
          height="340"
          highlight-current-row
          :current-row-key="selectedId"
          row-key="id"
          @current-change="(row: ScheduledTask | null) => row && selectTask(row)"
        >
          <el-table-column label="类型" min-width="120">
            <template #default="{ row }">
              <span class="kind-char">{{ kindChar(row.kind) }}</span>
              <span>{{ kindLabel(row.kind) }}</span>
              <div v-if="row.title" class="row-title">{{ row.title }}</div>
            </template>
          </el-table-column>
          <el-table-column prop="at" label="触发" width="70" />
          <el-table-column label="启用" width="70">
            <template #default="{ row }">
              <el-switch
                :model-value="row.enabled"
                size="small"
                @update:model-value="(v: boolean) => toggleEnabled(row, v)"
                @click.stop
              />
            </template>
          </el-table-column>
          <el-table-column label="最近执行" min-width="150">
            <template #default="{ row }">
              <div v-if="row.last_run" class="last-run">
                <el-tag v-if="row.last_status" :type="statusType(row.last_status)" size="small" effect="plain">
                  {{ statusLabel(row.last_status) }}
                </el-tag>
                <span class="last-result" :title="row.last_result || ''">{{ row.last_result || '—' }}</span>
              </div>
              <span v-else class="muted">未执行</span>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="140">
            <template #default="{ row }">
              <el-button link type="primary" size="small" @click.stop="runNow(row)">立即执行</el-button>
              <el-button link type="danger" size="small" @click.stop="removeTask(row)">删除</el-button>
            </template>
          </el-table-column>
          <template #empty>暂无定时任务，点「新建任务」创建。</template>
        </el-table>
      </div>

      <!-- 编辑面板 -->
      <div class="panel edit">
        <div class="panel-head">
          <span>{{ form.isNew ? '新建任务' : '编辑任务' }}</span>
        </div>
        <el-form label-width="96px" label-position="right" class="edit-form">
          <el-form-item label="任务类型">
            <el-select v-model="form.kind" :disabled="!form.isNew" style="width: 100%">
              <el-option v-for="m in kindMetaList" :key="m.kind" :label="m.label" :value="m.kind">
                <span class="kind-char">{{ m.char }}</span>{{ m.label }}
              </el-option>
            </el-select>
            <div v-if="currentKindMeta" class="field-hint">{{ currentKindMeta.desc }}</div>
          </el-form-item>

          <el-form-item label="备注标题">
            <el-input v-model="form.title" placeholder="可选，便于区分同类任务" maxlength="40" />
          </el-form-item>

          <el-form-item label="触发时刻">
            <el-time-picker
              v-model="form.at"
              format="HH:mm"
              value-format="HH:mm"
              placeholder="每日 HH:mm"
              style="width: 160px"
            />
            <span class="field-hint inline">服务器本地时区，每日触发</span>
          </el-form-item>

          <!-- 按 kind 动态参数表单 -->
          <el-form-item v-for="f in currentParamFields" :key="f.key" :label="f.label">
            <el-date-picker
              v-if="f.type === 'date'"
              v-model="form.params[f.key]"
              type="date"
              value-format="YYYY-MM-DD"
              :placeholder="f.placeholder || 'YYYY-MM-DD'"
              style="width: 180px"
            />
            <el-input-number
              v-else-if="f.type === 'number'"
              v-model="form.params[f.key]"
              :min="0"
              :step="10"
              :placeholder="f.placeholder"
              controls-position="right"
              style="width: 180px"
            />
            <el-select
              v-else-if="f.type === 'region'"
              v-model="form.params[f.key]"
              clearable
              filterable
              placeholder="留空=默认地区"
              style="width: 220px"
            >
              <el-option v-for="r in regionOptions" :key="r.id" :label="r.name" :value="r.id" />
            </el-select>
            <el-input v-else v-model="form.params[f.key]" :placeholder="f.placeholder" />
            <span v-if="f.hint" class="field-hint inline">{{ f.hint }}</span>
          </el-form-item>

          <el-form-item label="启用">
            <el-switch v-model="form.enabled" />
          </el-form-item>

          <!-- C2 每任务推送开关（仅已存在任务；渠道凭证在 AI 设置页全局配） -->
          <el-form-item v-if="!form.isNew" label="结果推送">
            <div class="task-notify">
              <el-switch v-model="notifyCfg.enabled" /> 启用推送
              <el-checkbox-group v-if="notifyCfg.enabled" v-model="notifyCfg.channels" class="tn-channels">
                <el-checkbox v-for="c in CHANNEL_OPTIONS" :key="c.key" :value="c.key">{{ c.label }}</el-checkbox>
              </el-checkbox-group>
              <div v-if="notifyCfg.enabled" class="tn-trig">
                <el-checkbox v-model="notifyCfg.on_success">成功时推</el-checkbox>
                <el-checkbox v-model="notifyCfg.on_error">失败时推</el-checkbox>
              </div>
              <el-button v-if="notifyCfg.enabled" size="small" :loading="notifySaving" @click="saveNotify">保存推送开关</el-button>
            </div>
          </el-form-item>

          <el-form-item>
            <el-button type="primary" :loading="saving" @click="save">
              {{ form.isNew ? '创建' : '保存' }}
            </el-button>
            <el-button v-if="!form.isNew" @click="startNew">取消编辑</el-button>
          </el-form-item>
        </el-form>
      </div>
    </section>

    <!-- 执行历史 + 结果中心 -->
    <el-tabs class="bottom" model-value="executions">
      <el-tab-pane label="执行历史" name="executions">
        <div v-if="!selectedId" class="muted pad">选择左侧任务查看其执行历史。</div>
        <el-table v-else :data="executions" size="small" height="280">
          <el-table-column label="开始时间" width="180">
            <template #default="{ row }">{{ fmtTime(row.started_at) }}</template>
          </el-table-column>
          <el-table-column label="触发方式" width="100">
            <template #default="{ row }">
              <el-tag size="small" effect="plain" :type="row.trigger === 'manual' ? 'warning' : 'info'">
                {{ row.trigger === 'manual' ? '手动' : '定时' }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="状态" width="100">
            <template #default="{ row }">
              <el-tag size="small" :type="statusType(row.status)">{{ statusLabel(row.status) }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="结果摘要" min-width="240">
            <template #default="{ row }">
              <span class="result-text">{{ row.result || '—' }}</span>
              <el-popover v-if="row.log" trigger="click" width="420" placement="top">
                <template #reference><el-button link type="info" size="small">查看日志</el-button></template>
                <pre class="log-pre">{{ row.log }}</pre>
              </el-popover>
            </template>
          </el-table-column>
          <el-table-column label="耗时" width="90">
            <template #default="{ row }">
              <span v-if="row.completed_at">{{ Math.round(row.completed_at - row.started_at) }}s</span>
              <span v-else class="muted">…</span>
            </template>
          </el-table-column>
          <template #empty>该任务暂无执行记录，可点「立即执行」。</template>
        </el-table>
      </el-tab-pane>

      <el-tab-pane label="结果中心（报告）" name="reports">
        <div class="report-toolbar">
          <el-select v-model="reportType" size="small" style="width: 160px" @change="refreshReports">
            <el-option v-for="o in reportTypeOptions" :key="o.value" :label="o.label" :value="o.value" />
          </el-select>
          <el-button size="small" :loading="reportLoading" @click="refreshReports">刷新报告</el-button>
          <span class="muted">共 {{ reports.length }} 份</span>
        </div>
        <div class="report-layout">
          <div class="report-list">
            <div
              v-for="r in reports"
              :key="r.session_id + r.path"
              class="report-card"
              @click="openReport(r)"
            >
              <div class="report-title">{{ r.title }}</div>
              <div class="report-meta">
                <span>{{ r.session_id }}</span>
                <span>{{ fmtTime(r.mtime) }}</span>
              </div>
            </div>
            <div v-if="!reports.length && !reportLoading" class="muted pad">暂无该类型报告，可在任务上「立即执行」生成。</div>
          </div>
          <div class="report-view">
            <div v-if="!activeReport" class="muted pad">点左侧报告卡片查看富渲染内容。</div>
            <template v-else>
              <h3 class="rv-title">{{ activeReport.title }}</h3>
              <ArtifactRenderer :blocks="activeReport.blocks" />
            </template>
          </div>
        </div>
      </el-tab-pane>
    </el-tabs>
  </div>
</template>

<style scoped>
.schedule-view {
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
}
.head h2 {
  margin: 0;
  font-size: 18px;
}
.sub {
  margin: 4px 0 0;
  color: var(--el-text-color-secondary);
  font-size: 13px;
}
.grid {
  display: grid;
  grid-template-columns: minmax(420px, 1.2fr) minmax(360px, 1fr);
  gap: 14px;
}
.panel {
  border: 1px solid var(--el-border-color-light);
  border-radius: 8px;
  background: var(--el-bg-color);
  overflow: hidden;
}
.panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  font-weight: 600;
  border-bottom: 1px solid var(--el-border-color-lighter);
  background: var(--el-fill-color-light);
}
.edit-form {
  padding: 14px;
}
.kind-char {
  display: inline-flex;
  width: 20px;
  height: 20px;
  margin-right: 6px;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
  background: var(--el-color-primary-light-8);
  color: var(--el-color-primary);
  font-size: 12px;
  vertical-align: middle;
}
.row-title {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  margin-top: 2px;
}
.last-run {
  display: flex;
  align-items: center;
  gap: 6px;
}
.last-result {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 180px;
}
.field-hint {
  color: var(--el-text-color-secondary);
  font-size: 12px;
  margin-top: 4px;
}
.field-hint.inline {
  margin-top: 0;
  margin-left: 8px;
}
.muted {
  color: var(--el-text-color-secondary);
  font-size: 13px;
}
.pad {
  padding: 16px;
}
.result-text {
  font-size: 13px;
}
.log-pre {
  margin: 0;
  max-height: 320px;
  overflow: auto;
  font-size: 12px;
  white-space: pre-wrap;
  word-break: break-all;
}
.report-toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 4px 12px;
}
.report-layout {
  display: grid;
  grid-template-columns: 280px 1fr;
  gap: 12px;
  min-height: 320px;
}
.report-list {
  border-right: 1px solid var(--el-border-color-lighter);
  padding-right: 10px;
  max-height: 520px;
  overflow: auto;
}
.report-card {
  padding: 10px 12px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 6px;
  margin-bottom: 8px;
  cursor: pointer;
  transition: border-color 0.15s;
}
.report-card:hover {
  border-color: var(--el-color-primary);
}
.report-title {
  font-weight: 600;
  font-size: 13px;
  margin-bottom: 4px;
}
.report-meta {
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: 11px;
  color: var(--el-text-color-secondary);
}
.report-view {
  padding: 0 6px;
  max-height: 520px;
  overflow: auto;
}
.rv-title {
  margin: 0 0 12px;
  font-size: 15px;
}
@media (max-width: 1100px) {
  .grid {
    grid-template-columns: 1fr;
  }
  .report-layout {
    grid-template-columns: 1fr;
  }
}
</style>
