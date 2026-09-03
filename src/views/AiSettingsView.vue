<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { CheckCircle2, Sparkles, Trash2 } from 'lucide-vue-next'
import {
  getSearchConfig,
  saveSearchConfig,
  deleteSearchConfig,
  testSearchConfig,
  getAdminToken,
  setAdminToken,
  getDenylist,
  addDenylist,
  removeDenylist,
  type LlmServices,
  type SearchConfig,
  type Denylist
} from '@/services/llm'
import ModelServicesPanel from '../components/ai/ModelServicesPanel.vue'
import { fetchUsage, type UsageRow } from '@/services/agent/usageClient'
import { getVoiceConfig, saveVoiceConfig } from '@/services/voice'
import McpServersPanel from '../components/McpServersPanel.vue'
import NotifyPanel from '../components/NotifyPanel.vue'

// 我方运维令牌（服务端 HARNESS_ADMIN_TOKEN）：写配置时随请求头发送，存本机浏览器。交付档不需要它。
const adminToken = ref(getAdminToken())
// 保存按钮防抖：避免连点重复请求（写操作幂等性高，但仍应去重）
const savingSearch = ref(false)
const savingParams = ref(false)
const savingWorkflow = ref(false)

// 模型服务是否可用（网关模式，#2668）：可用时角色路由归「模型服务」面管，旧的 provider/model
// 路由卡片隐藏——否则那张卡能把角色路由到未启用的档位，绕开「只能从已启用集合中选」这条约束。
const gatewayActive = ref(false)
function onServicesLoaded(s: LlmServices) {
  gatewayActive.value = s.available
}

// LLM 用量统计（后端按角色过滤：管理员全站+按公司，用户本公司；数据源 model_calls 表）
const usageRows = ref<UsageRow[]>([])
const usageIsAdmin = ref(false)
const usageScopeCompany = ref<string | null>(null)
const usageSinceHours = ref(24)
const usageLoading = ref(false)
const usageError = ref(false)
async function loadUsage() {
  usageLoading.value = true
  const data = await fetchUsage(usageSinceHours.value)
  usageLoading.value = false
  if (!data) {
    usageError.value = true
    usageRows.value = []
    return
  }
  usageError.value = false
  usageRows.value = data.summary
  usageIsAdmin.value = data.is_admin
  usageScopeCompany.value = data.scope_company_id
}
onMounted(loadUsage)

// 采样参数 / 角色路由 / 全局工作流（运行期可调，落服务端）
import {
  getParams,
  putParams,
  getRouting,
  putRouting,
  getWorkflow,
  putWorkflow,
  ROLE_LABELS,
  WORKFLOW_LABELS,
  type ParamsConfig,
  type RoutingConfig,
  type WorkflowConfig,
  type SamplingParams
} from '@/services/agent/agentConfig'

const paramsCfg = ref<ParamsConfig | null>(null)
const routingCfg = ref<RoutingConfig | null>(null)
const workflowCfg = ref<WorkflowConfig | null>(null)

// 全局默认采样参数的可编辑副本
const defaultParams = ref<SamplingParams>({})
// 新增「按模型覆盖」的草稿
const ovRef = ref('')
const ovParams = ref<SamplingParams>({})
// 工作流参数可编辑副本 {name: value}
const workflowEdit = ref<Record<string, number>>({})

// 所有可选模型 ref，供「按模型覆盖」下拉——取自路由表（网关模式下就是档位 ref），前端不另持清单
const allModelRefs = computed(() => routingCfg.value?.models.map((m) => m.ref) ?? [])

async function loadConfig() {
  const [p, r, w] = await Promise.allSettled([getParams(), getRouting(), getWorkflow()])
  if (p.status === 'fulfilled') {
    paramsCfg.value = p.value
    defaultParams.value = { ...p.value.default }
  }
  if (r.status === 'fulfilled') routingCfg.value = r.value
  if (w.status === 'fulfilled') {
    workflowCfg.value = w.value
    workflowEdit.value = Object.fromEntries(
      Object.entries(w.value.params).map(([k, v]) => [k, v.value])
    )
  }
}
onMounted(loadConfig)

function num(v: unknown): number | undefined {
  const n = typeof v === 'number' ? v : parseFloat(String(v))
  return Number.isFinite(n) ? n : undefined
}

async function saveDefaultParams() {
  if (savingParams.value) return
  savingParams.value = true
  setAdminToken(adminToken.value)
  try {
    const r = await putParams('_default', defaultParams.value)
    if (r.ok) {
      ElMessage.success('全局默认采样参数已保存')
      paramsCfg.value = await getParams()
    } else ElMessage.error(`保存失败：${r.msg ?? '未知错误'}`)
  } finally {
    savingParams.value = false
  }
}

async function addModelOverride() {
  if (!ovRef.value) {
    ElMessage.warning('请选择要覆盖的模型')
    return
  }
  setAdminToken(adminToken.value)
  const r = await putParams(ovRef.value, ovParams.value)
  if (r.ok) {
    ElMessage.success(`已为 ${ovRef.value} 设置采样参数`)
    ovRef.value = ''
    ovParams.value = {}
    paramsCfg.value = await getParams()
  } else ElMessage.error(`保存失败：${r.msg ?? '未知错误'}`)
}

async function removeModelOverride(ref: string) {
  setAdminToken(adminToken.value)
  const r = await putParams(ref, {})
  if (r.ok) {
    ElMessage.success(`已清除 ${ref} 的采样参数覆盖`)
    paramsCfg.value = await getParams()
  } else ElMessage.error(`操作失败：${r.msg ?? '未知错误'}`)
}

// 该角色可选的模型（满足 requires 能力约束）
function modelsForRole(role: RoutingConfig['roles'][number]) {
  if (!routingCfg.value) return []
  return routingCfg.value.models.filter((m) => {
    if (role.requires.includes('tool_call') && !m.tool_call) return false
    if (role.requires.includes('vision') && !m.vision) return false
    return true
  })
}

async function onRoutingChange(role: RoutingConfig['roles'][number], ref: string) {
  setAdminToken(adminToken.value)
  // 选回默认值即清除覆盖
  const r = await putRouting(role.role, ref === role.default_ref ? null : ref)
  if (r.ok) {
    ElMessage.success(`${ROLE_LABELS[role.role] ?? role.role} 路由已更新`)
    routingCfg.value = await getRouting()
  } else ElMessage.error(`保存失败：${r.msg ?? '未知错误'}`)
}

const roleLabel = (role: string) => ROLE_LABELS[role] ?? role

async function saveWorkflow() {
  if (savingWorkflow.value) return
  savingWorkflow.value = true
  setAdminToken(adminToken.value)
  const payload: Record<string, number> = {}
  for (const [k, v] of Object.entries(workflowEdit.value)) {
    const n = num(v)
    if (n !== undefined) payload[k] = n
  }
  try {
    const r = await putWorkflow(payload)
    if (r.ok) {
      ElMessage.success('工作流参数已保存（新会话生效）')
      workflowCfg.value = await getWorkflow()
    } else ElMessage.error(`保存失败：${r.msg ?? '未知错误'}`)
  } finally {
    savingWorkflow.value = false
  }
}

// 联网搜索配置（web_search 工具的供应商 + API Key）
const SEARCH_PROVIDERS = [
  { id: 'serper', name: 'Serper（Google 检索）', doc: 'https://serper.dev' },
  { id: 'bocha', name: '博查 Bocha（国内 AI 搜索）', doc: 'https://open.bochaai.com' },
  { id: 'bing', name: 'Bing Web Search', doc: 'https://www.microsoft.com/bing/apis' },
  { id: 'tavily', name: 'Tavily（LLM 检索）', doc: 'https://tavily.com' },
  { id: 'volcengine', name: '火山引擎联网搜索', doc: 'https://www.volcengine.com/docs/82379/1338552' }
]
const searchCfg = ref<SearchConfig | null>(null)
const searchProvider = ref('serper')
const searchApiKey = ref('')
const searchModel = ref('')   // 火山引擎联网搜索需附带的接入点名（仅该引擎用）
const searchTesting = ref(false)
const searchTestOk = ref<boolean | null>(null)
const searchTestMsg = ref('')

// 当前选中供应商是否已在服务端配 key（留空 Key 时据此判断"沿用已保存"）
const searchSaved = computed(() => {
  if (!searchCfg.value) return false
  return searchCfg.value.provider === searchProvider.value && searchCfg.value.has_key
})

async function loadSearch() {
  try {
    searchCfg.value = await getSearchConfig()
    if (searchCfg.value && searchCfg.value.provider !== 'none') {
      searchProvider.value = searchCfg.value.provider
      searchModel.value = searchCfg.value.model ?? ''
    }
  } catch {
    searchCfg.value = null
  }
}
onMounted(loadSearch)

// 出网访问黑名单（web_fetch/web_search 与 browser_* 共用；名单为空 = 不限制）
const denylist = ref<Denylist | null>(null)
const newDomain = ref('')
const denylistBusy = ref(false)

async function loadDenylist() {
  try {
    denylist.value = await getDenylist()
  } catch {
    denylist.value = null
  }
}
onMounted(loadDenylist)

async function doAddDenylist() {
  if (denylistBusy.value) return  // 串行化：一次只允许一个黑名单写操作，避免乱序响应互相覆盖快照
  const domain = newDomain.value.trim()
  if (!domain) {
    ElMessage.warning('请填写域名（如 ads.example.com）')
    return
  }
  denylistBusy.value = true
  setAdminToken(adminToken.value)  // 加固配置下写操作需带 x-admin-token
  try {
    const r = await addDenylist(domain)
    if (r.ok) {
      denylist.value = r.view ?? denylist.value
      newDomain.value = ''
      ElMessage.success(`已禁止：${domain}`)
    } else {
      ElMessage.error(r.msg || '添加失败')
    }
  } finally {
    denylistBusy.value = false  // 无论成功/网络异常都复位，避免按钮卡 loading
  }
}

async function doRemoveDenylist(domain: string) {
  if (denylistBusy.value) return  // 串行化：避免并发删除的乱序响应让已删条目重现
  denylistBusy.value = true
  setAdminToken(adminToken.value)
  try {
    const view = await removeDenylist(domain)
    if (view) {
      denylist.value = view
      ElMessage.success(`已解禁：${domain}`)
    } else {
      ElMessage.error('移除失败')
    }
  } catch {
    ElMessage.error('移除失败（网络错误？）')
  } finally {
    denylistBusy.value = false
  }
}

// 语音播报（页面跳转提示音）
// 纯前端 localStorage（voice.ts），默认关、全程静音；AI 回复正文改为每条「朗读」按钮手动播放。
const ttsEnabled = ref(getVoiceConfig().tts)
function onTtsChange(v: boolean) {
  saveVoiceConfig({ tts: v })
  ElMessage.success(v ? '已开启页面跳转语音播报' : '已关闭语音播报（全程静音）')
}

async function doTestSearch() {
  if (!searchApiKey.value && !searchSaved.value) {
    ElMessage.warning('请先填写 API Key')
    return
  }
  searchTesting.value = true
  searchTestOk.value = null
  searchTestMsg.value = ''
  // 先持久化当前输入的管理令牌（与 doSaveSearch 一致）：加固配置（HARNESS_ADMIN_TOKEN 设）下
  // testSearchConfig 经 adminHeaders() 读 localStorage，不先 setAdminToken 会用旧值、不带
  // x-admin-token 被本次新增的 _require_admin 拒 403（B47 配套）。
  setAdminToken(adminToken.value)
  const r = await testSearchConfig({
    provider: searchProvider.value,
    apiKey: searchApiKey.value,
    ...(searchProvider.value === 'volcengine' ? { model: searchModel.value } : {})
  })
  searchTestOk.value = r.ok
  searchTestMsg.value = r.msg
  searchTesting.value = false
}

async function doSaveSearch() {
  if (savingSearch.value) return
  if (!searchApiKey.value) {
    ElMessage.warning('请填写 API Key')
    return
  }
  savingSearch.value = true
  setAdminToken(adminToken.value)
  try {
    const r = await saveSearchConfig(
      searchProvider.value,
      searchApiKey.value,
      searchProvider.value === 'volcengine' ? searchModel.value : undefined
    )
    if (r.ok) {
      ElMessage.success('搜索配置已保存，联网查询现已可用')
      searchApiKey.value = ''
      await loadSearch()
    } else ElMessage.error(r.msg ? `保存失败：${r.msg}` : '保存失败')
  } finally {
    savingSearch.value = false
  }
}

async function doClearSearch() {
  setAdminToken(adminToken.value)
  try {
    await deleteSearchConfig()
    ElMessage.success('已清除搜索配置（回退到环境变量）')
    await loadSearch()
  } catch (err) {
    ElMessage.error(err instanceof Error ? `清除失败：${err.message}` : '清除失败')
  }
}

// 长期记忆管理（查看/删除当前用户的跨会话记忆）
import { listMemories, deleteMemory, clearMemories, type MemoryItem } from '@/services/agent/memoryConfig'

const memories = ref<MemoryItem[]>([])
const memoryLoading = ref(false)

async function loadMemories() {
  memoryLoading.value = true
  try {
    memories.value = (await listMemories()).memories
  } catch {
    memories.value = []
  }
  memoryLoading.value = false
}
onMounted(loadMemories)

async function doDeleteMemory(key: string) {
  if (await deleteMemory(key)) {
    ElMessage.success('已删除该记忆')
    await loadMemories()
  } else ElMessage.error('删除失败（后端未运行？）')
}

async function doClearMemories() {
  if (await clearMemories()) {
    ElMessage.success('已清空全部长期记忆')
    await loadMemories()
  } else ElMessage.error('清空失败')
}

// 页内分段（模型接入 / 生成行为 / 工具与能力 / 运行观测）：原先 10 张卡片在一页平铺，
// 职责混杂且要长滚动。改为按职责分段，一屏只呈现一组相关卡片。
// 用 el-segmented 而非 el-tabs：外层「AI 工作室」已是 el-tabs，二级再用 tabs 会两层同构控件打架。
const SETTING_SECTIONS = [{ label: '模型接入', value: 'access' }, { label: '生成行为', value: 'behavior' }, { label: '工具与能力', value: 'tools' }, { label: '运行观测', value: 'usage' }] as const
const section = ref<string>('access')
</script>

<template>
  <div class="ai-settings">
    <el-segmented v-model="section" :options="SETTING_SECTIONS" class="section-nav" />

    <div v-show="section === 'access'" class="pane">
      <p class="pane-desc">模型服务的档位启用与角色路由——全站智能体能力的总开关。密钥随安装预置在服务端，前端不持密钥、不持供应商清单。</p>
      <div class="pane-body cols-main-aside">
        <ModelServicesPanel @loaded="onServicesLoaded" />

        <section class="card tip-card">
          <div class="card-head">
            <h3>说明</h3>
            <router-link :to="{ query: { tab: 'skills' } }" class="skills-link"><Sparkles :size="14" /> 技能工作室</router-link>
          </div>
          <ul class="tip-list">
            <li><strong>档位</strong>按能力划分（标准 / 快速 / 深度推理 / 视觉 / 长上下文…），具体由哪家模型承担在服务端决定，随时可换、页面无感。</li>
            <li><strong>未开通</strong>的档位不能启用，需要时联系供应方为本套系统开通。</li>
            <li><strong>角色路由</strong>只能选已启用且具备该角色所需能力的档位；选回默认即恢复。</li>
            <li>用量与调用明细见「运行观测」分段。</li>
          </ul>
          <div class="field admin-field">
            <label>管理令牌 <span class="muted-tag">（我方运维用；仅当服务端设置了 HARNESS_ADMIN_TOKEN 时需要）</span></label>
            <el-input v-model="adminToken" type="password" show-password placeholder="x-admin-token" @change="setAdminToken(adminToken)" />
          </div>
        </section>
      </div>
    </div>

    <div v-show="section === 'behavior'" class="pane">
      <p class="pane-desc">采样参数、角色路由与工作流护栏，控制智能体「怎么生成」与「跑多远」。改动对新会话生效。</p>
      <div class="pane-body cols-2">
        <!-- 采样参数 -->
        <section class="card span-full">
          <h3>采样参数</h3>
          <p class="sub2">控制生成的随机性与长度。全局默认对所有模型生效，可按具体模型覆盖；留空表示用模型自带默认。</p>
          <div class="param-row">
            <div class="pfield">
              <label>temperature <small>0–2</small></label>
              <el-input-number v-model="defaultParams.temperature" :min="0" :max="2" :step="0.1" :precision="2" controls-position="right" />
            </div>
            <div class="pfield">
              <label>max_tokens</label>
              <el-input-number v-model="defaultParams.max_tokens" :min="1" :max="200000" :step="256" controls-position="right" />
            </div>
            <div class="pfield">
              <label>top_p <small>0–1</small></label>
              <el-input-number v-model="defaultParams.top_p" :min="0" :max="1" :step="0.05" :precision="2" controls-position="right" />
            </div>
            <el-button type="primary" class="save-btn" :loading="savingParams" @click="saveDefaultParams">保存全局默认</el-button>
          </div>

          <div class="ov-block">
            <div class="saved-title">按模型覆盖</div>
            <div v-if="paramsCfg && Object.keys(paramsCfg.models).length" class="ov-list">
              <div v-for="(v, mref) in paramsCfg.models" :key="mref" class="ov-row">
                <span class="ov-ref">{{ mref }}</span>
                <span class="ov-vals">
                  <span v-if="v.temperature != null">temp={{ v.temperature }}</span>
                  <span v-if="v.max_tokens != null">max_tokens={{ v.max_tokens }}</span>
                  <span v-if="v.top_p != null">top_p={{ v.top_p }}</span>
                </span>
                <el-button text size="small" class="del-btn" @click="removeModelOverride(String(mref))"><Trash2 :size="13" /> 清除</el-button>
              </div>
            </div>
            <div class="ov-add">
              <el-select v-model="ovRef" filterable placeholder="选择模型" class="ov-select">
                <el-option v-for="r in allModelRefs" :key="r" :label="r" :value="r" />
              </el-select>
              <el-input-number v-model="ovParams.temperature" :min="0" :max="2" :step="0.1" :precision="2" placeholder="temp" controls-position="right" />
              <el-input-number v-model="ovParams.max_tokens" :min="1" :max="200000" :step="256" placeholder="max_tokens" controls-position="right" />
              <el-input-number v-model="ovParams.top_p" :min="0" :max="1" :step="0.05" :precision="2" placeholder="top_p" controls-position="right" />
              <el-button @click="addModelOverride">添加覆盖</el-button>
            </div>
          </div>
        </section>

        <!-- 角色 → 模型路由（直连模式）；网关模式下归「模型服务」面管（#2668） -->
        <section v-if="!gatewayActive" class="card">
          <h3>角色 → 模型路由</h3>
          <p class="sub2">为每个智能体角色指定使用的模型（覆盖默认路由）。仅列出满足该角色能力要求（tool_call/vision）的模型；选回「默认」即恢复。</p>
          <div v-if="routingCfg" class="route-table">
            <div v-for="role in routingCfg.roles" :key="role.role" class="route-row">
              <span class="route-name">
                {{ roleLabel(role.role) }}
                <span v-for="cap in role.requires" :key="cap" class="cap-tag">{{ cap }}</span>
              </span>
              <el-select
                :model-value="role.effective_ref"
                class="route-select"
                filterable
                @change="(v: string) => onRoutingChange(role, v)"
              >
                <el-option
                  v-for="m in modelsForRole(role)"
                  :key="m.ref"
                  :label="m.ref + (m.ref === role.default_ref ? '（默认）' : '')"
                  :value="m.ref"
                />
              </el-select>
            </div>
          </div>
          <p v-else class="hint">后端未启动或未配置，无法加载路由表。</p>
        </section>

        <!-- Agent 工作流参数 -->
        <section class="card">
          <h3>Agent 工作流参数</h3>
          <p class="sub2">失控保护与上下文管理的全局参数，修改对新会话生效。</p>
          <div v-if="workflowCfg" class="wf-grid">
            <div v-for="(p, name) in workflowCfg.params" :key="name" class="wf-field">
              <label>{{ WORKFLOW_LABELS[name]?.label ?? name }}</label>
              <el-input-number v-model="workflowEdit[name]" :min="0" :step="1" controls-position="right" class="w-full" />
              <small class="hint">{{ WORKFLOW_LABELS[name]?.help }}（默认 {{ p.default }}{{ p.overridden ? '，当前已覆盖' : '' }}）</small>
            </div>
          </div>
          <p v-else class="hint">后端未启动或未配置，无法加载工作流参数。</p>
          <div class="actions"><el-button type="primary" class="save-btn" :loading="savingWorkflow" @click="saveWorkflow">保存工作流参数</el-button></div>
        </section>
      </div>
    </div>

    <div v-show="section === 'tools'" class="pane">
      <p class="pane-desc">智能体可调用的外部能力及其边界：联网搜索、出网黑名单、MCP 服务器、推送渠道、语音与长期记忆。</p>
      <div class="pane-body cols-2">
        <!-- 联网搜索配置 -->
        <section class="card">
          <div class="card-head">
            <h2>联网搜索</h2>
            <span v-if="searchCfg?.has_key" class="badge-ok"><CheckCircle2 :size="14" /> 已配置</span>
          </div>
          <p class="sub">
            为 <code>web_search</code> 工具配置搜索引擎 + API Key，使智能体能联网查询最新政策/新闻/价格。
            Key 保存在服务端（不入库、不上传 git）。支持 Serper / 博查 / Bing / Tavily / 火山引擎。
          </p>
          <div class="field">
            <label>搜索引擎</label>
            <el-select v-model="searchProvider" class="w-full">
              <el-option v-for="p in SEARCH_PROVIDERS" :key="p.id" :label="p.name" :value="p.id" />
            </el-select>
          </div>
          <div v-if="searchProvider === 'volcengine'" class="field">
            <label>接入点 <span class="muted-tag">（该引擎在方舟侧的接入点名，需已开通联网搜索）</span></label>
            <el-input v-model="searchModel" placeholder="接入点名" />
            <span class="muted-tag">火山引擎需方舟 <code>ark-</code> 前缀 API Key（控制台 → API Key 管理创建）。</span>
          </div>
          <div class="field">
            <label>API Key <span v-if="searchSaved" class="muted-tag">（留空则沿用已保存的）</span></label>
            <el-input v-model="searchApiKey" type="password" show-password placeholder="搜索 API Key" />
          </div>
          <div class="actions">
            <el-button :loading="searchTesting" @click="doTestSearch">测试连接</el-button>
            <el-button type="primary" class="save-btn" :loading="savingSearch" @click="doSaveSearch">保存到服务端</el-button>
            <el-button v-if="searchCfg?.has_key" text class="del-btn" @click="doClearSearch">清除配置</el-button>
            <span v-if="searchTestMsg" class="test-msg" :class="{ ok: searchTestOk, bad: searchTestOk === false }">{{ searchTestMsg }}</span>
          </div>
        </section>

        <!-- 出网访问黑名单 -->
        <section class="card">
          <div class="card-head">
            <h2>访问黑名单</h2>
            <span class="muted-tag">
              {{ denylist && denylist.effective.length ? `禁止 ${denylist.effective.length} 个条目` : '未设置 · 不限制访问' }}
            </span>
          </div>
          <p class="sub">
            智能体的 <code>web_fetch</code> / <code>web_search</code> 与浏览器工具默认<strong>可访问任意站点</strong>，
            只有此处列出的条目会被拒绝（含子域）。名单为空即完全不限制；新增/移除后即时生效、无需重启。
            条目支持域名（<code>ads.example.com</code>）、IP（<code>169.254.169.254</code>）与网段（<code>10.0.0.0/8</code>，
            仅对直连 IP 的地址生效）。此处增补保存在服务端（不入库）；默认表来自 <code>HARNESS_DOMAIN_DENYLIST</code>。
          </p>
          <div class="field">
            <label>新增禁止条目</label>
            <div class="actions">
              <el-input v-model="newDomain" placeholder="如 ads.example.com（自动去 http:// 与路径）"
                        class="w-full" @keyup.enter="doAddDenylist" />
              <el-button type="primary" :loading="denylistBusy" class="save-btn" @click="doAddDenylist">添加</el-button>
            </div>
          </div>
          <div v-if="denylist" class="field">
            <label>用户增补 <span class="muted-tag">（可删）</span></label>
            <div v-if="denylist.extra.length" class="tag-list">
              <el-tag v-for="d in denylist.extra" :key="d" type="danger" :closable="!denylistBusy" :disable-transitions="true"
                      @close="doRemoveDenylist(d)">{{ d }}</el-tag>
            </div>
            <span v-else class="muted-tag">暂无禁止条目（智能体可访问任意站点）。</span>
          </div>
          <div v-if="denylist && denylist.defaults.length" class="field">
            <label>环境变量默认 <span class="muted-tag">（只读）</span></label>
            <div class="tag-list">
              <el-tag v-for="d in denylist.defaults" :key="d" type="info" :disable-transitions="true">{{ d }}</el-tag>
            </div>
          </div>
        </section>

        <section class="card span-full">
          <!-- C1 外部 MCP server 配置（CRUD + 连通测试，写操作复用「模型接入」段的管理令牌） -->
          <McpServersPanel />
        </section>

        <section class="card span-full">
          <!-- C2 调度结果推送渠道（webhook/邮件/飞书/企微/钉钉，全局凭证 + 测试；任务级开关在「定时任务调度」tab） -->
          <NotifyPanel />
        </section>

        <!-- 语音播报（页面跳转提示音） -->
        <section class="card">
          <div class="card-head">
            <h2>语音播报</h2>
            <span class="muted-tag">{{ ttsEnabled ? '已开启' : '已关闭' }}</span>
          </div>
          <p class="sub">
            控制 AI 助手的<strong>页面跳转提示音</strong>——识别到目标自动跳转时是否朗读「正在前往…」。
            默认关闭、全程静音；AI 回复正文不会自动朗读，需要时点每条回复下方的「朗读」按钮手动播放。
            使用浏览器原生语音（Web Speech API），不联网、不上传。
          </p>
          <div class="field tts-field">
            <el-switch v-model="ttsEnabled" @change="onTtsChange" />
            <label>页面跳转时语音播报</label>
          </div>
        </section>

        <!-- 长期记忆管理 -->
        <section class="card">
          <div class="card-head">
            <h3>长期记忆管理</h3>
            <span v-if="memories.length" class="muted-tag">{{ memories.length }} 条</span>
          </div>
          <p class="sub2">
            智能体在对话中沉淀的跨会话记忆（用户偏好/复盘结论/策略经验/市场规律），按你的登录账号隔离。
            可查看、删除单条或全部清空。记忆由 <code>save_memory</code> 工具写入、<code>search_memory</code> 检索。
          </p>
          <div v-if="memoryLoading" class="hint">加载中…</div>
          <div v-else-if="!memories.length" class="hint">暂无长期记忆（智能体会在对话中自动沉淀，或未登录）</div>
          <div v-else class="mem-list">
            <div v-for="m in memories" :key="m.key" class="mem-row">
              <span class="mem-topic">{{ m.topic || 'other' }}</span>
              <span class="mem-content">{{ m.content }}</span>
              <span class="mem-time">{{ m.created_at || '' }}</span>
              <el-button text size="small" class="del-btn" @click="doDeleteMemory(m.key)"><Trash2 :size="13" /> 删除</el-button>
            </div>
          </div>
          <div v-if="memories.length" class="actions">
            <el-button text class="del-btn" @click="doClearMemories">清空全部记忆</el-button>
          </div>
        </section>
      </div>
    </div>

    <div v-show="section === 'usage'" class="pane">
      <p class="pane-desc">真实计量的模型调用量、token 消耗与平均延迟，可见范围按角色隔离。</p>
      <div class="pane-body cols-1">
        <!-- LLM 用量统计（按角色隔离：管理员全站+按公司，用户本公司） -->
        <section class="card span-full">
          <div class="card-head">
            <h2>{{ usageIsAdmin ? '全站用量统计' : '本公司用量统计' }}</h2>
            <span class="muted-tag">真实计量 · model_calls{{ usageIsAdmin ? ' · 按公司' : '' }}</span>
            <el-radio-group v-model="usageSinceHours" size="small" @change="loadUsage">
              <el-radio-button :value="24">近 24 小时</el-radio-button>
              <el-radio-button :value="168">近 7 天</el-radio-button>
            </el-radio-group>
          </div>
          <p class="sub">
            {{ usageIsAdmin
              ? '全站已配置模型的调用次数、token 消耗与平均延迟（按公司/厂商/模型/角色聚合）。'
              : '本公司的模型调用次数、token 消耗与平均延迟（按厂商/模型/角色聚合）。' }}
            生成报告或对话后此处会有数据。
          </p>
          <div v-if="usageError" class="hint">无法连接智能体后端获取用量（请先启动后端 npm run dev:agent-api）</div>
          <div v-else-if="usageLoading" class="hint">加载中…</div>
          <div v-else-if="!usageRows.length" class="hint">暂无调用记录（生成报告/对话后会有）</div>
          <el-table v-else :data="usageRows" size="small" stripe>
            <el-table-column v-if="usageIsAdmin" prop="company_id" label="公司" min-width="120" show-overflow-tooltip />
            <el-table-column prop="provider" label="厂商" min-width="110" />
            <el-table-column prop="model" label="模型" min-width="160" show-overflow-tooltip />
            <el-table-column prop="role" label="角色" min-width="110" />
            <el-table-column prop="calls" label="调用数" width="90" align="right" />
            <el-table-column prop="input_tokens" label="输入 token" width="110" align="right" />
            <el-table-column prop="output_tokens" label="输出 token" width="110" align="right" />
            <el-table-column prop="avg_latency_ms" label="平均延迟(ms)" width="120" align="right" />
          </el-table>
        </section>
      </div>
    </div>
  </div>
</template>

<style scoped>
.tts-field { display: flex; align-items: center; gap: 10px; }
.tts-field label { margin: 0; }
/* 页面 = 分段导航 + 单个可见分段；卡片的两列排布收敛在 .pane-body 里，
   不再由页面级 grid 按 DOM 顺序「流」，那正是旧版卡片看着零散的根因。 */
.ai-settings { display: flex; flex-direction: column; gap: 18px; }
.section-nav { align-self: flex-start; }
.pane { display: flex; flex-direction: column; gap: 14px; }
.pane-desc {
  margin: 0;
  font-size: var(--font-md);
  line-height: 1.7;
  color: var(--muted);
}
.pane-body { display: grid; gap: 18px; align-items: start; }
.pane-body.cols-1 { grid-template-columns: minmax(0, 1fr); }
.pane-body.cols-2 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
.pane-body.cols-main-aside { grid-template-columns: minmax(0, 1.4fr) minmax(280px, 0.9fr); }
.span-full { grid-column: 1 / -1; }
.card {
  background: var(--panel);
  border: 1px solid var(--line-soft);
  border-radius: 16px;
  padding: 24px 26px;
  box-shadow: 0 12px 30px -22px rgba(16, 60, 60, 0.35);
}
.card-head { display: flex; align-items: center; gap: 12px; }
.card-head h2 { margin: 0; font-size: var(--font-20); color: var(--text); }
.skills-link {
  margin-left: auto; display: inline-flex; align-items: center; gap: 5px;
  font-size: var(--font-md); color: var(--primary); text-decoration: none;
  padding: 5px 12px; border: 1px solid var(--primary-tint-border);
  background: var(--primary-tint); border-radius: 999px;
}
.skills-link:hover { background: var(--primary); color: #fff; }
.badge-ok {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 3px 10px; border-radius: 999px; font-size: var(--font-sm);
  color: var(--primary); background: var(--primary-tint); border: 1px solid var(--primary-tint-border);
}
.sub { margin: 10px 0 22px; font-size: var(--font-md); line-height: 1.7; color: var(--muted); }
.sub strong { color: var(--primary); }

.field { margin-bottom: 18px; }
.field label { display: block; margin-bottom: 7px; font-size: var(--font-md); font-weight: 600; color: var(--text-body); }
.muted-tag { font-weight: 400; font-size: var(--font-sm); color: var(--el-text-color-secondary); }
.w-full { width: 100%; }
.hint { display: block; margin-top: 6px; font-size: var(--font-sm); color: var(--el-text-color-secondary); }

.actions { display: flex; align-items: center; gap: 10px; margin-top: 6px; }
.tag-list { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 4px; }
.save-btn { background: var(--primary); border-color: var(--primary); }
.test-msg { font-size: var(--font-md); }
.test-msg.ok { color: var(--primary); }
.test-msg.bad { color: var(--danger); }

.saved-title { font-size: var(--font-md); font-weight: 600; color: var(--text-body); margin-bottom: 10px; }
.del-btn { margin-left: auto; color: var(--danger); }

.tip-card h3 { margin: 0; font-size: var(--font-15); color: var(--text); }
.tip-list { margin: 14px 0 0; padding-left: 18px; display: flex; flex-direction: column; gap: 9px; font-size: var(--font-md); line-height: 1.6; color: var(--muted); }
.tip-list strong { color: var(--text-body); }
.admin-field { margin: 18px 0 0; padding-top: 14px; border-top: 1px solid var(--line-faint); }

/* 卡片内小标题（采样参数 / 路由 / 工作流 / 记忆等用 h3 而非 h2） */
.card h3 { margin: 0 0 6px; font-size: var(--font-16); color: var(--text); }
.sub2 { margin: 0 0 18px; font-size: var(--font-12-5); line-height: 1.6; color: var(--muted); }

.param-row { display: flex; flex-wrap: wrap; gap: 18px; align-items: flex-end; }
.pfield { display: flex; flex-direction: column; gap: 6px; }
.pfield label { font-size: var(--font-12-5); font-weight: 600; color: var(--text-body); }
.pfield label small { font-weight: 400; color: var(--el-text-color-secondary); }

.ov-block { margin-top: 22px; padding-top: 16px; border-top: 1px solid var(--line-faint); }
.ov-list { display: flex; flex-direction: column; gap: 6px; margin-bottom: 12px; }
.ov-row { display: flex; align-items: center; gap: 12px; font-size: var(--font-md); padding: 5px 0; border-bottom: 1px solid var(--line-faint); }
.ov-ref { font-weight: 600; color: var(--text-body); font-family: var(--font-mono, ui-monospace, monospace); }
.ov-vals { display: flex; gap: 10px; color: var(--el-text-color-secondary); font-size: var(--font-sm); }
.ov-add { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; }
.ov-select { min-width: 240px; }

.route-table { display: flex; flex-direction: column; gap: 4px; }
.route-row { display: flex; align-items: center; gap: 16px; padding: 7px 0; border-bottom: 1px solid var(--line-faint); }
.route-name { min-width: 180px; font-size: var(--font-md); font-weight: 600; color: var(--text-body); display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.cap-tag { font-size: var(--font-10-5); font-weight: 500; color: var(--primary); background: var(--primary-tint); padding: 0 6px; border-radius: 999px; }
.route-select { flex: 1; max-width: 380px; }

.wf-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 18px; margin-bottom: 16px; }
.wf-field { display: flex; flex-direction: column; gap: 6px; }
.wf-field label { font-size: var(--font-12-5); font-weight: 600; color: var(--text-body); }

@media (max-width: 1180px) {
  /* 窄屏收单列：两列卡片挤在一起比纵向排列更难读 */
  .pane-body.cols-2,
  .pane-body.cols-main-aside { grid-template-columns: minmax(0, 1fr); }
  .route-name { min-width: 120px; }
}
@media (max-width: 768px) {
  .wf-grid { grid-template-columns: 1fr; }
  .ov-select { min-width: 0; width: 100%; }
  .section-nav { align-self: stretch; }
}
</style>
