<script setup lang="ts">
// 四川开放平台凭据录入卡片（Epic #1618 / #1620；#1925 接入通用凭据层）。
//
// 录入的凭据由 Java 采集服务（integrations/sichuan-ingest/，8090）读取——「当前生效」
// 那套物化到采集服务读的文件，故保存后免重启生效。
//
// #1925 起凭据**按录入账号分记录**：
//   - 本卡片只显示「我自己的记录」的掩码；别人的记录连掩码都看不到（账号级隔离）。
//   - 每个接入点实际生效的只有一套（无人值守采集用它）：最后一次**完整**保存者生效。
//     生效者不是我时，卡片顶部有显著提示——否则会出现「我改了却没生效」而无从察觉。
//   - 「测试连通」测的是**当前生效那套**，不是我的草稿。
//
// 安全：六项密钥一律 password 输入，保存成功即清空输入框（不在浏览器留明文）；
// 服务端只回掩码，前端任何路径拿不到明文。
import { computed, onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { KeyRound, RefreshCw, ShieldCheck, Trash2, UserCheck, Zap } from 'lucide-vue-next'

import { ApiError } from '@/services/api'
import {
  clearGridCredentials,
  fetchGridCredentialStatus,
  saveGridCredentials,
  testGridCredentials,
  type GridCredentialInput,
  type GridCredentialStatus,
  type GridCredentialTestReport,
} from '@/services/gridAccess'

const POINT_ID = 'sgcc-sichuan'

const status = ref<GridCredentialStatus | null>(null)
// **只存已写回当前生效凭据版本的结论**。服务端在「测试期间生效凭据被换了」时会丢弃结论
// （recorded:false），若这里仍留着它，testTone/testText/tokenMeta 会优先读它，
// 页面照样显示绿色「凭据有效」+ 令牌有效期——旁边加一句警告压不住这种误导。
// 被丢弃的结论只进 discardedNotice，不参与状态区渲染。
const lastTest = ref<GridCredentialTestReport | null>(null)
const discardedNotice = ref<string | null>(null)
const forbidden = ref(false)
const loading = ref(false)
const saving = ref(false)
const testing = ref(false)

// 六项密钥的输入态。字段名与服务端/Java 侧逐字对应，不可自由改名。
const form = ref<Record<string, string>>({
  appId: '',
  appSecret: '',
  sm4Key: '',
  sm4Iv: '',
  sm2PrivateKey: '',
  sm2PublicKey: '',
})
const baseAddressInput = ref('')
const accessTokenUriInput = ref('')

// 展示顺序即开放平台后台的排列顺序，减少对照复制时的来回找。
const SECRET_FIELDS: Array<{ key: string; label: string; hint: string }> = [
  { key: 'appId', label: 'appId（应用 ID）', hint: '开放平台「我的应用」中的应用 ID' },
  { key: 'appSecret', label: 'appSecret（应用密钥）', hint: '与 appId 成对，泄露即等同账号泄露' },
  { key: 'sm4Key', label: 'sm4Key（国密 SM4 对称密钥）', hint: '32 位十六进制' },
  { key: 'sm4Iv', label: 'sm4Iv（国密 SM4 初始向量）', hint: '32 位十六进制' },
  { key: 'sm2PrivateKey', label: 'sm2PrivateKey（国密 SM2 私钥）', hint: '64 位十六进制' },
  { key: 'sm2PublicKey', label: 'sm2PublicKey（国密 SM2 公钥）', hint: '以 04 开头的 130 位十六进制' },
]

const own = computed(() => status.value?.own ?? null)
const effective = computed(() => status.value?.effective ?? null)

const configuredLabel = computed(() => {
  if (!own.value) return effective.value ? '我未录入（他人的凭据在生效）' : '未配置'
  if (own.value.configured) return '我的六项密钥齐全'
  return `我已录入 ${own.value.filledCount}/${own.value.totalCount} 项`
})

// 生效者提示：生效的不是我 → 显著提醒（我的保存会在补齐后接管生效集）。
const effectiveNotice = computed(() => {
  const eff = effective.value
  if (!eff) return null
  const time = eff.updatedAt ? new Date(eff.updatedAt).toLocaleString() : '时间未知'
  if (eff.ownedByViewer) return { tone: 'ok', text: `当前生效：我本人录入的凭据（${time}）——无人值守采集用的就是这套。` }
  return {
    tone: 'warn',
    text: `当前生效：账号「${eff.owner}」录入的凭据（${time}）。我看不到其内容（账号级隔离）；`
      + '我保存一套完整凭据后会接管生效集，采集随即改用我的。',
  }
})

const testTone = computed(() => {
  const result = lastTest.value?.result ?? effective.value?.lastTest?.result
  if (result === 'ok') return 'success'
  // 配置错误一律标红要人去改：credentialRejected（平台拒了这套密钥）、
  // credentialMalformed（密钥粘错了）、endpointRejected（端点配错了）。
  // unreachable/serviceDown/platformError 不是配置问题，标中性——把它们染红会误导人
  // 去改一套本来正确的凭据。platformError 尤其如此：那是平台自己 5xx 了。
  if (result === 'credentialRejected' || result === 'credentialMalformed'
    || result === 'endpointRejected' || result === 'error') return 'danger'
  return 'info'
})

const testText = computed(() => {
  const test = lastTest.value ?? effective.value?.lastTest
  if (!test) return '尚未测试'
  const time = test.checkedAt ? `（${new Date(test.checkedAt).toLocaleString()}）` : ''
  return `${test.msg ?? test.result}${time}`
})

// 令牌有效期只在测试成功时有意义，且只展示元信息——令牌本身服务端就不会返回。
const tokenMeta = computed(() => {
  const test = lastTest.value
  if (!test || test.result !== 'ok') return null
  const parts: string[] = []
  if (test.tokenType) parts.push(`类型 ${test.tokenType}`)
  if (typeof test.expiresIn === 'number') parts.push(`有效期 ${Math.round(test.expiresIn / 60)} 分钟`)
  if (test.expiresAt) parts.push(`到期 ${new Date(test.expiresAt).toLocaleString()}`)
  return parts.length ? parts.join(' · ') : null
})

async function load() {
  loading.value = true
  try {
    status.value = await fetchGridCredentialStatus(POINT_ID)
    baseAddressInput.value = own.value?.baseAddress ?? ''
    accessTokenUriInput.value = own.value?.accessTokenUri ?? ''
    forbidden.value = false
  } catch (error) {
    if (error instanceof ApiError && error.status === 403) forbidden.value = true
    else ElMessage.error('无法加载四川开放平台凭据状态：请确认后端(4174)已启动')
  } finally {
    loading.value = false
  }
}

function collectInput(): GridCredentialInput {
  const payload: Record<string, string> = {}
  for (const field of SECRET_FIELDS) {
    const value = form.value[field.key]?.trim()
    if (value) payload[field.key] = value
  }
  const base = baseAddressInput.value.trim()
  // 只在与本人记录现值不同时才提交端点：否则每次保存都会带上端点，
  // 让「改了什么」在审计字段里失真。
  if (base && base !== (own.value?.baseAddress ?? '')) payload.baseAddress = base
  const tokenUri = accessTokenUriInput.value.trim()
  if (tokenUri && tokenUri !== (own.value?.accessTokenUri ?? '')) payload.accessTokenUri = tokenUri
  return payload as GridCredentialInput
}

async function save() {
  const payload = collectInput()
  if (Object.keys(payload).length === 0) {
    ElMessage.warning('没有要保存的内容：请至少填写一项密钥，或修改端点地址')
    return
  }
  saving.value = true
  try {
    status.value = await saveGridCredentials(POINT_ID, payload)
    for (const field of SECRET_FIELDS) form.value[field.key] = ''
    baseAddressInput.value = own.value?.baseAddress ?? ''
    accessTokenUriInput.value = own.value?.accessTokenUri ?? ''
    // 凭据已变，任何旧结论（含上一次被丢弃的提示）都过期了。
    lastTest.value = null
    discardedNotice.value = null
    if (status.value?.becameEffective) {
      ElMessage.success('凭据已保存并成为当前生效集（免重启生效），建议立即「测试连通」')
    } else {
      ElMessage.success(`已保存草稿，还差：${own.value?.missing.join('、') ?? '若干项'}——补齐后才会接管生效集`)
    }
  } catch (error) {
    ElMessage.error(error instanceof ApiError ? (error.payload.msg ?? '保存失败') : '保存失败')
  } finally {
    saving.value = false
  }
}

async function testConnection() {
  testing.value = true
  try {
    const report = await testGridCredentials(POINT_ID)
    if (report && report.recorded === false) {
      // 服务端已丢弃这份结论——它测的不是当前生效凭据。这里也必须丢弃，否则状态区
      // 会拿它渲染成「凭据有效」。清空后状态区回落到 effective.lastTest（服务端权威值）。
      lastTest.value = null
      discardedNotice.value = report.notRecordedReason ?? '本次测试结论未写回，请重新测试'
      await load()
      ElMessage.warning(discardedNotice.value)
      return
    }
    lastTest.value = report
    discardedNotice.value = null
    await load()
    if (report?.result === 'ok') ElMessage.success('生效凭据有效，已成功换取访问令牌')
    else ElMessage.warning(report?.msg ?? '连通测试未通过')
  } catch (error) {
    ElMessage.error(error instanceof ApiError ? (error.payload.msg ?? '连通测试失败') : '连通测试失败')
  } finally {
    testing.value = false
  }
}

async function clear() {
  try {
    status.value = await clearGridCredentials(POINT_ID)
    for (const field of SECRET_FIELDS) form.value[field.key] = ''
    baseAddressInput.value = own.value?.baseAddress ?? ''
    accessTokenUriInput.value = own.value?.accessTokenUri ?? ''
    lastTest.value = null
    discardedNotice.value = null
    const fallback = status.value?.effectiveFallback
    if (fallback === 'switched') {
      ElMessage.success('已删除我的记录；生效集回退到另一名管理员最近保存的完整凭据')
    } else if (fallback === 'cleared') {
      ElMessage.success('已删除我的记录且无可回退凭据；采集将以「凭据不完整」失败并记审计，不会静默空跑')
    } else {
      ElMessage.success('已删除我录入的凭据记录')
    }
  } catch (error) {
    ElMessage.error(error instanceof ApiError ? (error.payload.msg ?? '清除失败') : '清除失败')
  }
}

onMounted(load)
</script>

<template>
  <section class="sc-cred-card" v-loading="loading">
    <div class="head">
      <div class="icon"><Zap :size="20" /></div>
      <div>
        <small>SICHUAN OPEN PLATFORM · SM2/SM4</small>
        <h3>四川开放平台凭据（pmos.sc.sgcc.com.cn）</h3>
      </div>
      <span v-if="!forbidden" :class="['state', own?.configured ? 'ready' : '']">{{ configuredLabel }}</span>
    </div>

    <div v-if="forbidden" class="forbidden">
      仅系统管理员(ADMIN/BOSS)可管理四川开放平台凭据。请联系管理员配置，或切换管理员账号。
    </div>

    <template v-else>
      <p class="desc">
        国网「新一代电力交易平台」四川省级开放平台的对接凭据，用于采集四川信息披露数据
        （次月系统负荷预测、次月主要库容水库消落计划）。
        <strong>凭据在此录入后由独立的 Java 采集服务读取，无需重启任何服务</strong>；
        采集与写库在前端和 Node API 停机期间照常进行。
        六项密钥来自开放平台后台，<strong>可以分批粘贴</strong>——留空的字段保持我的记录原值。
        凭据按录入账号分记录：<strong>这里只显示我自己录入的内容，别人的记录连掩码都不可见</strong>。
      </p>

      <div v-if="effectiveNotice" :class="['effective-banner', effectiveNotice.tone]">
        <UserCheck :size="14" />
        <span>{{ effectiveNotice.text }}</span>
      </div>
      <div v-else class="effective-banner warn">
        <UserCheck :size="14" />
        <span>当前没有任何生效凭据——无人值守采集会以「凭据不完整」失败。保存一套完整凭据后即生效。</span>
      </div>

      <div class="status-grid">
        <div><label>appId</label><span>{{ own?.masked?.appId ?? '未配置' }}</span></div>
        <div><label>appSecret</label><span>{{ own?.masked?.appSecret ?? '未配置' }}</span></div>
        <div><label>sm4Key</label><span>{{ own?.masked?.sm4Key ?? '未配置' }}</span></div>
        <div><label>sm4Iv</label><span>{{ own?.masked?.sm4Iv ?? '未配置' }}</span></div>
        <div><label>sm2PrivateKey</label><span>{{ own?.masked?.sm2PrivateKey ?? '未配置' }}</span></div>
        <div><label>sm2PublicKey</label><span>{{ own?.masked?.sm2PublicKey ?? '未配置' }}</span></div>
        <div class="wide"><label>平台基址（我的记录）</label><span>{{ own?.baseAddress ?? '未配置' }}</span></div>
        <div class="wide"><label>令牌端点（我的记录）</label><span>{{ own?.accessTokenUri ?? '未配置' }}</span></div>
        <div class="wide">
          <label>我最近更新</label>
          <span>{{ own?.updatedAt ? new Date(own.updatedAt).toLocaleString() : '—' }}</span>
        </div>
        <div class="wide">
          <label>生效凭据连通状态</label>
          <span :class="`test-${testTone}`">{{ testText }}</span>
        </div>
        <div v-if="tokenMeta" class="wide"><label>访问令牌</label><span>{{ tokenMeta }}</span></div>
      </div>

      <div v-if="discardedNotice" class="missing-note">{{ discardedNotice }}</div>

      <div v-if="own && !own.configured && own.filledCount > 0" class="missing-note">
        还差 {{ own.missing.length }} 项未录入：<code>{{ own.missing.join('、') }}</code>。
        补齐前我的记录只是草稿，不会接管生效集。
      </div>

      <div v-for="field in SECRET_FIELDS" :key="field.key" class="field">
        <label>{{ field.label }}</label>
        <el-input
          v-model="form[field.key]"
          type="password"
          show-password
          :placeholder="own?.masked?.[field.key as keyof NonNullable<typeof own>['masked']] ? `已配置，留空则不修改（${field.hint}）` : field.hint"
        />
      </div>

      <div class="field">
        <label>平台基址</label>
        <el-input v-model="baseAddressInput" :placeholder="status?.defaultBaseAddress ?? 'https://pmos.sc.sgcc.com.cn'" />
        <small class="field-hint">
          必须是<strong>省级</strong>平台。指向总部 <code>pmos.sgcc.com.cn</code> 会被服务端拒绝——
          四川数据只在省级平台，打到总部要么 404，要么取到别省口径的数据。
        </small>
      </div>
      <div class="field">
        <label>令牌端点（可选）</label>
        <el-input v-model="accessTokenUriInput" placeholder="留空则按基址推导 /px-common-defense/oauth/token" />
      </div>

      <div class="actions">
        <el-button type="primary" :loading="saving" @click="save"><KeyRound :size="13" />保存到服务端</el-button>
        <el-button :loading="testing" @click="testConnection"><RefreshCw :size="13" />测试连通</el-button>
        <el-button v-if="own && own.filledCount > 0" text class="danger" @click="clear">
          <Trash2 :size="13" />删除我录入的凭据
        </el-button>
      </div>

      <ul class="notes">
        <li>「测试连通」会用<strong>当前生效那套凭据</strong>真实向省级平台换取一次访问令牌，<strong>不拉业务数据、不写任何表</strong>。</li>
        <li>测试由 Java 采集服务执行（用的就是采集时的同一条代码路径）；采集服务未启动时会明确提示「服务未响应」，此时凭据并未被验证。</li>
        <li>凭据只保存在服务端本地（<code>data/private/</code>，不入 git），接口只返回掩码，浏览器与仓库均不留明文。</li>
      </ul>

      <div class="guards">
        <span><ShieldCheck :size="13" />仅 ADMIN/BOSS 可读写</span>
        <span><ShieldCheck :size="13" />永不回明文</span>
        <span><ShieldCheck :size="13" />按账号隔离</span>
        <span><ShieldCheck :size="13" />拒绝总部地址</span>
        <span><ShieldCheck :size="13" />免重启生效</span>
      </div>
    </template>
  </section>
</template>

<style scoped>
.sc-cred-card { grid-column: 1 / -1; padding: 24px 26px; border: 1px solid rgba(180, 83, 9, .3); border-radius: 16px; background: radial-gradient(circle at 94% 0, rgba(217, 119, 6, .1), transparent 38%), var(--panel); box-shadow: 0 12px 30px -22px rgba(60, 40, 16, .35); }
.head { display: flex; align-items: center; gap: 11px; }
.icon { display: grid; width: 40px; height: 40px; place-items: center; color: #b45309; border: 1px solid rgba(180, 83, 9, .24); border-radius: 11px; background: rgba(180, 83, 9, .08); }
.head small { display: block; color: #b45309; font-size: 9px; font-weight: 800; letter-spacing: .14em; }
.head h3 { margin: 2px 0 0; color: var(--text); font-size: 16px; }
.state { margin-left: auto; padding: 4px 9px; border: 1px solid var(--line-soft); border-radius: 999px; color: #9a6700; background: rgba(245, 184, 58, .1); font-size: 11px; }
.state.ready { color: #15803d; background: #f0faf3; border-color: #b7e1c2; }
.desc { margin: 14px 0; color: var(--text-weak); font-size: 12.5px; line-height: 1.75; }
.forbidden { margin-top: 14px; padding: 12px 14px; border: 1px solid #f3b4b4; border-radius: 8px; color: #b91c1c; background: #fef2f2; font-size: 13px; }
.effective-banner { display: flex; align-items: flex-start; gap: 8px; margin-bottom: 14px; padding: 10px 12px; border-radius: 8px; font-size: 12.5px; line-height: 1.6; }
.effective-banner svg { flex-shrink: 0; margin-top: 2px; }
.effective-banner.ok { border: 1px solid #b7e1c2; background: #f0faf3; color: #166534; }
.effective-banner.warn { border: 1px solid rgba(217, 119, 6, .28); background: rgba(245, 184, 58, .08); color: #92400e; }
.status-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px 18px; margin-bottom: 16px; padding: 14px 16px; border: 1px dashed var(--line-soft); border-radius: 10px; }
.status-grid div { display: flex; flex-direction: column; gap: 2px; font-size: 13px; }
.status-grid label { color: var(--text-weak); font-size: 12px; }
.status-grid span { color: var(--text); word-break: break-all; }
.status-grid .wide { grid-column: span 3; }
.test-success { color: #15803d; }
.test-danger { color: #b91c1c; }
.test-info { color: var(--text-weak); }
.missing-note { margin-bottom: 14px; padding: 10px 12px; border: 1px solid rgba(217, 119, 6, .28); border-radius: 8px; color: #92400e; background: rgba(245, 184, 58, .08); font-size: 12.5px; }
.field { margin-bottom: 14px; }
.field label { display: block; margin-bottom: 6px; color: var(--text); font-size: 13px; }
.field-hint { display: block; margin-top: 6px; color: var(--text-weak); font-size: 11.5px; line-height: 1.6; }
.notes { margin: 16px 0 0; padding-left: 18px; color: var(--text-weak); font-size: 12px; line-height: 1.8; }
.notes code, .desc code, .missing-note code, .field-hint code { padding: 0 4px; border-radius: 3px; background: rgba(0, 0, 0, .05); }
.actions, .guards { display: flex; flex-wrap: wrap; align-items: center; gap: 9px; }
.actions :deep(.el-button) { gap: 5px; }
.danger { color: #b91c1c; }
.guards { margin-top: 16px; }
.guards span { display: inline-flex; align-items: center; gap: 5px; padding: 6px 8px; color: var(--text-weak); border: 1px solid var(--line-soft); border-radius: 8px; font-size: 11px; }
.guards svg { color: #159570; }
@media (max-width: 720px) { .status-grid { grid-template-columns: 1fr; } .status-grid .wide { grid-column: auto; } .state { display: none; } }
</style>
