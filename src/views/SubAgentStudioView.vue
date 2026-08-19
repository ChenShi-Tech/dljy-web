<script setup lang="ts">
// 子智能体工作室：管理 agent-backend 的可运行期编辑子智能体（sub-agent）。
// 全览 / 启停 / 编辑（提示+工具面+模型路由+归属绑定）/ 导入(zip/粘贴) / 导出 / 卸载。
// 对照 SkillStudioView.vue 结构，字段更丰富（归属权规划：主智能体 + 业务模块）。
import { ref, computed, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Plus, Upload, Pencil, Trash2, Download, RefreshCw } from 'lucide-vue-next'
import {
  listSubAgents,
  getSubAgent,
  saveSubAgent,
  deleteSubAgent,
  setSubAgentEnabled,
  importSubAgentZip,
  exportSubAgentUrl,
  listAgentModels,
  listAgentModules,
  type SubAgentSummary,
  type SubAgentDetail,
  type AgentModel,
  type AgentModule
} from '@/services/agent/subAgents'
import { getAdminToken, setAdminToken } from '@/services/llm'

const PROMPT_TEMPLATE = `你是（角色职责一句话）。

## 职责
（这个子智能体负责什么）

## 工作流程
1. 第一步……
2. 第二步……

## 输出契约
- 结论先行，关键数字附依据，不确定要明说。
`

const agents = ref<SubAgentSummary[]>([])
const loading = ref(false)
const backendOk = ref(true)
const adminToken = ref(getAdminToken())
const models = ref<AgentModel[]>([])
const modules = ref<AgentModule[]>([])
const toolCategories = ref<string[]>([])

function onTokenChange() {
  setAdminToken(adminToken.value)
}

const builtinCount = computed(() => agents.value.filter((a) => a.source === 'builtin').length)
const userCount = computed(() => agents.value.filter((a) => a.source === 'user').length)

function errText(e: unknown): string {
  return e instanceof Error ? e.message : '操作失败'
}

async function load() {
  loading.value = true
  try {
    const [list, mm] = await Promise.all([listSubAgents(), listAgentModules()])
    agents.value = list
    modules.value = mm.modules
    toolCategories.value = mm.tool_categories
    backendOk.value = true
  } catch {
    agents.value = []
    backendOk.value = false
  }
  loading.value = false
}

async function loadModels() {
  try {
    models.value = await listAgentModels()
  } catch {
    models.value = []
  }
}
onMounted(load)

async function toggleEnabled(a: SubAgentSummary) {
  try {
    await setSubAgentEnabled(a.role, !a.enabled)
    a.enabled = !a.enabled
    ElMessage.success(`${a.name} 已${a.enabled ? '启用' : '停用'}`)
  } catch (e) {
    ElMessage.error(errText(e))
  }
}

function doExport(a: SubAgentSummary) {
  const link = document.createElement('a')
  link.href = exportSubAgentUrl(a.role)
  link.download = `${a.role}.zip`
  document.body.appendChild(link)
  link.click()
  link.remove()
}

async function removeAgent(a: SubAgentSummary) {
  try {
    await ElMessageBox.confirm(`删除子智能体「${a.name}」？将删除其全部文件。`, '确认删除', { type: 'warning' })
  } catch {
    return
  }
  try {
    await deleteSubAgent(a.role)
    ElMessage.success('已删除')
    await load()
  } catch (e) {
    ElMessage.error(errText(e))
  }
}

// 编辑抽屉
const drawerOpen = ref(false)
const editing = ref<SubAgentDetail | null>(null)
const isNew = ref(false)
const saving = ref(false)

// 表单字段
const fRole = ref('')
const fName = ref('')
const fDescription = ref('')
const fChar = ref('')
const fPrompt = ref('')
const fToolCategories = ref<string[]>([])
const fModelRef = ref('')
const fRequires = ref<string[]>([])
const fDelegateDesc = ref('')
const fOwnerSupervisor = ref<string[]>([])
const fBoundModules = ref<string[]>([])
const fEnabled = ref(true)

const REQUIRES_OPTIONS = [
  { value: 'tool_call', label: '工具调用 (tool_call)' },
  { value: 'vision', label: '视觉 (vision)' },
  { value: 'json_mode', label: 'JSON 模式 (json_mode)' }
]

// 主智能体归属可选项：当前只有 supervisor（设计为可扩展列表）
const SUPERVISOR_OPTIONS = [{ value: 'supervisor', label: '调度中枢 (supervisor)' }]

function resetForm() {
  fRole.value = ''
  fName.value = ''
  fDescription.value = ''
  fChar.value = ''
  fPrompt.value = PROMPT_TEMPLATE
  fToolCategories.value = ['generic', 'memory', 'skills']
  fModelRef.value = models.value[0]?.ref ?? ''
  fRequires.value = ['tool_call']
  fDelegateDesc.value = ''
  fOwnerSupervisor.value = ['supervisor']
  fBoundModules.value = []
  fEnabled.value = true
}

function fillForm(d: SubAgentDetail) {
  fRole.value = d.role
  fName.value = d.name
  fDescription.value = d.description
  fChar.value = d.char
  fPrompt.value = d.prompt
  fToolCategories.value = [...d.tool_categories]
  fModelRef.value = d.model_ref
  fRequires.value = [...d.requires]
  fDelegateDesc.value = d.delegate_desc
  fOwnerSupervisor.value = [...d.owner_supervisor]
  fBoundModules.value = [...d.bound_modules]
  fEnabled.value = d.enabled
}

async function openCreate() {
  if (!models.value.length) await loadModels()
  isNew.value = true
  editing.value = null
  resetForm()
  drawerOpen.value = true
}

async function openEdit(a: SubAgentSummary) {
  if (!models.value.length) await loadModels()
  try {
    const d = await getSubAgent(a.role)
    isNew.value = false
    editing.value = d
    fillForm(d)
    drawerOpen.value = true
  } catch (e) {
    ElMessage.error(errText(e))
  }
}

async function save() {
  const role = fRole.value.trim()
  if (!role) return ElMessage.warning('请填写 role key')
  if (!fName.value.trim()) return ElMessage.warning('请填写中文名')
  if (!fDescription.value.trim()) return ElMessage.warning('请填写职责描述')
  if (!fPrompt.value.trim()) return ElMessage.warning('系统提示正文不能为空')
  if (!fModelRef.value) return ElMessage.warning('请选择模型路由')
  if (!fToolCategories.value.length) return ElMessage.warning('至少选一个工具类别')
  saving.value = true
  try {
    await saveSubAgent(role, {
      name: fName.value.trim(),
      description: fDescription.value.trim(),
      char: fChar.value.trim(),
      prompt: fPrompt.value,
      tool_categories: fToolCategories.value,
      model_ref: fModelRef.value,
      requires: fRequires.value,
      delegate_desc: fDelegateDesc.value.trim(),
      owner_supervisor: fOwnerSupervisor.value,
      bound_modules: fBoundModules.value,
      enabled: fEnabled.value
    })
    ElMessage.success(isNew.value ? '已创建' : '已保存')
    drawerOpen.value = false
    await load()
  } catch (e) {
    ElMessage.error(errText(e))
  }
  saving.value = false
}

// 导入对话框
const importOpen = ref(false)
const importTab = ref<'zip' | 'paste'>('zip')
const importFile = ref<File | null>(null)
const importOverwrite = ref(false)
const importing = ref(false)

function openImport() {
  importTab.value = 'zip'
  importFile.value = null
  importOverwrite.value = false
  importOpen.value = true
}

function onPickFile(e: Event) {
  importFile.value = (e.target as HTMLInputElement).files?.[0] ?? null
}

async function doImport() {
  if (importTab.value !== 'zip') {
    importOpen.value = false
    return ElMessage.info('粘贴方式请在编辑抽屉里新建后粘贴 prompt')
  }
  if (!importFile.value) return ElMessage.warning('请选择 .zip 文件')
  importing.value = true
  try {
    const m = await importSubAgentZip(importFile.value, importOverwrite.value)
    ElMessage.success(`已导入「${m.name}」`)
    importOpen.value = false
    await load()
  } catch (e) {
    ElMessage.error(errText(e))
  }
  importing.value = false
}

// 模块中文名映射（卡片标签用）
const moduleName = (key: string) => modules.value.find((m) => m.key === key)?.name ?? key
</script>

<template>
  <div class="studio">
    <section class="card">
      <div class="head">
        <div>
          <p class="sub">
            管理可被主对话智能体与业务模块调用的子智能体。整合 AI 交易助手工作台、交易晨报、
            申报厅体检、政策情报官等角色用到的全部智能体，支持新建、编辑、导入导出、归属绑定。
            <strong>编辑/启停/绑定对新会话生效。</strong>
          </p>
        </div>
        <div class="head-ops">
          <el-button text :loading="loading" title="刷新" @click="load"><RefreshCw :size="15" /></el-button>
          <el-button @click="openImport"><Upload :size="14" /> 导入</el-button>
          <el-button type="primary" @click="openCreate"><Plus :size="14" /> 新建子智能体</el-button>
        </div>
      </div>

      <div class="admin-row">
        <span class="admin-label">管理令牌</span>
        <el-input
          v-model="adminToken"
          type="password"
          show-password
          size="small"
          class="admin-input"
          placeholder="仅当服务端设了 HARNESS_ADMIN_TOKEN 时需要（写操作鉴权，与 AI 设置共用）"
          @change="onTokenChange"
        />
      </div>

      <div v-if="!backendOk" class="empty">
        无法连接智能体后端，请先启动 <code>npm run dev:agent-api</code>。
      </div>
      <div v-else-if="!agents.length && !loading" class="empty">暂无子智能体，点击「新建子智能体」或「导入」。</div>

      <div v-else class="grid">
        <div v-for="a in agents" :key="a.role" class="ag" :class="{ off: !a.enabled }">
          <div class="ag-top">
            <span class="ag-char">{{ a.char || a.role[0] }}</span>
            <div class="ag-title">
              <span class="ag-name">{{ a.name }}</span>
              <span class="ag-role">{{ a.role }}</span>
            </div>
            <span class="ag-src" :class="a.source">{{ a.source === 'builtin' ? '内置' : '自定义' }}</span>
          </div>
          <div class="ag-desc">{{ a.description }}</div>
          <div class="ag-meta">
            <span class="tag">{{ a.model_ref }}</span>
            <span v-if="a.requires.length" class="tag dim">{{ a.requires.join('/') }}</span>
          </div>
          <div v-if="a.bound_modules.length" class="ag-bind">
            <span class="bind-label">模块:</span>
            <span v-for="m in a.bound_modules" :key="m" class="mod">{{ moduleName(m) }}</span>
          </div>
          <div class="ag-foot">
            <el-switch :model-value="a.enabled" size="small" @change="toggleEnabled(a)" />
            <span class="ag-state">{{ a.enabled ? '已启用' : '已停用' }}</span>
            <div class="ag-ops">
              <button class="op" title="编辑" @click="openEdit(a)"><Pencil :size="15" /></button>
              <button class="op" title="导出 zip" @click="doExport(a)"><Download :size="15" /></button>
              <button class="op danger" title="删除" @click="removeAgent(a)"><Trash2 :size="15" /></button>
            </div>
          </div>
        </div>
      </div>

      <div v-if="agents.length" class="stat">
        共 {{ agents.length }} 个子智能体（内置 {{ builtinCount }} · 自定义 {{ userCount }}）
      </div>
    </section>

    <!-- 编辑抽屉 -->
    <el-drawer
      v-model="drawerOpen"
      :title="isNew ? '新建子智能体' : `编辑 ${fName}`"
      size="640px"
      :destroy-on-close="true"
    >
      <div class="edit">
        <div class="field-grid">
          <div class="field">
            <label>role key <span class="muted">（英文 snake_case，如 policy_summarizer）</span></label>
            <el-input v-model="fRole" :disabled="!isNew" placeholder="policy_summarizer" />
          </div>
          <div class="field">
            <label>中文名</label>
            <el-input v-model="fName" placeholder="政策摘要员" />
          </div>
        </div>
        <div class="field-grid">
          <div class="field">
            <label>单字 icon</label>
            <el-input v-model="fChar" maxlength="2" placeholder="摘" />
          </div>
          <div class="field">
            <label>职责描述 <span class="muted">（模型据此判断是否派发该子智能体）</span></label>
            <el-input v-model="fDescription" placeholder="一句话说明做什么、何时用" />
          </div>
        </div>

        <div class="field">
          <label>系统提示正文 <span class="muted">（SAFETY_BASELINE 会在保存时自动注入，无需手写）</span></label>
          <el-input v-model="fPrompt" type="textarea" :rows="10" class="mono" />
        </div>

        <div class="field">
          <label>工具面 <span class="muted">（决定该子智能体能调用哪些工具）</span></label>
          <el-select v-model="fToolCategories" multiple collapse-tags collapse-tags-tooltip class="w-full">
            <el-option v-for="c in toolCategories" :key="c" :label="c" :value="c" />
          </el-select>
        </div>

        <div class="field-grid">
          <div class="field">
            <label>模型路由</label>
            <el-select v-model="fModelRef" filterable class="w-full">
              <el-option
                v-for="m in models"
                :key="m.ref"
                :label="`${m.ref}${m.has_key ? '' : '（未配 key）'}`"
                :value="m.ref"
              />
            </el-select>
          </div>
          <div class="field">
            <label>能力约束</label>
            <el-select v-model="fRequires" multiple class="w-full">
              <el-option v-for="r in REQUIRES_OPTIONS" :key="r.value" :label="r.label" :value="r.value" />
            </el-select>
          </div>
        </div>

        <div class="field">
          <label>派发描述 <span class="muted">（supervisor 调用 delegate_{{ fRole || 'role' }} 时看到的工具说明）</span></label>
          <el-input v-model="fDelegateDesc" type="textarea" :rows="3" placeholder="何时派给该子智能体、task 要说清什么" />
        </div>

        <div class="field">
          <label>主智能体归属 <span class="muted">（可被哪些主对话智能体派发）</span></label>
          <el-select v-model="fOwnerSupervisor" multiple class="w-full">
            <el-option v-for="s in SUPERVISOR_OPTIONS" :key="s.value" :label="s.label" :value="s.value" />
          </el-select>
        </div>

        <div class="field">
          <label>业务模块归属 <span class="muted">（绑定到哪些业务模块，用于模块页派发引导）</span></label>
          <el-select v-model="fBoundModules" multiple collapse-tags collapse-tags-tooltip class="w-full">
            <el-option v-for="m in modules" :key="m.key" :label="m.name" :value="m.key" />
          </el-select>
        </div>

        <div class="field">
          <el-checkbox v-model="fEnabled">启用</el-checkbox>
          <span class="muted">（停用后不进 supervisor delegate 面板与模块绑定）</span>
        </div>
      </div>
      <template #footer>
        <el-button @click="drawerOpen = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="save">保存</el-button>
      </template>
    </el-drawer>

    <!-- 导入对话框 -->
    <el-dialog v-model="importOpen" title="导入子智能体" width="560px">
      <el-tabs v-model="importTab">
        <el-tab-pane label="上传 .zip 整包" name="zip">
          <p class="imp-tip">zip 内含 AGENT.yaml + prompt.md（顶层或单层子目录），role 取自 AGENT.yaml。</p>
          <input type="file" accept=".zip" @change="onPickFile" />
          <div v-if="importFile" class="picked">已选择：{{ importFile.name }}</div>
          <el-checkbox v-model="importOverwrite" class="ow">同名覆盖已有子智能体</el-checkbox>
        </el-tab-pane>
      </el-tabs>
      <template #footer>
        <el-button @click="importOpen = false">取消</el-button>
        <el-button type="primary" :loading="importing" @click="doImport">导入</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.studio { max-width: 1180px; }
.card {
  background: var(--panel);
  border: 1px solid var(--line-soft);
  border-radius: 16px;
  padding: 24px 26px;
  box-shadow: 0 12px 30px -22px rgba(16, 60, 60, 0.35);
}
.head { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; margin-bottom: 20px; }
.head h2 { display: flex; align-items: center; gap: 8px; margin: 0 0 8px; font-size: 20px; color: var(--text); }
.sub { margin: 0; font-size: 13px; line-height: 1.7; color: var(--muted); max-width: 720px; }
.sub strong { color: var(--primary); }
.sub code, .empty code { background: var(--surface-hover); padding: 1px 5px; border-radius: 4px; }
.head-ops { display: flex; gap: 8px; flex: none; align-items: center; }
.admin-row { display: flex; align-items: center; gap: 10px; margin-bottom: 16px; }
.admin-label { font-size: 12.5px; color: var(--muted); white-space: nowrap; }
.admin-input { max-width: 440px; }

.empty { padding: 44px; text-align: center; color: var(--muted); font-size: 14px; }

.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 12px; }
.ag {
  border: 1px solid var(--line-soft); border-radius: 12px; padding: 14px 16px;
  display: flex; flex-direction: column; gap: 8px; transition: border-color 0.15s;
}
.ag:hover { border-color: var(--primary-tint-border); }
.ag.off { opacity: 0.58; }
.ag-top { display: flex; align-items: center; gap: 10px; }
.ag-char {
  width: 32px; height: 32px; flex: none; border-radius: 8px; display: grid; place-items: center;
  font-size: 16px; font-weight: 650; color: var(--primary);
  background: var(--primary-tint); border: 1px solid var(--primary-tint-border);
}
.ag-title { flex: 1; display: flex; flex-direction: column; min-width: 0; }
.ag-name { font-weight: 650; font-size: 14px; color: var(--text); }
.ag-role { font-size: 11px; color: var(--muted); font-family: ui-monospace, monospace; }
.ag-src {
  font-size: 11px; padding: 1px 8px; border-radius: 999px; flex: none;
  border: 1px solid var(--line-soft); color: var(--el-text-color-secondary); background: var(--surface-hover);
}
.ag-src.user { color: var(--primary); background: var(--primary-tint); border-color: var(--primary-tint-border); }
.ag-desc { font-size: 12.5px; color: var(--el-text-color-secondary); line-height: 1.6; flex: 1; min-height: 36px; }
.ag-meta { display: flex; gap: 6px; flex-wrap: wrap; }
.tag {
  font-size: 11px; padding: 1px 7px; border-radius: 5px;
  background: var(--surface-hover); color: var(--el-text-color-secondary);
  border: 1px solid var(--line-soft); font-family: ui-monospace, monospace;
}
.tag.dim { opacity: 0.8; }
.ag-bind { display: flex; gap: 4px; flex-wrap: wrap; align-items: center; }
.bind-label { font-size: 11px; color: var(--muted); }
.mod {
  font-size: 11px; padding: 1px 7px; border-radius: 5px;
  background: var(--primary-tint); color: var(--primary); border: 1px solid var(--primary-tint-border);
}
.ag-foot { display: flex; align-items: center; gap: 8px; margin-top: 2px; }
.ag-state { font-size: 12px; color: var(--muted); }
.ag-ops { margin-left: auto; display: flex; gap: 2px; }
.op {
  width: 28px; height: 28px; border: 0; border-radius: 7px; cursor: pointer;
  background: transparent; color: var(--el-text-color-secondary); display: grid; place-items: center;
}
.op:hover { background: var(--surface-hover); color: var(--primary); }
.op.danger:hover { background: var(--danger-tint); color: var(--danger); }
.stat { margin-top: 18px; font-size: 12px; color: var(--muted); }

.field { margin-bottom: 16px; }
.field label { display: block; margin-bottom: 7px; font-size: 13px; font-weight: 600; color: var(--text-body); }
.field-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
.w-full { width: 100%; }
.muted { font-weight: 400; font-size: 12px; color: var(--el-text-color-secondary); }
.mono :deep(textarea) {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 12.5px; line-height: 1.6;
}
.imp-tip { margin: 0 0 12px; font-size: 12.5px; color: var(--muted); line-height: 1.6; }
.picked { margin-top: 10px; font-size: 13px; color: var(--primary); }
.ow { margin-top: 14px; display: block; }
</style>
