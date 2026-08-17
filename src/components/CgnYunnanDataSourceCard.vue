<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { Building2, KeyRound, RefreshCw, ShieldCheck, Trash2 } from 'lucide-vue-next'

import { ApiError } from '@/services/api'
import {
  clearCgnYunnanSourceConfig,
  fetchCgnYunnanPlantBindings,
  fetchCgnYunnanSourceStatus,
  saveCgnYunnanSourceConfig,
  testCgnYunnanSource,
  type CgnYunnanSourceStatus,
  type CgnYunnanSourceTest,
} from '@/services/cgnYunnanDataSource'

const status = ref<CgnYunnanSourceStatus | null>(null)
const lastTest = ref<CgnYunnanSourceTest | null>(null)
const plantCount = ref(0)
const forbidden = ref(false)
const loading = ref(false)
const saving = ref(false)
const testing = ref(false)
const baseUrl = ref('')
const apiKey = ref('')

const connectionLabel = computed(() => {
  if (status.value?.connectionState === 'CONNECTED') return '已验证连通'
  if (status.value?.connectionState === 'CONFIGURED_UNVERIFIED') return '已配置，待验证'
  return '未配置'
})
const testText = computed(() => {
  const test = lastTest.value ?? status.value?.lastTest
  if (!test) return '尚未测试'
  const time = test.checkedAt ? `（${new Date(test.checkedAt).toLocaleString()}）` : ''
  return `${test.msg}${time}`
})

async function load() {
  loading.value = true
  try {
    const [nextStatus, bindings] = await Promise.all([
      fetchCgnYunnanSourceStatus(),
      fetchCgnYunnanPlantBindings(),
    ])
    status.value = nextStatus
    plantCount.value = bindings.length
    baseUrl.value = nextStatus?.baseUrl ?? ''
    forbidden.value = false
  } catch (error) {
    if (error instanceof ApiError && error.status === 403) forbidden.value = true
    else ElMessage.error('无法加载中广核云南数据源状态')
  } finally {
    loading.value = false
  }
}

async function save() {
  if (!baseUrl.value.trim() || !apiKey.value.trim()) {
    ElMessage.warning('基础地址和 API Key 均为必填')
    return
  }
  saving.value = true
  try {
    status.value = await saveCgnYunnanSourceConfig({ baseUrl: baseUrl.value, apiKey: apiKey.value })
    apiKey.value = ''
    lastTest.value = null
    ElMessage.success('配置已保存；请执行连通测试。实时摄取尚未启用。')
  } catch (error) {
    ElMessage.error(error instanceof ApiError ? (error.payload.msg ?? '保存失败') : '保存失败')
  } finally {
    saving.value = false
  }
}

async function testConnection() {
  testing.value = true
  try {
    lastTest.value = await testCgnYunnanSource()
    await load()
    if (lastTest.value?.result === 'ok') ElMessage.success('数据源鉴权与目录接口已连通')
    else ElMessage.warning(lastTest.value?.msg ?? '连通测试未通过')
  } catch (error) {
    ElMessage.error(error instanceof ApiError ? (error.payload.msg ?? '连通测试失败') : '连通测试失败')
  } finally {
    testing.value = false
  }
}

async function clear() {
  try {
    status.value = await clearCgnYunnanSourceConfig()
    baseUrl.value = status.value?.baseUrl ?? ''
    apiKey.value = ''
    lastTest.value = null
    ElMessage.success('已清除设置页配置')
  } catch (error) {
    ElMessage.error(error instanceof ApiError ? (error.payload.msg ?? '清除失败') : '清除失败')
  }
}

onMounted(load)
</script>

<template>
  <section class="cgn-source-card" v-loading="loading">
    <div class="head">
      <div class="icon"><Building2 :size="20" /></div>
      <div>
        <small>CGN YUNNAN · GROUP-BOUND</small>
        <h3>云南电力数据 API v1</h3>
      </div>
      <span v-if="!forbidden" :class="['state', status?.connectionState?.toLowerCase()]">{{ connectionLabel }}</span>
    </div>

    <div v-if="forbidden" class="forbidden">
      该数据链路只向中广核云南集团账号开放；普通跨公司授权不会继承此权限。
    </div>

    <template v-else>
      <p class="desc">
        这是电厂/集团侧提供并经公网隧道透传的专属 API，<strong>不是南方电网官方 API</strong>。
        数据源固定绑定 <code>comp-cgn-yunnan</code>、云南地区及场站白名单；当前只建设配置与隔离底座，实时摄取和 PostgreSQL 写入尚未启用。
      </p>

      <div class="status-grid">
        <div><label>归属集团</label><span>{{ status?.ownerGroupId ?? 'comp-cgn-yunnan' }}</span></div>
        <div><label>地区</label><span>{{ status?.regionId ?? 'yunnan' }}</span></div>
        <div><label>传输方式</label><span>HTTPS 轮询</span></div>
        <div><label>场站白名单</label><span>{{ plantCount }} 个</span></div>
        <div><label>API Key</label><span>{{ status?.maskedApiKey ?? '未配置' }}</span></div>
        <div><label>实时写入</label><span>未启用</span></div>
        <div class="wide"><label>最近连通测试</label><span>{{ testText }}</span></div>
      </div>

      <template v-if="status?.canManageSource">
        <div class="field">
          <label>基础地址（HTTPS，可含反代路径前缀；填到 /api/v1 之前）</label>
          <el-input v-model="baseUrl" placeholder="https://host.example.com 或 https://host.example.com/prefix" />
        </div>
        <div class="field">
          <label>API Key（以 ynapi_ 开头）</label>
          <el-input v-model="apiKey" type="password" show-password placeholder="只发送到服务端，不在浏览器持久化" />
        </div>
        <div class="actions">
          <el-button type="primary" :loading="saving" @click="save"><KeyRound :size="13" />保存配置</el-button>
          <el-button :loading="testing" @click="testConnection"><RefreshCw :size="13" />测试鉴权与目录</el-button>
          <el-button v-if="status?.configSource === 'runtime'" text class="danger" @click="clear"><Trash2 :size="13" />清除配置</el-button>
        </div>
      </template>
      <div v-else class="readonly-note">你可以查看本集团的数据源状态；配置、清除和连通测试仅限集团管理员。</div>
      <div class="guards">
        <span><ShieldCheck :size="13" />集团账号硬绑定</span>
        <span><ShieldCheck :size="13" />未知场站隔离</span>
        <span><ShieldCheck :size="13" />密钥不回传</span>
        <span><ShieldCheck :size="13" />失败不回落</span>
      </div>
    </template>
  </section>
</template>

<style scoped>
.cgn-source-card { grid-column: 1 / -1; padding: 24px 26px; border: 1px solid rgba(20, 129, 104, .3); border-radius: 16px; background: radial-gradient(circle at 94% 0, rgba(20, 184, 166, .1), transparent 38%), var(--panel); box-shadow: 0 12px 30px -22px rgba(16, 60, 60, .35); }
.head { display: flex; align-items: center; gap: 11px; }
.icon { display: grid; width: 40px; height: 40px; place-items: center; color: #0f8f76; border: 1px solid rgba(15, 143, 118, .24); border-radius: 11px; background: rgba(15, 143, 118, .08); }
.head small { display: block; color: #0f8f76; font-size: 9px; font-weight: 800; letter-spacing: .14em; }
.head h3 { margin: 2px 0 0; color: var(--text); font-size: 16px; }
.state { margin-left: auto; padding: 4px 9px; border: 1px solid var(--line-soft); border-radius: 999px; color: #9a6700; background: rgba(245, 184, 58, .1); font-size: 11px; }
.state.connected { color: #15803d; background: #f0faf3; border-color: #b7e1c2; }
.desc { margin: 14px 0; color: var(--text-weak); font-size: 12.5px; line-height: 1.75; }
.desc code { padding: 0 4px; border-radius: 3px; background: rgba(0, 0, 0, .05); }
.forbidden { margin-top: 14px; padding: 12px 14px; border: 1px solid #f3b4b4; border-radius: 8px; color: #b91c1c; background: #fef2f2; font-size: 13px; }
.readonly-note { margin-bottom: 14px; padding: 10px 12px; border: 1px solid var(--line-soft); border-radius: 8px; color: var(--text-weak); background: rgba(0, 0, 0, .025); font-size: 12px; }
.status-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px 18px; margin-bottom: 16px; padding: 14px 16px; border: 1px dashed var(--line-soft); border-radius: 10px; }
.status-grid div { display: flex; flex-direction: column; gap: 2px; font-size: 13px; }
.status-grid label { color: var(--text-weak); font-size: 12px; }
.status-grid span { color: var(--text); word-break: break-all; }
.status-grid .wide { grid-column: span 3; }
.field { margin-bottom: 14px; }
.field label { display: block; margin-bottom: 6px; color: var(--text); font-size: 13px; }
.actions, .guards { display: flex; flex-wrap: wrap; align-items: center; gap: 9px; }
.actions :deep(.el-button) { gap: 5px; }
.danger { color: #b91c1c; }
.guards { margin-top: 16px; }
.guards span { display: inline-flex; align-items: center; gap: 5px; padding: 6px 8px; color: var(--text-weak); border: 1px solid var(--line-soft); border-radius: 8px; font-size: 11px; }
.guards svg { color: #159570; }
@media (max-width: 720px) { .status-grid { grid-template-columns: 1fr; } .status-grid .wide { grid-column: auto; } .state { display: none; } }
</style>
