<template>
  <main class="dify-studio">
    <header class="studio-header">
      <div>
        <p class="eyebrow">DIFY STUDIO</p>
        <h1>Dify 工作流工作室</h1>
      </div>
      <div class="header-actions">
        <el-button :loading="loading" @click="bootStudio">
          <RefreshCw class="btn-icon" />
          重新连接
        </el-button>
        <el-button @click="$router.push('/gsgl/report-workshop')">
          <FileChartColumn class="btn-icon" />
          报告工坊
        </el-button>
      </div>
    </header>

    <section class="studio-status">
      <div class="status-cell">
        <span>Studio 嵌入</span>
        <el-tag :type="statusTag.type" effect="light">{{ statusTag.label }}</el-tag>
      </div>
      <div class="status-cell">
        <span>Workflow API</span>
        <el-tag :type="status?.apiConfigured ? 'success' : 'warning'" effect="light">
          {{ status?.apiConfigured ? '已配置' : '待配置' }}
        </el-tag>
      </div>
      <div class="status-cell">
        <span>工具桥</span>
        <el-tag :type="status?.toolTokenConfigured ? 'success' : 'warning'" effect="light">
          {{ status?.toolTokenConfigured ? '已配置' : '待配置' }}
        </el-tag>
      </div>
      <div class="status-cell wide">
        <span>上游</span>
        <code>{{ status?.baseUrl || '未检测' }}</code>
      </div>
    </section>

    <section class="studio-main">
      <aside class="tool-panel">
        <div class="panel-title">
          <Wrench class="panel-icon" />
          <h2>dljy 电力工具</h2>
        </div>
        <div class="tool-grid">
          <span v-for="tool in tools" :key="tool">{{ tool }}</span>
        </div>
        <div class="panel-title secondary">
          <ShieldCheck class="panel-icon" />
          <h2>边界</h2>
        </div>
        <ul class="guard-list">
          <li>Dify API Key 仅在 Node 代理层使用</li>
          <li>工具桥令牌 fail-closed</li>
          <li>公司数据工具继续校验用户会话</li>
          <li>Mock 与预测结果沿用可见标注</li>
        </ul>
      </aside>

      <section class="iframe-shell">
        <div v-if="loading" class="iframe-state">
          <el-icon class="is-loading"><Loading /></el-icon>
          <span>正在连接 Dify Studio</span>
        </div>

        <iframe
          v-if="iframeSrc"
          v-show="!loading"
          ref="iframeRef"
          :src="iframeSrc"
          title="Dify Workflow Studio"
          @load="loading = false"
        />

        <div v-if="!loading && !iframeSrc" class="diagnostic">
          <div class="diagnostic-icon"><Workflow /></div>
          <h2>Dify Studio 暂不可嵌入</h2>
          <p>{{ errorMessage || '请检查 Dify 连接和 SSO 配置。' }}</p>
          <div class="diagnostic-grid">
            <div v-for="item in diagnostics" :key="item.label" class="diag-row">
              <span>{{ item.label }}</span>
              <el-tag :type="item.ok ? 'success' : 'warning'" effect="light">{{ item.ok ? '正常' : '待处理' }}</el-tag>
            </div>
          </div>
          <div class="diagnostic-actions">
            <el-button type="primary" @click="bootStudio">
              <RefreshCw class="btn-icon" />
              重试
            </el-button>
            <el-button :disabled="!status?.baseUrl" @click="openUpstream">
              <ExternalLink class="btn-icon" />
              打开上游
            </el-button>
          </div>
        </div>
      </section>
    </section>
  </main>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { Loading } from '@element-plus/icons-vue'
import {
  ExternalLink,
  FileChartColumn,
  RefreshCw,
  ShieldCheck,
  Workflow,
  Wrench
} from 'lucide-vue-next'
import {
  createDifyStudioSession,
  DEFAULT_DIFY_STUDIO_TARGET,
  fetchDifyStudioStatus,
  type DifyStudioStatus
} from '@/services/agent/difyStudioClient'

const iframeRef = ref<HTMLIFrameElement | null>(null)
const iframeSrc = ref('')
const loading = ref(false)
const errorMessage = ref('')
const status = ref<DifyStudioStatus | null>(null)

const tools = ['现货价格', '结算计算', '场站资产', '机组出力', '合同台账', '预测数据', '价格图表', '出力图表']

const statusTag = computed(() => {
  if (!status.value) return { type: 'info' as const, label: '未检测' }
  if (iframeSrc.value) return { type: 'success' as const, label: '已进入' }
  if (status.value.available) return { type: 'success' as const, label: '可用' }
  if (!status.value.studioEmbedEnabled) return { type: 'info' as const, label: '已关闭' }
  return { type: 'warning' as const, label: '待配置' }
})

const diagnostics = computed(() => {
  const s = status.value
  return [
    { label: 'DIFY_STUDIO_EMBED_ENABLED', ok: Boolean(s?.studioEmbedEnabled) },
    { label: 'DIFY_CONSOLE_EMAIL / PASSWORD', ok: Boolean(s?.ssoConfigured) },
    { label: 'DIFY_API_KEY / DIFY_APP_KEYS', ok: Boolean(s?.apiConfigured) },
    { label: 'DIFY_TOOL_TOKEN', ok: Boolean(s?.toolTokenConfigured) }
  ]
})

function messageFromError(error: unknown) {
  const payload = (error as any)?.payload
  if (payload?.msg) return String(payload.msg)
  if ((error as Error)?.message) return (error as Error).message
  return 'Dify Studio 连接失败'
}

async function bootStudio() {
  loading.value = true
  iframeSrc.value = ''
  errorMessage.value = ''
  try {
    status.value = await fetchDifyStudioStatus()
    const session = await createDifyStudioSession(DEFAULT_DIFY_STUDIO_TARGET)
    status.value = session
    if (!session.bootstrapUrl) {
      throw new Error(session.msg || 'Dify Studio bootstrap 地址缺失')
    }
    iframeSrc.value = session.bootstrapUrl
  } catch (error) {
    errorMessage.value = messageFromError(error)
    iframeSrc.value = ''
    loading.value = false
  }
}

function openUpstream() {
  if (status.value?.baseUrl) window.open(status.value.baseUrl, '_blank', 'noopener,noreferrer')
}

onMounted(bootStudio)
</script>

<style scoped>
.dify-studio {
  display: flex;
  min-height: 100%;
  padding: 18px;
  flex-direction: column;
  color: #172033;
  background: #f6f8fb;
}

.studio-header,
.header-actions,
.studio-status,
.status-cell,
.studio-main,
.panel-title,
.diagnostic-actions {
  display: flex;
  align-items: center;
}

.studio-header {
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 12px;
}

.eyebrow,
h1,
h2,
p {
  margin: 0;
}

.eyebrow {
  margin-bottom: 6px;
  color: #5c6f86;
  font-size: 12px;
  font-weight: 700;
}

h1 {
  font-size: 26px;
  font-weight: 760;
}

h2 {
  font-size: 15px;
  font-weight: 720;
}

.header-actions {
  gap: 8px;
  flex-wrap: wrap;
}

.btn-icon,
.panel-icon {
  width: 16px;
  height: 16px;
}

.studio-status {
  gap: 10px;
  padding: 10px 12px;
  margin-bottom: 12px;
  border: 1px solid #dfe7f0;
  border-radius: 8px;
  background: #fff;
}

.status-cell {
  gap: 8px;
  min-width: 150px;
  color: #4f6074;
  font-size: 13px;
}

.status-cell.wide {
  min-width: 260px;
}

.status-cell code {
  overflow: hidden;
  max-width: 340px;
  padding: 3px 6px;
  border: 1px solid #d8e4f1;
  border-radius: 5px;
  color: #41566e;
  background: #f8fbff;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.studio-main {
  align-items: stretch;
  min-height: 680px;
  flex: 1;
  gap: 12px;
}

.tool-panel {
  width: 260px;
  flex: 0 0 260px;
  padding: 14px;
  border: 1px solid #dfe7f0;
  border-radius: 8px;
  background: #fff;
}

.panel-title {
  gap: 8px;
  margin-bottom: 12px;
  color: #26364a;
}

.panel-title.secondary {
  margin-top: 18px;
}

.tool-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.tool-grid span {
  padding: 6px 9px;
  border: 1px solid #d8e4f1;
  border-radius: 6px;
  color: #40566f;
  background: #f8fbff;
  font-size: 12px;
}

.guard-list {
  display: grid;
  gap: 8px;
  padding: 0;
  margin: 0;
  list-style: none;
  color: #52657a;
  font-size: 13px;
  line-height: 1.45;
}

.iframe-shell {
  position: relative;
  overflow: hidden;
  min-width: 0;
  flex: 1;
  border: 1px solid #d7e2ee;
  border-radius: 8px;
  background: #fff;
}

.iframe-shell iframe {
  display: block;
  width: 100%;
  height: 100%;
  min-height: 680px;
  border: 0;
}

.iframe-state,
.diagnostic {
  position: absolute;
  inset: 0;
  display: grid;
  place-content: center;
  justify-items: center;
  gap: 14px;
  padding: 24px;
  text-align: center;
}

.iframe-state {
  color: #52657a;
}

.diagnostic-icon {
  display: grid;
  place-items: center;
  width: 48px;
  height: 48px;
  border-radius: 8px;
  color: #1457b7;
  background: #eaf2ff;
}

.diagnostic-icon svg {
  width: 24px;
  height: 24px;
}

.diagnostic p {
  max-width: 640px;
  color: #52657a;
  line-height: 1.55;
}

.diagnostic-grid {
  display: grid;
  width: min(520px, 100%);
  gap: 8px;
  margin-top: 4px;
}

.diag-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 9px 10px;
  border: 1px solid #dfe7f0;
  border-radius: 6px;
  color: #43566c;
  background: #fbfdff;
  font-size: 13px;
}

.diagnostic-actions {
  gap: 8px;
  flex-wrap: wrap;
  justify-content: center;
}

@media (max-width: 1100px) {
  .studio-main {
    flex-direction: column;
  }

  .tool-panel {
    width: auto;
    flex-basis: auto;
  }
}

@media (max-width: 760px) {
  .dify-studio {
    padding: 12px;
  }

  .studio-header,
  .studio-status {
    align-items: flex-start;
    flex-direction: column;
  }

  .status-cell,
  .status-cell.wide {
    min-width: 0;
    width: 100%;
  }

  .iframe-shell iframe,
  .studio-main {
    min-height: 560px;
  }
}
</style>
