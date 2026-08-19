<script setup lang="ts">
// C1 外部 MCP server 配置面板（挂于 AI 设置页）：CRUD + 连通性测试。
// 后端 /api/agent/llm/mcp-servers/*，写操作复用 LLM 同款 x-admin-token。
// agent 在对话中可直接调用已配置且 enabled 的外部 MCP server 工具（untrusted_external_content）。
import { onMounted, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Plus, Trash2, Plug, Pencil } from 'lucide-vue-next'
import {
  listMcpServers,
  saveMcpServer,
  deleteMcpServer,
  testMcpServer,
  type McpServerSummary,
  type McpServerBody,
} from '@/services/agent/mcpClient'

const servers = ref<McpServerSummary[]>([])
const loading = ref(false)
const editing = ref(false)
const form = ref<McpServerBody>(emptyForm())
const testing = ref<string | null>(null)

function emptyForm(): McpServerBody {
  return { name: '', transport: 'stdio', command: '', args: [], url: '', env: {}, enabled: true, allowed_domains: [] }
}

async function load() {
  loading.value = true
  try {
    servers.value = await listMcpServers()
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '加载失败（智能体后端未运行？）')
  } finally {
    loading.value = false
  }
}

function startAdd() {
  form.value = emptyForm()
  editing.value = true
}
function startEdit(s: McpServerSummary) {
  form.value = { name: s.name, transport: s.transport, command: s.command, args: [...s.args], url: s.url, enabled: s.enabled, allowed_domains: [...s.allowed_domains] }
  editing.value = true
}

async function onSave() {
  if (!form.value.name.trim()) {
    ElMessage.warning('请填 server 名称')
    return
  }
  try {
    await saveMcpServer(form.value)
    ElMessage.success('已保存（工具集已刷新）')
    editing.value = false
    await load()
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '保存失败')
  }
}

async function onDelete(name: string) {
  await ElMessageBox.confirm(`确定删除 MCP server「${name}」？`, '删除', { type: 'warning' })
  try {
    await deleteMcpServer(name)
    ElMessage.success('已删除')
    await load()
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '删除失败')
  }
}

async function onTest(name: string) {
  testing.value = name
  try {
    const r = await testMcpServer(name)
    if (r.ok) ElMessage.success(`连通成功，工具：${r.tools.join(', ') || '（无）'}`)
    else ElMessage.warning(`连通失败：${r.msg || '未知'}`)
  } finally {
    testing.value = null
  }
}

onMounted(load)
</script>

<template>
  <div class="mcp-panel" v-loading="loading">
    <div class="mcp-head">
      <span class="mcp-title"><Plug :size="15" /> 外部 MCP server</span>
      <el-button size="small" type="primary" :icon="Plus" @click="startAdd">新增</el-button>
    </div>
    <p class="mcp-desc">
      配置外部 MCP server，agent 可在对话中调用其工具（返回内容按 untrusted_external_content 处理，只引用不执行）。需装 harness-extras（langchain-mcp-adapters）。
    </p>

    <ul v-if="servers.length" class="mcp-list">
      <li v-for="s in servers" :key="s.name">
        <div class="mcp-row">
          <span class="mcp-name" :class="{ off: !s.enabled }">{{ s.name }}</span>
          <span class="mcp-meta">{{ s.transport }} · {{ s.transport === 'stdio' ? s.command || '(无 command)' : s.url || '(无 url)' }}</span>
          <span v-if="s.has_env" class="mcp-env">🔑 env</span>
          <span v-if="s.allowed_domains.length" class="mcp-domains">域名 {{ s.allowed_domains.join(',') }}</span>
        </div>
        <div class="mcp-actions">
          <el-button size="small" :icon="Plug" :loading="testing === s.name" @click="onTest(s.name)">测试</el-button>
          <el-button size="small" :icon="Pencil" @click="startEdit(s)">编辑</el-button>
          <el-button size="small" type="danger" :icon="Trash2" @click="onDelete(s.name)">删除</el-button>
        </div>
      </li>
    </ul>
    <p v-else class="mcp-empty">暂未配置外部 MCP server。</p>

    <el-dialog v-model="editing" :title="form.name ? `配置 ${form.name}` : '新增 MCP server'" width="520px">
      <el-form label-width="90px" size="small">
        <el-form-item label="名称"><el-input v-model="form.name" placeholder="如 echo-server" /></el-form-item>
        <el-form-item label="传输">
          <el-select v-model="form.transport">
            <el-option value="stdio" label="stdio（子进程）" />
            <el-option value="sse" label="sse（HTTP）" />
            <el-option value="streamable_http" label="streamable_http" />
          </el-select>
        </el-form-item>
        <el-form-item v-if="form.transport === 'stdio'" label="command"><el-input v-model="form.command" placeholder="如 npx" /></el-form-item>
        <el-form-item v-if="form.transport === 'stdio'" label="args"><el-input :model-value="(form.args ?? []).join(' ')" placeholder="空格分隔参数" @update:model-value="form.args = String($event).split(/\s+/).filter(Boolean)" /></el-form-item>
        <el-form-item v-else label="url"><el-input v-model="form.url" placeholder="https://..." /></el-form-item>
        <el-form-item label="env"><el-input type="textarea" :rows="2" placeholder='JSON，如 {"API_KEY":"..."}' @update:model-value="(v: string) => { try { form.env = JSON.parse(v || '{}') } catch { /* 忽略非 JSON */ } }" /></el-form-item>
        <el-form-item label="允许域名"><el-input :model-value="(form.allowed_domains ?? []).join(',')" placeholder="逗号分隔" @update:model-value="form.allowed_domains = String($event).split(',').map((s) => s.trim()).filter(Boolean)" /></el-form-item>
        <el-form-item label="启用"><el-switch v-model="form.enabled" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="editing = false">取消</el-button>
        <el-button type="primary" @click="onSave">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.mcp-panel { border: 1px solid var(--el-border-color); border-radius: 8px; padding: 14px; margin: 12px 0; }
.mcp-head { display: flex; align-items: center; justify-content: space-between; }
.mcp-title { display: flex; align-items: center; gap: 6px; font-weight: 600; font-size: var(--font-lg); }
.mcp-desc { font-size: var(--font-sm); color: var(--el-text-color-secondary); margin: 6px 0 10px; }
.mcp-list { list-style: none; margin: 0; padding: 0; }
.mcp-list li { display: flex; align-items: center; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid var(--el-border-color-lighter); flex-wrap: wrap; gap: 8px; }
.mcp-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; font-size: var(--font-md); }
.mcp-name { font-weight: 600; }
.mcp-name.off { color: var(--el-text-color-secondary); text-decoration: line-through; }
.mcp-meta { color: var(--el-text-color-secondary); font-size: var(--font-sm); }
.mcp-env, .mcp-domains { font-size: var(--font-xs); padding: 1px 6px; border-radius: 8px; background: var(--el-fill-color); }
.mcp-actions { display: flex; gap: 6px; }
.mcp-empty { font-size: var(--font-md); color: var(--el-text-color-secondary); }
</style>
