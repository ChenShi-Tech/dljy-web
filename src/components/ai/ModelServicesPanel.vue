<script setup lang="ts">
// 模型服务「选服务」面（主仓 Epic #2661 · #2668）。
//
// 前端不再持有供应商 / 型号 / 密钥：档位清单来自服务端 GET /llm/services（网关模式下由
// dljy-llm-gateway 的 /v1/models 换算而来，只剩中文标签与能力位），用户只做两件事——
// 勾选启用哪些档位、把角色路由到已启用档位。密钥在安装时预置在服务端，页面上没有密钥输入。
//
// 网关不可达 / 未配网关 → 服务端诚实返回 available:false + reason，这里原样显示
// 「模型服务暂不可用」并禁用编辑，不伪造清单、不静默降级。
//
// 本组件同时服务两个档：内部档嵌在「AI 模型设置」页的「模型接入」分段里；交付档作为
// AI 工作室的「模型服务」tab 单独出现——它不含任何品牌信息，所以能进交付产物
// （产物由 verify:customer-edition-build 扫，源码由 edition.brand-keywords.spec 扫）。
import { computed, onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { CheckCircle2, RefreshCw } from 'lucide-vue-next'
import {
  getServices,
  putServices,
  testService,
  type LlmServices,
  type LlmServiceRole,
  type LlmServiceTier
} from '@/services/llm'
import { ROLE_LABELS } from '@/services/agent/agentConfig'

const emit = defineEmits<{ loaded: [services: LlmServices] }>()

const services = ref<LlmServices | null>(null)
const loading = ref(false)
const loadError = ref('')
const saving = ref(false)
const testing = ref<string>('')
const testResult = ref<Record<string, { ok: boolean; msg: string }>>({})

/** 能力位 → 中文（未知能力位原样显示，不吞） */
const CAP_LABELS: Record<string, string> = {
  tool_call: '工具调用',
  vision: '图像理解',
  json_mode: '结构化输出',
  reasoning: '深度推理',
  long_context: '长上下文'
}
const capLabel = (cap: string) => CAP_LABELS[cap] ?? cap
const roleLabel = (role: string) => ROLE_LABELS[role] ?? role

const available = computed(() => services.value?.available === true)
const unavailableReason = computed(() => {
  const s = services.value
  if (!s) return loadError.value || '正在连接服务端…'
  return s.reason || (s.gateway ? '网关未返回任何档位' : '未配置模型服务网关')
})
const enabledTiers = computed(() => (services.value?.tiers ?? []).filter((t) => t.enabled && t.available))

/** 该角色可选的档位：已启用 + 具备所需能力（与服务端 PUT 的校验同口径，避免选了再被拒） */
function tiersForRole(role: LlmServiceRole): LlmServiceTier[] {
  return enabledTiers.value.filter((t) => role.requires.every((cap) => t.capabilities.includes(cap)))
}

function formatContext(n: number | null): string {
  if (!n) return ''
  return n >= 1000 ? `${Math.round(n / 1000)}k 上下文` : `${n} 上下文`
}

async function load() {
  loading.value = true
  loadError.value = ''
  try {
    services.value = await getServices()
    emit('loaded', services.value)
  } catch (e) {
    services.value = null
    loadError.value = e instanceof Error ? `无法连接智能体后端：${e.message}` : '无法连接智能体后端'
  } finally {
    loading.value = false
  }
}
onMounted(load)

async function apply(body: { enabled?: string[]; roles?: Record<string, string> }, okMsg: string) {
  if (saving.value) return
  saving.value = true
  try {
    const r = await putServices(body)
    if (r.ok && r.services) {
      services.value = r.services
      emit('loaded', r.services)
      ElMessage.success(okMsg)
    } else {
      ElMessage.error(`保存失败：${r.msg ?? '未知错误'}`)
      // 服务端拒绝时回读一次，把界面拉回服务端真实状态（开关不能停在「看似已改」的位置）
      await load()
    }
  } finally {
    saving.value = false
  }
}

function onToggleTier(tier: LlmServiceTier, on: boolean) {
  const current = new Set(enabledTiers.value.map((t) => t.id))
  if (on) current.add(tier.id)
  else current.delete(tier.id)
  void apply({ enabled: [...current] }, on ? `已启用「${tier.label}」` : `已停用「${tier.label}」`)
}

function onRoleChange(role: LlmServiceRole, tier: string) {
  // 选回默认即清除覆盖（空串 = 恢复默认路由）
  const target = tier === role.default_tier ? '' : tier
  void apply({ roles: { [role.role]: target } }, `${roleLabel(role.role)} 已路由到「${tierLabel(tier)}」`)
}

function tierLabel(id: string): string {
  return services.value?.tiers.find((t) => t.id === id)?.label ?? id
}

async function doTest(tier: LlmServiceTier) {
  testing.value = tier.id
  try {
    testResult.value = { ...testResult.value, [tier.id]: await testService(tier.id) }
  } finally {
    testing.value = ''
  }
}
</script>

<template>
  <section class="card services-card">
    <div class="card-head">
      <h2>模型服务</h2>
      <span v-if="available" class="badge-ok"><CheckCircle2 :size="14" /> 服务可用</span>
      <el-button text size="small" class="reload-btn" :loading="loading" @click="load">
        <RefreshCw :size="13" /> 刷新
      </el-button>
    </div>
    <p class="sub">
      智能体使用的大模型由<strong>模型服务</strong>统一提供，按能力分为若干<strong>档位</strong>。
      这里只需勾选启用哪些档位、并为各智能体角色指定档位；密钥已随安装预置在服务端，页面不涉及任何密钥。
    </p>

    <el-alert
      v-if="!available"
      type="warning"
      :closable="false"
      show-icon
      class="unavailable"
      title="模型服务暂不可用"
      :description="unavailableReason"
    />

    <template v-else-if="services">
      <div class="tier-grid">
        <div
          v-for="t in services.tiers"
          :key="t.id"
          class="tier-card"
          :class="{ off: !t.enabled || !t.available, unavailable: !t.available }"
        >
          <div class="tier-head">
            <span class="tier-label">{{ t.label }}</span>
            <el-switch
              :model-value="t.enabled && t.available"
              :disabled="!t.available || saving"
              size="small"
              @change="(v: string | number | boolean) => onToggleTier(t, v === true)"
            />
          </div>
          <p class="tier-desc">{{ t.description || '—' }}</p>
          <div class="tier-caps">
            <span v-for="cap in t.capabilities" :key="cap" class="cap-tag">{{ capLabel(cap) }}</span>
            <span v-if="t.context_window" class="cap-tag ctx">{{ formatContext(t.context_window) }}</span>
          </div>
          <div class="tier-foot">
            <span v-if="!t.available" class="tier-note bad">未开通——请联系供应方</span>
            <template v-else>
              <el-button text size="small" :loading="testing === t.id" @click="doTest(t)">测试连接</el-button>
              <span
                v-if="testResult[t.id]"
                class="test-msg"
                :class="{ ok: testResult[t.id].ok, bad: !testResult[t.id].ok }"
              >{{ testResult[t.id].msg }}</span>
            </template>
          </div>
        </div>
      </div>

      <div class="roles-block">
        <div class="roles-title">角色 → 档位</div>
        <p class="sub2">每个智能体角色只能路由到<strong>已启用且具备所需能力</strong>的档位；选回默认档位即恢复默认路由。</p>
        <div class="route-table">
          <div v-for="role in services.roles" :key="role.role" class="route-row">
            <span class="route-name">
              {{ roleLabel(role.role) }}
              <span v-for="cap in role.requires" :key="cap" class="cap-tag">{{ capLabel(cap) }}</span>
            </span>
            <el-select
              :model-value="role.tier ?? ''"
              class="route-select"
              :disabled="saving"
              :placeholder="role.tier ? '' : '默认档位未开通'"
              @change="(v: string) => onRoleChange(role, v)"
            >
              <el-option
                v-for="t in tiersForRole(role)"
                :key="t.id"
                :label="t.label + (t.id === role.default_tier ? '（默认）' : '')"
                :value="t.id"
              />
            </el-select>
            <span v-if="role.override" class="muted-tag">已覆盖</span>
          </div>
        </div>
      </div>
    </template>
  </section>
</template>

<style scoped>
.services-card { display: flex; flex-direction: column; }
.card {
  background: var(--panel);
  border: 1px solid var(--line-soft);
  border-radius: 16px;
  padding: 24px 26px;
  box-shadow: 0 12px 30px -22px rgba(16, 60, 60, 0.35);
}
.card-head { display: flex; align-items: center; gap: 12px; }
.card-head h2 { margin: 0; font-size: var(--font-20); color: var(--text); }
.reload-btn { margin-left: auto; }
.badge-ok {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 3px 10px; border-radius: 999px; font-size: var(--font-sm);
  color: var(--primary); background: var(--primary-tint); border: 1px solid var(--primary-tint-border);
}
.sub { margin: 10px 0 18px; font-size: var(--font-md); line-height: 1.7; color: var(--muted); }
.sub strong { color: var(--primary); }
.sub2 { margin: 0 0 14px; font-size: var(--font-12-5); line-height: 1.6; color: var(--muted); }
.unavailable { margin-top: 4px; }

.tier-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 12px; }
.tier-card {
  display: flex; flex-direction: column; gap: 8px;
  padding: 14px 16px; border: 1px solid var(--line-soft); border-radius: 12px;
  background: var(--panel);
}
.tier-card.off { opacity: 0.72; }
.tier-card.unavailable { border-style: dashed; }
.tier-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.tier-label { font-size: var(--font-15); font-weight: 600; color: var(--text); }
.tier-desc { margin: 0; font-size: var(--font-sm); line-height: 1.6; color: var(--el-text-color-secondary); min-height: 2.6em; }
.tier-caps { display: flex; flex-wrap: wrap; gap: 6px; }
.cap-tag { font-size: var(--font-10-5); font-weight: 500; color: var(--primary); background: var(--primary-tint); padding: 0 6px; border-radius: 999px; }
.cap-tag.ctx { color: var(--el-text-color-secondary); background: var(--line-faint); }
.tier-foot { display: flex; align-items: center; gap: 8px; min-height: 24px; }
.tier-note { font-size: var(--font-sm); }
.test-msg { font-size: var(--font-sm); }
.test-msg.ok, .tier-note.ok { color: var(--primary); }
.test-msg.bad, .tier-note.bad { color: var(--danger); }

.roles-block { margin-top: 22px; padding-top: 16px; border-top: 1px solid var(--line-faint); }
.roles-title { font-size: var(--font-md); font-weight: 600; color: var(--text-body); margin-bottom: 6px; }
.route-table { display: flex; flex-direction: column; gap: 4px; }
.route-row { display: flex; align-items: center; gap: 16px; padding: 7px 0; border-bottom: 1px solid var(--line-faint); }
.route-name { min-width: 180px; font-size: var(--font-md); font-weight: 600; color: var(--text-body); display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.route-select { flex: 1; max-width: 320px; }
.muted-tag { font-weight: 400; font-size: var(--font-sm); color: var(--el-text-color-secondary); }

@media (max-width: 1180px) {
  .route-name { min-width: 120px; }
}
</style>
