<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox, type FormInstance, type FormRules } from 'element-plus'
import { Ban, CheckCircle2, KeyRound, Plus, RefreshCw, RotateCcw, ShieldAlert, Users } from 'lucide-vue-next'
import {
  createAuthUser,
  getAuthUsers,
  resetAuthUserPassword,
  revokeAuthUserSessions,
  setAuthUserStatus,
  updateAuthUser,
  type AuthUser,
  type AuthUserInput
} from '@/services/auth'
import { roleLabels, subjectTypeLabels, type RoleCode, type SubjectType } from '@/services/governance'
import { fetchStations, type CompanyStation } from '@/services/company/companyApi'

type UserForm = {
  username: string
  displayName: string
  roleCode: RoleCode
  status: 'ACTIVE' | 'DISABLED'
  areaCode: string
  area: string
  subjectId: string
  subjectName: string
  subjectType: SubjectType
  allowedAreasText: string
  allowedSubjectTypes: SubjectType[]
  visibility: 'PRIVATE' | 'ORG' | 'AREA' | 'GROUP'
  // 账号绑定的「默认预测厂站」id（留空=按 公司+地区 自动取首个匹配厂站）。
  forecastStationId: string
  password: string
  mustChangePassword: boolean
}

const areaOptions = [
  { value: 'GROUP', label: '集团' },
  { value: 'CURRENT', label: '当前地区' },
  { value: 'YN', label: '云南' },
  { value: 'SX', label: '山西' },
  { value: 'HB', label: '华北' },
  { value: 'HD', label: '华东' },
  { value: 'XB', label: '西北' },
  { value: 'NW', label: '南网' }
]
const roleOptions = Object.entries(roleLabels).map(([value, label]) => ({ value: value as RoleCode, label }))
const subjectTypeOptions = Object.entries(subjectTypeLabels).map(([value, label]) => ({ value: value as SubjectType, label }))

const loading = ref(false)
const saving = ref(false)
const users = ref<AuthUser[]>([])
const dialogVisible = ref(false)
const dialogMode = ref<'create' | 'edit'>('create')
const resetDialogVisible = ref(false)
const activeUser = ref<AuthUser | null>(null)
// 编辑中用户所属公司的场站列表（供「默认预测厂站」下拉）。仅编辑态加载（此时已知用户公司）。
const editingStations = ref<CompanyStation[]>([])
const editingCompanyId = ref<string>('')

const form = reactive<UserForm>(emptyForm())
const formRef = ref<FormInstance>()
// 标准 el-form 校验,与原手动校验等价:姓名必填;新建时账号与初始密码必填(whitespace 等价于原 trim 判空)
const formRules = computed<FormRules<UserForm>>(() => ({
  displayName: [{ required: true, whitespace: true, message: '请输入姓名', trigger: 'blur' }],
  username: dialogMode.value === 'create'
    ? [{ required: true, whitespace: true, message: '请输入账号', trigger: 'blur' }]
    : [],
  password: dialogMode.value === 'create'
    ? [{ required: true, whitespace: true, message: '请输入初始密码', trigger: 'blur' }]
    : []
}))
const passwordForm = reactive({
  password: '12345678',
  mustChangePassword: true,
  revokeSessions: true
})

const activeUsers = computed(() => users.value.filter((user) => user.status !== 'DISABLED').length)
const lockedUsers = computed(() => users.value.filter((user) => user.lockedUntil && Date.parse(user.lockedUntil) > Date.now()).length)
const mustChangeUsers = computed(() => users.value.filter((user) => user.mustChangePassword).length)

onMounted(() => {
  loadUsers()
})

async function loadUsers() {
  loading.value = true
  try {
    users.value = await getAuthUsers()
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '加载用户失败')
  } finally {
    loading.value = false
  }
}

function openCreateDialog() {
  Object.assign(form, emptyForm())
  editingStations.value = []
  editingCompanyId.value = ''
  dialogMode.value = 'create'
  dialogVisible.value = true
  formRef.value?.clearValidate()
}

// 加载某公司的场站（管理员可见全集团，按 companyId 过滤），供默认预测厂站下拉。
async function loadEditingStations(companyId: string) {
  editingCompanyId.value = companyId
  editingStations.value = []
  if (!companyId) return
  try {
    const all = await fetchStations('group')
    editingStations.value = all.filter((s) => s.companyId === companyId).sort((a, b) => a.id - b.id)
  } catch {
    // 场站加载失败不阻断用户编辑；下拉留空即按自动取首个匹配厂站。
    editingStations.value = []
  }
}

function openEditDialog(user: AuthUser) {
  Object.assign(form, {
    username: user.username,
    displayName: user.displayName,
    roleCode: user.roleCode,
    status: user.status ?? 'ACTIVE',
    areaCode: user.areaCode,
    area: user.area,
    subjectId: user.subjectId,
    subjectName: user.subjectName,
    subjectType: user.subjectType,
    allowedAreasText: (user.allowedAreas ?? []).join(', '),
    allowedSubjectTypes: user.allowedSubjectTypes?.length ? user.allowedSubjectTypes : [user.subjectType],
    visibility: user.dataScopes?.[0]?.visibility ?? 'ORG',
    forecastStationId: user.forecastStationId ?? '',
    password: '',
    mustChangePassword: Boolean(user.mustChangePassword)
  })
  dialogMode.value = 'edit'
  dialogVisible.value = true
  formRef.value?.clearValidate()
  void loadEditingStations(user.companyId)
}

async function submitUserForm() {
  // 校验失败时错误提示落在对应字段上
  const valid = await formRef.value?.validate().catch(() => false)
  if (!valid) return

  saving.value = true
  try {
    if (dialogMode.value === 'create') {
      await createAuthUser(buildPayload())
      ElMessage.success('用户已创建')
    } else {
      await updateAuthUser(form.username, buildPayload())
      ElMessage.success('用户已更新')
    }
    dialogVisible.value = false
    await loadUsers()
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '保存用户失败')
  } finally {
    saving.value = false
  }
}

function openResetDialog(user: AuthUser) {
  activeUser.value = user
  Object.assign(passwordForm, {
    password: '12345678',
    mustChangePassword: true,
    revokeSessions: true
  })
  resetDialogVisible.value = true
}

async function submitPasswordReset() {
  if (!activeUser.value) return
  if (!passwordForm.password.trim()) {
    ElMessage.warning('请输入临时密码')
    return
  }
  saving.value = true
  try {
    await resetAuthUserPassword(activeUser.value.username, { ...passwordForm })
    ElMessage.success('密码已重置')
    resetDialogVisible.value = false
    await loadUsers()
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '重置密码失败')
  } finally {
    saving.value = false
  }
}

async function toggleStatus(user: AuthUser) {
  const nextStatus = user.status === 'DISABLED' ? 'ACTIVE' : 'DISABLED'
  if (nextStatus === 'DISABLED') {
    await ElMessageBox.confirm(`停用 ${user.displayName} 后会立即撤销该账号所有会话。`, '停用账号', {
      type: 'warning',
      confirmButtonText: '停用',
      cancelButtonText: '取消'
    })
  }
  try {
    await setAuthUserStatus(user.username, nextStatus)
    ElMessage.success(nextStatus === 'ACTIVE' ? '用户已启用' : '用户已停用')
    await loadUsers()
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '更新状态失败')
  }
}

async function revokeSessions(user: AuthUser) {
  await ElMessageBox.confirm(`撤销 ${user.displayName} 的全部活跃会话？`, '撤销会话', {
    type: 'warning',
    confirmButtonText: '撤销',
    cancelButtonText: '取消'
  })
  try {
    const result = await revokeAuthUserSessions(user.username)
    ElMessage.success(`已撤销 ${result?.revokedCount ?? 0} 个会话`)
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '撤销会话失败')
  }
}

function buildPayload(): AuthUserInput {
  const allowedAreas = splitList(form.allowedAreasText)
  const areaName = form.area.trim() || areaOptions.find((item) => item.value === form.areaCode)?.label || form.areaCode
  const subjectId = form.subjectId.trim() || `${form.subjectType}-${form.areaCode}-${form.username || 'USER'}`.toUpperCase()
  return {
    username: form.username,
    displayName: form.displayName,
    roleCode: form.roleCode,
    status: form.status,
    areaCode: form.areaCode,
    area: areaName,
    subjectId,
    subjectName: form.subjectName.trim() || roleLabels[form.roleCode],
    subjectType: form.subjectType,
    allowedAreas: allowedAreas.length ? allowedAreas : [form.areaCode],
    allowedSubjectTypes: form.allowedSubjectTypes.length ? form.allowedSubjectTypes : [form.subjectType],
    dataScopes: [{
      tenantId: 'dljy-demo',
      areaCode: form.areaCode,
      areaName,
      subjectId,
      subjectName: form.subjectName.trim() || roleLabels[form.roleCode],
      subjectType: form.subjectType,
      ownerOrgId: form.areaCode === 'GROUP' ? 'ORG-GROUP' : `ORG-${form.areaCode}`,
      visibility: form.visibility
    }],
    forecastStationId: form.forecastStationId ? form.forecastStationId : null,
    password: form.password,
    mustChangePassword: form.mustChangePassword
  }
}

function emptyForm(): UserForm {
  return {
    username: '',
    displayName: '',
    roleCode: 'TRADER',
    status: 'ACTIVE',
    areaCode: 'CURRENT',
    area: '当前地区',
    subjectId: '',
    subjectName: '',
    subjectType: 'TRADER',
    allowedAreasText: 'CURRENT, YN',
    allowedSubjectTypes: ['TRADER'],
    visibility: 'ORG',
    forecastStationId: '',
    password: '12345678',
    mustChangePassword: true
  }
}

function splitList(value: string) {
  return [...new Set(value.split(/[,\n，]/).map((item) => item.trim().toUpperCase()).filter(Boolean))]
}

function statusType(user: AuthUser) {
  if (user.status === 'DISABLED') return 'info'
  if (user.lockedUntil && Date.parse(user.lockedUntil) > Date.now()) return 'danger'
  return 'success'
}

function statusLabel(user: AuthUser) {
  if (user.status === 'DISABLED') return '已停用'
  if (user.lockedUntil && Date.parse(user.lockedUntil) > Date.now()) return '已锁定'
  return '启用'
}

function subjectTypeLabel(value: SubjectType) {
  return subjectTypeLabels[value] ?? value
}

function formatDate(value?: string | null) {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '-'
  return date.toLocaleString('zh-CN', { hour12: false })
}
</script>

<template>
  <div class="users-page">
    <section class="users-toolbar">
      <div>
        <div class="section-kicker">
          <Users :size="16" />
          <span>认证目录</span>
        </div>
        <p>账号、角色、数据域和密码重置由后端 SQLite 认证库统一维护。</p>
      </div>
      <div class="toolbar-actions">
        <div class="metric"><strong>{{ users.length }}</strong><span>总账号</span></div>
        <div class="metric"><strong>{{ activeUsers }}</strong><span>启用</span></div>
        <div class="metric"><strong>{{ lockedUsers }}</strong><span>锁定</span></div>
        <div class="metric"><strong>{{ mustChangeUsers }}</strong><span>待改密</span></div>
        <el-button :icon="RefreshCw" @click="loadUsers">刷新</el-button>
        <el-button :icon="Plus" type="primary" @click="openCreateDialog">新建用户</el-button>
      </div>
    </section>

    <section class="users-panel">
      <el-table v-loading="loading" :data="users" border height="620" empty-text="暂无用户数据">
        <el-table-column label="账号" min-width="180" fixed>
          <template #default="{ row }">
            <strong>{{ row.displayName }}</strong>
            <small class="table-sub">{{ row.username }}</small>
          </template>
        </el-table-column>
        <el-table-column label="角色" width="140">
          <template #default="{ row }">
            <el-tag :type="['ADMIN', 'BOSS'].includes(row.roleCode) ? 'danger' : 'info'">{{ row.role }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="120">
          <template #default="{ row }">
            <el-tag :type="statusType(row)" size="small">{{ statusLabel(row) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="地区 / 主体" min-width="240">
          <template #default="{ row }">
            <strong>{{ row.subjectName }}</strong>
            <small class="table-sub">{{ subjectTypeLabel(row.subjectType) }} · {{ row.area }}</small>
          </template>
        </el-table-column>
        <el-table-column label="数据域" min-width="250">
          <template #default="{ row }">
            <div class="scope-tags">
              <span v-for="area in row.allowedAreas" :key="area">{{ area }}</span>
            </div>
            <small class="table-sub">{{ row.allowedSubjectTypes?.join(' / ') || row.subjectType }}</small>
          </template>
        </el-table-column>
        <el-table-column label="最后登录" width="170">
          <template #default="{ row }">{{ formatDate(row.lastLoginAt) }}</template>
        </el-table-column>
        <el-table-column label="强制改密" width="110">
          <template #default="{ row }">
            <el-tag :type="row.mustChangePassword ? 'warning' : 'success'" size="small">
              {{ row.mustChangePassword ? '是' : '否' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="330" fixed="right">
          <template #default="{ row }">
            <div class="row-actions">
              <el-button size="small" @click="openEditDialog(row)">编辑</el-button>
              <el-button size="small" :icon="KeyRound" @click="openResetDialog(row)">重置</el-button>
              <el-button size="small" :icon="RotateCcw" @click="revokeSessions(row)">撤销会话</el-button>
              <el-button
                size="small"
                :type="row.status === 'DISABLED' ? 'success' : 'warning'"
                :icon="row.status === 'DISABLED' ? CheckCircle2 : Ban"
                @click="toggleStatus(row)"
              >
                {{ row.status === 'DISABLED' ? '启用' : '停用' }}
              </el-button>
            </div>
          </template>
        </el-table-column>
      </el-table>
    </section>

    <el-dialog
      v-model="dialogVisible"
      :title="dialogMode === 'create' ? '新建用户' : '编辑用户'"
      width="760px"
      append-to-body
    >
      <el-form ref="formRef" :model="form" :rules="formRules" label-position="top" class="form-grid" @submit.prevent>
        <el-form-item label="账号" prop="username">
          <el-input v-model="form.username" :disabled="dialogMode === 'edit'" placeholder="3-32 位账号" />
        </el-form-item>
        <el-form-item label="姓名" prop="displayName">
          <el-input v-model="form.displayName" placeholder="显示姓名" />
        </el-form-item>
        <el-form-item label="角色">
          <el-select v-model="form.roleCode" filterable>
            <el-option v-for="role in roleOptions" :key="role.value" :label="role.label" :value="role.value" />
          </el-select>
        </el-form-item>
        <el-form-item label="状态">
          <el-select v-model="form.status">
            <el-option label="启用" value="ACTIVE" />
            <el-option label="停用" value="DISABLED" />
          </el-select>
        </el-form-item>
        <el-form-item label="地区">
          <el-select v-model="form.areaCode" filterable>
            <el-option v-for="area in areaOptions" :key="area.value" :label="area.label" :value="area.value" />
          </el-select>
        </el-form-item>
        <el-form-item label="地区名称">
          <el-input v-model="form.area" placeholder="如 云南、山西、集团" />
        </el-form-item>
        <el-form-item label="主体类型">
          <el-select v-model="form.subjectType" filterable>
            <el-option v-for="type in subjectTypeOptions" :key="type.value" :label="type.label" :value="type.value" />
          </el-select>
        </el-form-item>
        <el-form-item label="主体名称">
          <el-input v-model="form.subjectName" placeholder="默认主体名称" />
        </el-form-item>
        <el-form-item label="主体 ID">
          <el-input v-model="form.subjectId" placeholder="为空则自动生成" />
        </el-form-item>
        <el-form-item label="可见主体类型">
          <el-select v-model="form.allowedSubjectTypes" multiple collapse-tags collapse-tags-tooltip>
            <el-option v-for="type in subjectTypeOptions" :key="type.value" :label="type.label" :value="type.value" />
          </el-select>
        </el-form-item>
        <el-form-item label="可见地区" class="wide">
          <el-input v-model="form.allowedAreasText" placeholder="CURRENT, YN, SX" />
        </el-form-item>
        <el-form-item label="数据可见性">
          <el-select v-model="form.visibility">
            <el-option label="个人" value="PRIVATE" />
            <el-option label="组织" value="ORG" />
            <el-option label="地区" value="AREA" />
            <el-option label="集团" value="GROUP" />
          </el-select>
        </el-form-item>
        <el-form-item v-if="dialogMode === 'edit'" label="默认预测厂站" class="wide">
          <el-select v-model="form.forecastStationId" clearable filterable placeholder="留空：按公司+地区自动取首个厂站" style="width: 100%">
            <el-option v-for="s in editingStations" :key="s.id" :label="`${s.name}（${s.type}${s.capacity ? ' · ' + s.capacity + 'MW' : ''}）`" :value="String(s.id)" />
          </el-select>
          <div class="field-hint">用户登录后「预测数据」模块默认绑定的厂站；用户仍可在页面内切换为本公司其他厂站。</div>
        </el-form-item>
        <el-form-item v-if="dialogMode === 'create'" label="初始密码" prop="password">
          <el-input v-model="form.password" show-password />
        </el-form-item>
        <el-form-item label="登录要求" class="checkbox-line">
          <el-checkbox v-model="form.mustChangePassword">下次登录必须修改密码</el-checkbox>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="submitUserForm">保存</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="resetDialogVisible" title="重置密码" width="420px" append-to-body>
      <div class="reset-title">
        <ShieldAlert :size="18" />
        <span>{{ activeUser?.displayName }} / {{ activeUser?.username }}</span>
      </div>
      <label class="single-field">
        <span>临时密码</span>
        <el-input v-model="passwordForm.password" show-password />
      </label>
      <el-checkbox v-model="passwordForm.mustChangePassword">下次登录必须修改密码</el-checkbox>
      <el-checkbox v-model="passwordForm.revokeSessions">立即撤销该用户全部会话</el-checkbox>
      <template #footer>
        <el-button @click="resetDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="submitPasswordReset">确认重置</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.users-page {
  min-height: calc(100vh - 112px);
  padding: 14px 16px 28px;
  background: var(--panel-sub);
  color: var(--text);
}

.users-toolbar,
.users-panel {
  border: 1px solid var(--line-soft);
  border-radius: 8px;
  background: var(--panel);
}

.users-toolbar {
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

.users-toolbar h2 {
  margin: 7px 0 6px;
  color: var(--text);
  letter-spacing: 0;
}

.users-toolbar p {
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

.users-panel {
  margin-top: 14px;
  padding: 14px;
}

.table-sub {
  display: block;
  margin-top: 4px;
  color: var(--muted);
}

.scope-tags,
.row-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.scope-tags span {
  padding: 3px 7px;
  border-radius: 5px;
  background: var(--primary-tint);
  color: var(--text-soft);
  font-size: var(--font-sm);
}

.form-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
}

.single-field {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 6px;
  color: var(--text-soft);
  font-size: var(--font-md);
  font-weight: 650;
}

.form-grid .el-form-item {
  min-width: 0;
  margin-bottom: 0;
}

.form-grid :deep(.el-form-item__label) {
  margin-bottom: 0;
  padding-bottom: 6px;
  color: var(--text-soft);
  font-size: var(--font-md);
  font-weight: 650;
  line-height: 1.4;
}

.form-grid .wide {
  grid-column: span 2;
}

.field-hint {
  margin-top: 4px;
  font-size: var(--font-sm);
  color: var(--el-text-color-secondary);
  line-height: 1.4;
}

.checkbox-line {
  justify-content: flex-end;
}

.reset-title {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 14px;
  color: var(--text);
  font-weight: 650;
}

.single-field {
  margin-bottom: 12px;
}

@media (max-width: 920px) {
  .users-toolbar,
  .toolbar-actions {
    align-items: stretch;
    flex-direction: column;
  }

  .form-grid {
    grid-template-columns: 1fr;
  }

  .form-grid .wide {
    grid-column: auto;
  }
}
</style>
