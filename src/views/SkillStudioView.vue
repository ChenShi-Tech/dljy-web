<script setup lang="ts">
// 技能工作室：管理 agent-backend 的渐进式披露技能（SKILL.md）。
// 全览 / 启停 / 编辑 SKILL.md 全文 + 附属文件 / 导入(zip/粘贴) / 导出 / 卸载。
import { ref, computed, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Plus, Upload, Pencil, Trash2, Download, FilePlus, RefreshCw } from 'lucide-vue-next'
import {
  listSkills,
  getSkill,
  saveSkillRaw,
  deleteSkill,
  setSkillEnabled,
  importSkillZip,
  exportSkillUrl,
  readSkillFile,
  writeSkillFile,
  deleteSkillFile,
  type SkillSummary,
  type SkillDetail
} from '@/services/agent/agentSkills'
import { getAdminToken, setAdminToken } from '@/services/llm'

const RAW_TEMPLATE = `---
name: 技能名
description: 一句话说明这个技能做什么、何时使用（模型据此判断是否取用）
---

## 目标

（这个技能要完成什么）

## 步骤

1. 第一步……
2. 第二步……
`

const skills = ref<SkillSummary[]>([])
const loading = ref(false)
const backendOk = ref(true)
const adminToken = ref(getAdminToken())

function onTokenChange() {
  setAdminToken(adminToken.value)
}

const builtinCount = computed(() => skills.value.filter((s) => s.source === 'builtin').length)
const userCount = computed(() => skills.value.filter((s) => s.source === 'user').length)

function errText(e: unknown): string {
  return e instanceof Error ? e.message : '操作失败'
}

async function load() {
  loading.value = true
  try {
    skills.value = await listSkills()
    backendOk.value = true
  } catch {
    skills.value = []
    backendOk.value = false
  }
  loading.value = false
}
onMounted(load)

async function toggleEnabled(s: SkillSummary) {
  try {
    await setSkillEnabled(s.name, !s.enabled)
    s.enabled = !s.enabled
    ElMessage.success(`${s.name} 已${s.enabled ? '启用' : '停用'}`)
  } catch (e) {
    ElMessage.error(errText(e))
  }
}

function doExport(s: SkillSummary) {
  const a = document.createElement('a')
  a.href = exportSkillUrl(s.name)
  a.download = `${s.name}.zip`
  document.body.appendChild(a)
  a.click()
  a.remove()
}

async function removeSkill(s: SkillSummary) {
  if (s.source === 'builtin') {
    ElMessage.info('内置技能不可删除：可停用，或编辑后另存为同名自定义技能再删除以恢复内置')
    return
  }
  try {
    await ElMessageBox.confirm(`卸载技能「${s.name}」？将删除其全部文件。`, '确认卸载', { type: 'warning' })
  } catch {
    return
  }
  try {
    await deleteSkill(s.name)
    ElMessage.success('已卸载')
    await load()
  } catch (e) {
    ElMessage.error(errText(e))
  }
}

// ── 编辑抽屉 ──
const drawerOpen = ref(false)
const editing = ref<SkillDetail | null>(null)
const editName = ref('')
const editRaw = ref('')
const isNew = ref(false)
const saving = ref(false)

function openCreate() {
  isNew.value = true
  editing.value = null
  editName.value = ''
  editRaw.value = RAW_TEMPLATE
  drawerOpen.value = true
}

async function openEdit(s: SkillSummary) {
  try {
    const detail = await getSkill(s.name)
    isNew.value = false
    editing.value = detail
    editName.value = detail.name
    editRaw.value = detail.raw
    drawerOpen.value = true
  } catch (e) {
    ElMessage.error(errText(e))
  }
}

async function saveEdit() {
  const name = editName.value.trim()
  if (!name) return ElMessage.warning('请填写技能名')
  if (!editRaw.value.trim()) return ElMessage.warning('SKILL.md 不能为空')
  saving.value = true
  try {
    const wasBuiltin = editing.value?.source === 'builtin'
    await saveSkillRaw(name, editRaw.value)
    ElMessage.success(wasBuiltin ? '已另存为自定义技能' : '已保存')
    drawerOpen.value = false
    await load()
  } catch (e) {
    ElMessage.error(errText(e))
  }
  saving.value = false
}

// ── 附属文件（编辑抽屉内）──
const fileOpen = ref(false)
const filePath = ref('')
const fileContent = ref('')
const fileIsNew = ref(false)
const fileSaving = ref(false)

async function refreshEditing() {
  if (!editing.value) return
  editing.value = await getSkill(editing.value.name)
  editName.value = editing.value.name
  await load()
}

async function openFile(path: string) {
  if (!editing.value) return
  try {
    fileContent.value = await readSkillFile(editing.value.name, path)
    filePath.value = path
    fileIsNew.value = false
    fileOpen.value = true
  } catch (e) {
    ElMessage.error(errText(e))
  }
}

function openNewFile() {
  filePath.value = ''
  fileContent.value = ''
  fileIsNew.value = true
  fileOpen.value = true
}

async function saveFile() {
  if (!editing.value) return
  const path = filePath.value.trim()
  if (!path) return ElMessage.warning('请填写文件名/路径')
  fileSaving.value = true
  try {
    await writeSkillFile(editing.value.name, path, fileContent.value)
    ElMessage.success('附属文件已保存')
    fileOpen.value = false
    await refreshEditing()
  } catch (e) {
    ElMessage.error(errText(e))
  }
  fileSaving.value = false
}

async function removeFile(path: string) {
  if (!editing.value) return
  try {
    await ElMessageBox.confirm(`删除附属文件「${path}」？`, '确认', { type: 'warning' })
  } catch {
    return
  }
  try {
    await deleteSkillFile(editing.value.name, path)
    ElMessage.success('已删除')
    await refreshEditing()
  } catch (e) {
    ElMessage.error(errText(e))
  }
}

// ── 导入对话框 ──
const importOpen = ref(false)
const importTab = ref<'zip' | 'paste'>('zip')
const importFile = ref<File | null>(null)
const importOverwrite = ref(false)
const pasteName = ref('')
const pasteRaw = ref('')
const importing = ref(false)

function openImport() {
  importTab.value = 'zip'
  importFile.value = null
  importOverwrite.value = false
  pasteName.value = ''
  pasteRaw.value = RAW_TEMPLATE
  importOpen.value = true
}

function onPickFile(e: Event) {
  importFile.value = (e.target as HTMLInputElement).files?.[0] ?? null
}

async function doImport() {
  importing.value = true
  try {
    if (importTab.value === 'zip') {
      if (!importFile.value) {
        importing.value = false
        return ElMessage.warning('请选择 .zip 文件')
      }
      const m = await importSkillZip(importFile.value, importOverwrite.value)
      ElMessage.success(`已导入技能「${m.name}」`)
    } else {
      const name = pasteName.value.trim()
      if (!name) {
        importing.value = false
        return ElMessage.warning('请填写技能名')
      }
      await saveSkillRaw(name, pasteRaw.value)
      ElMessage.success(`已创建技能「${name}」`)
    }
    importOpen.value = false
    await load()
  } catch (e) {
    ElMessage.error(errText(e))
  }
  importing.value = false
}
</script>

<template>
  <div class="skill-studio">
    <section class="card">
      <div class="head">
        <div>
          <p class="sub">
            管理智能体的渐进式披露技能（SKILL.md）。技能「名称+描述」注入系统提示，匹配任务时智能体按需读取技能全文。停用的技能不注入。<strong>启停/编辑对新建会话生效。</strong>
          </p>
        </div>
        <div class="head-ops">
          <el-button text :loading="loading" title="刷新" @click="load"><RefreshCw :size="15" /></el-button>
          <el-button @click="openImport"><Upload :size="14" /> 导入</el-button>
          <el-button type="primary" @click="openCreate"><Plus :size="14" /> 新建技能</el-button>
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
      <div v-else-if="!skills.length && !loading" class="empty">暂无技能，点击「新建技能」或「导入」。</div>

      <div v-else class="grid">
        <div v-for="s in skills" :key="s.name" class="sk" :class="{ off: !s.enabled }">
          <div class="sk-top">
            <span class="sk-name">/{{ s.name }}</span>
            <span class="sk-src" :class="s.source">{{ s.source === 'builtin' ? '内置' : '自定义' }}</span>
          </div>
          <div class="sk-desc">{{ s.description }}</div>
          <div class="sk-foot">
            <el-switch :model-value="s.enabled" size="small" @change="toggleEnabled(s)" />
            <span class="sk-state">{{ s.enabled ? '已启用' : '已停用' }}</span>
            <div class="sk-ops">
              <button class="op" title="编辑" @click="openEdit(s)"><Pencil :size="15" /></button>
              <button class="op" title="导出 zip" @click="doExport(s)"><Download :size="15" /></button>
              <button
                class="op danger"
                title="卸载"
                :disabled="s.source === 'builtin'"
                @click="removeSkill(s)"
              >
                <Trash2 :size="15" />
              </button>
            </div>
          </div>
        </div>
      </div>

      <div v-if="skills.length" class="stat">
        共 {{ skills.length }} 个技能（内置 {{ builtinCount }} · 自定义 {{ userCount }}）
      </div>
    </section>

    <!-- 编辑抽屉 -->
    <el-drawer
      v-model="drawerOpen"
      :title="isNew ? '新建技能' : `编辑技能 /${editName}`"
      size="580px"
      :destroy-on-close="true"
    >
      <div class="edit">
        <div class="field">
          <label>技能名 <span class="muted">（即斜杠指令名，中英文/数字/-/_，无空格）</span></label>
          <el-input v-model="editName" :disabled="!isNew" placeholder="如：储能测算" />
        </div>
        <div v-if="editing?.source === 'builtin'" class="fork-tip">
          这是内置技能，保存后将另存为同名自定义技能（覆盖内置；卸载后恢复内置）。
        </div>
        <div class="field">
          <label>SKILL.md 全文 <span class="muted">（YAML frontmatter 的 name/description + Markdown 正文）</span></label>
          <el-input v-model="editRaw" type="textarea" :rows="16" class="mono" />
        </div>

        <div v-if="!isNew && editing" class="field">
          <div class="files-head">
            <label>附属文件 <span class="muted">（模板/检查清单等，正文按需读取）</span></label>
            <el-button text size="small" @click="openNewFile"><FilePlus :size="14" /> 新增</el-button>
          </div>
          <ul v-if="editing.files.length" class="files">
            <li v-for="f in editing.files" :key="f">
              <span class="fname" @click="openFile(f)">{{ f }}</span>
              <button class="op danger" title="删除" @click="removeFile(f)"><Trash2 :size="14" /></button>
            </li>
          </ul>
          <div v-else class="files-empty">暂无附属文件</div>
        </div>
      </div>
      <template #footer>
        <el-button @click="drawerOpen = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="saveEdit">保存</el-button>
      </template>
    </el-drawer>

    <!-- 附属文件编辑 -->
    <el-dialog
      v-model="fileOpen"
      :title="fileIsNew ? '新增附属文件' : `编辑 ${filePath}`"
      width="600px"
      append-to-body
    >
      <div v-if="fileIsNew" class="field">
        <label>文件路径 <span class="muted">（技能目录内相对路径，如 template.md 或 notes/a.md）</span></label>
        <el-input v-model="filePath" placeholder="template.md" />
      </div>
      <div class="field">
        <label>内容</label>
        <el-input v-model="fileContent" type="textarea" :rows="12" class="mono" />
      </div>
      <template #footer>
        <el-button @click="fileOpen = false">取消</el-button>
        <el-button type="primary" :loading="fileSaving" @click="saveFile">保存</el-button>
      </template>
    </el-dialog>

    <!-- 导入对话框 -->
    <el-dialog v-model="importOpen" title="导入技能" width="600px">
      <el-tabs v-model="importTab">
        <el-tab-pane label="上传 .zip 整包" name="zip">
          <p class="imp-tip">zip 内含 SKILL.md（顶层或单层子目录）+ 可选附属文件，技能名取自 frontmatter。</p>
          <input type="file" accept=".zip" @change="onPickFile" />
          <div v-if="importFile" class="picked">已选择：{{ importFile.name }}</div>
          <el-checkbox v-model="importOverwrite" class="ow">同名覆盖已有技能</el-checkbox>
        </el-tab-pane>
        <el-tab-pane label="粘贴 SKILL.md" name="paste">
          <div class="field">
            <label>技能名</label>
            <el-input v-model="pasteName" placeholder="如：储能测算" />
          </div>
          <div class="field">
            <label>SKILL.md 全文</label>
            <el-input v-model="pasteRaw" type="textarea" :rows="12" class="mono" />
          </div>
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
.skill-studio { max-width: 1100px; }
.card {
  background: var(--panel);
  border: 1px solid var(--line-soft);
  border-radius: 16px;
  padding: 24px 26px;
  box-shadow: 0 12px 30px -22px rgba(16, 60, 60, 0.35);
}
.head { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; margin-bottom: 20px; }
.head h2 { display: flex; align-items: center; gap: 8px; margin: 0 0 8px; font-size: var(--font-20); color: var(--text); }
.sub { margin: 0; font-size: var(--font-md); line-height: 1.7; color: var(--muted); max-width: 680px; }
.sub strong { color: var(--primary); }
.sub code, .empty code { background: var(--surface-hover); padding: 1px 5px; border-radius: 4px; }
.head-ops { display: flex; gap: 8px; flex: none; align-items: center; }
.admin-row { display: flex; align-items: center; gap: 10px; margin-bottom: 16px; }
.admin-label { font-size: var(--font-12-5); color: var(--muted); white-space: nowrap; }
.admin-input { max-width: 440px; }

.empty { padding: 44px; text-align: center; color: var(--muted); font-size: var(--font-lg); }

.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 12px; }
.sk {
  border: 1px solid var(--line-soft); border-radius: 12px; padding: 14px 16px;
  display: flex; flex-direction: column; gap: 8px; transition: border-color 0.15s;
}
.sk:hover { border-color: var(--primary-tint-border); }
.sk.off { opacity: 0.58; }
.sk-top { display: flex; align-items: center; gap: 8px; }
.sk-name { font-weight: 650; font-size: var(--font-lg); color: var(--text); }
.sk-src {
  font-size: var(--font-xs); padding: 1px 8px; border-radius: 999px;
  border: 1px solid var(--line-soft); color: var(--el-text-color-secondary); background: var(--surface-hover);
}
.sk-src.user { color: var(--primary); background: var(--primary-tint); border-color: var(--primary-tint-border); }
.sk-desc { font-size: var(--font-12-5); color: var(--el-text-color-secondary); line-height: 1.6; flex: 1; min-height: 40px; }
.sk-foot { display: flex; align-items: center; gap: 8px; }
.sk-state { font-size: var(--font-sm); color: var(--muted); }
.sk-ops { margin-left: auto; display: flex; gap: 2px; }
.op {
  width: 28px; height: 28px; border: 0; border-radius: 7px; cursor: pointer;
  background: transparent; color: var(--el-text-color-secondary); display: grid; place-items: center;
}
.op:hover { background: var(--surface-hover); color: var(--primary); }
.op.danger:hover { background: var(--danger-tint); color: var(--danger); }
.op:disabled { opacity: 0.35; cursor: not-allowed; }
.stat { margin-top: 18px; font-size: var(--font-sm); color: var(--muted); }

.field { margin-bottom: 16px; }
.field label { display: block; margin-bottom: 7px; font-size: var(--font-md); font-weight: 600; color: var(--text-body); }
.muted { font-weight: 400; font-size: var(--font-sm); color: var(--el-text-color-secondary); }
.mono :deep(textarea) {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: var(--font-12-5); line-height: 1.6;
}
.fork-tip {
  margin: -4px 0 14px; padding: 8px 12px; font-size: var(--font-12-5); border-radius: 8px;
  color: var(--primary); background: var(--primary-tint); border: 1px solid var(--primary-tint-border);
}
.files-head { display: flex; justify-content: space-between; align-items: center; }
.files { list-style: none; margin: 8px 0 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.files li { display: flex; align-items: center; gap: 8px; padding: 7px 11px; border: 1px solid var(--line-soft); border-radius: 8px; }
.fname { flex: 1; font-size: var(--font-md); color: var(--primary); cursor: pointer; font-family: ui-monospace, monospace; }
.fname:hover { text-decoration: underline; }
.files-empty { margin-top: 8px; font-size: var(--font-12-5); color: var(--muted); }
.imp-tip { margin: 0 0 12px; font-size: var(--font-12-5); color: var(--muted); line-height: 1.6; }
.picked { margin-top: 10px; font-size: var(--font-md); color: var(--primary); }
.ow { margin-top: 14px; display: block; }
</style>
