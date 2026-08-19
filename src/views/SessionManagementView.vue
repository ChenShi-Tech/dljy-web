<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { History, MonitorCheck, RefreshCw, ShieldCheck, Trash2 } from 'lucide-vue-next'
import {
  deleteAuthSession,
  getAuthAudit,
  getAuthSessions,
  getCurrentUser,
  type AuthAuditRow,
  type AuthSession
} from '@/services/auth'

const currentUser = getCurrentUser()
const isAdminLevel = computed(() => ['ADMIN', 'BOSS'].includes(currentUser.roleCode))
const scope = ref<'mine' | 'all'>(isAdminLevel.value ? 'all' : 'mine')
const loading = ref(false)
const auditLoading = ref(false)
const sessions = ref<AuthSession[]>([])
const auditRows = ref<AuthAuditRow[]>([])

const activeSessions = computed(() => sessions.value.filter((session) => !session.revokedAt && Date.parse(session.expiresAt) > Date.now()).length)
const revokedSessions = computed(() => sessions.value.filter((session) => session.revokedAt).length)
const rememberedSessions = computed(() => sessions.value.filter((session) => session.rememberMe).length)

onMounted(async () => {
  await Promise.all([loadSessions(), loadAudit()])
})

async function loadSessions() {
  loading.value = true
  try {
    sessions.value = await getAuthSessions(scope.value)
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '加载会话失败')
  } finally {
    loading.value = false
  }
}

async function loadAudit() {
  if (!isAdminLevel.value) return
  auditLoading.value = true
  try {
    auditRows.value = await getAuthAudit(120)
  } catch (error) {
    ElMessage.warning(error instanceof Error ? error.message : '加载审计日志失败')
  } finally {
    auditLoading.value = false
  }
}

async function revokeSession(session: AuthSession) {
  if (session.revokedAt) return
  try {
    await ElMessageBox.confirm(`撤销 ${session.username} 的这个登录会话？`, '撤销会话', {
      type: 'warning',
      confirmButtonText: '撤销',
      cancelButtonText: '取消'
    })
  } catch {
    return
  }
  try {
    await deleteAuthSession(session.sessionId)
    ElMessage.success('会话已撤销')
    await loadSessions()
    await loadAudit()
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '撤销会话失败')
  }
}

async function refreshAll() {
  await Promise.all([loadSessions(), loadAudit()])
}

function sessionStatus(session: AuthSession) {
  if (session.revokedAt) return { label: '已撤销', type: 'info' }
  if (Date.parse(session.expiresAt) <= Date.now()) return { label: '已过期', type: 'warning' }
  return { label: '活跃', type: 'success' }
}

function sourceType(session: AuthSession) {
  if (session.reason?.startsWith('IMPERSONATED_BY')) return '身份模拟'
  return session.rememberMe ? '保持登录' : '标准登录'
}

function browserName(userAgent?: string) {
  const value = userAgent ?? ''
  if (value.includes('Edg/')) return 'Edge'
  if (value.includes('Chrome/')) return 'Chrome'
  if (value.includes('Firefox/')) return 'Firefox'
  if (value.includes('Safari/')) return 'Safari'
  return value ? '未知浏览器' : '-'
}

function formatDate(value?: string | null) {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '-'
  return date.toLocaleString('zh-CN', { hour12: false })
}
</script>

<template>
  <div class="sessions-page">
    <section class="sessions-toolbar">
      <div>
        <div class="section-kicker">
          <MonitorCheck :size="16" />
          <span>安全中心</span>
        </div>
        <p>查看当前账号登录会话，管理员可撤销任意活跃会话并追踪认证审计。</p>
      </div>
      <div class="toolbar-actions">
        <div class="metric"><strong>{{ activeSessions }}</strong><span>活跃</span></div>
        <div class="metric"><strong>{{ rememberedSessions }}</strong><span>保持登录</span></div>
        <div class="metric"><strong>{{ revokedSessions }}</strong><span>已撤销</span></div>
        <el-segmented
          v-if="isAdminLevel"
          v-model="scope"
          :options="[
            { label: '我的会话', value: 'mine' },
            { label: '全部会话', value: 'all' }
          ]"
          @change="loadSessions"
        />
        <el-button :icon="RefreshCw" @click="refreshAll">刷新</el-button>
      </div>
    </section>

    <section class="sessions-panel">
      <div class="panel-heading">
        <div class="section-kicker">
          <ShieldCheck :size="16" />
          <span>登录会话</span>
        </div>
      </div>
      <el-table v-loading="loading" :data="sessions" border height="430">
        <el-table-column label="账号" prop="username" width="140" fixed />
        <el-table-column label="状态" width="110">
          <template #default="{ row }">
            <el-tag :type="sessionStatus(row).type" size="small">{{ sessionStatus(row).label }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="来源" width="120">
          <template #default="{ row }">{{ sourceType(row) }}</template>
        </el-table-column>
        <el-table-column label="IP" prop="ip" width="140" />
        <el-table-column label="浏览器" min-width="220">
          <template #default="{ row }">
            <strong>{{ browserName(row.userAgent) }}</strong>
            <small class="table-sub">{{ row.userAgent || '-' }}</small>
          </template>
        </el-table-column>
        <el-table-column label="签发时间" width="170">
          <template #default="{ row }">{{ formatDate(row.issuedAt) }}</template>
        </el-table-column>
        <el-table-column label="过期时间" width="170">
          <template #default="{ row }">{{ formatDate(row.expiresAt) }}</template>
        </el-table-column>
        <el-table-column label="撤销时间" width="170">
          <template #default="{ row }">{{ formatDate(row.revokedAt) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="120" fixed="right">
          <template #default="{ row }">
            <el-button
              size="small"
              type="danger"
              :icon="Trash2"
              :disabled="Boolean(row.revokedAt)"
              @click="revokeSession(row)"
            >
              撤销
            </el-button>
          </template>
        </el-table-column>
      </el-table>
    </section>

    <section v-if="isAdminLevel" class="sessions-panel audit-panel">
      <div class="panel-heading">
        <div class="section-kicker">
          <History :size="16" />
          <span>认证审计</span>
        </div>
      </div>
      <el-table v-loading="auditLoading" :data="auditRows" border height="360">
        <el-table-column prop="createdAt" label="时间" width="170">
          <template #default="{ row }">{{ formatDate(row.createdAt) }}</template>
        </el-table-column>
        <el-table-column prop="type" label="事件" width="170" />
        <el-table-column prop="username" label="账号" width="140" />
        <el-table-column prop="actor" label="操作者" width="140" />
        <el-table-column prop="result" label="结果" width="100">
          <template #default="{ row }">
            <el-tag :type="row.result === 'ALLOW' ? 'success' : 'warning'" size="small">{{ row.result || '-' }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="reason" label="原因" min-width="220" />
        <el-table-column prop="sessionId" label="会话" min-width="220" show-overflow-tooltip />
      </el-table>
    </section>
  </div>
</template>

<style scoped>
.sessions-page {
  min-height: calc(100vh - 112px);
  padding: 14px 16px 28px;
  background: var(--panel-sub);
  color: var(--text);
}

.sessions-toolbar,
.sessions-panel {
  border: 1px solid var(--line-soft);
  border-radius: 8px;
  background: var(--panel);
}

.sessions-toolbar {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding: 18px 20px;
}

.section-kicker {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--primary);
  font-size: var(--font-md);
  font-weight: 650;
}

.sessions-toolbar h2 {
  margin: 7px 0 6px;
  color: var(--text);
  letter-spacing: 0;
}

.sessions-toolbar p {
  margin: 0;
  color: var(--text-soft);
}

.toolbar-actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 10px;
}

.metric {
  min-width: 76px;
  padding: 8px 10px;
  border: 1px solid var(--primary-tint-border);
  border-radius: 8px;
  background: var(--panel-sub);
}

.metric strong,
.metric span {
  display: block;
}

.metric strong {
  color: var(--primary);
  font-size: var(--font-20);
}

.metric span {
  color: var(--muted);
  font-size: var(--font-sm);
}

.sessions-panel {
  margin-top: 14px;
  padding: 14px;
}

.panel-heading {
  margin-bottom: 12px;
}

.table-sub {
  display: block;
  max-width: 520px;
  margin-top: 4px;
  overflow: hidden;
  color: var(--muted);
  text-overflow: ellipsis;
  white-space: nowrap;
}

@media (max-width: 920px) {
  .sessions-toolbar,
  .toolbar-actions {
    align-items: stretch;
    flex-direction: column;
  }
}
</style>
