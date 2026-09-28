<script setup lang="ts">
// 数据运维工作台（/data-ops/console）：数据管理操作面的统一入口，回到主平台内承载。
//
// 由来：管理六页曾迁去独立控制台（独立 html 入口 + 自建侧栏壳），代价是壳层与主平台
// 两套、构建入口漏配即整页空白，且导航上与「数据管理」组割裂。现收回主平台——沿用
// 「AI 工作室 / 用户与权限」的单页 tab 范式（page-head + el-tabs + 懒加载子页），
// 侧边栏与「通用数据浏览器」同组，风格与其余业务页一致。API 拓扑不变：数据管理路径族
// 仍经 api.ts::dataServicePath 改写走 /data-svc → data-service :8190。
//
// 首个 tab 是「运维总览」（本页新增）：链路四段状态 + 告警 + 批次台账，回答「现在该动哪一步」；
// 其余 6 个 tab 即原六页组件（零改造复用，只摘掉与 tab 标签重复的标题行）。
//
// query 键用 ?panel= 而非 ?tab=：子页「数据源接入」自身也用 ?tab= 同步它的三个子 tab，
// 同名会互相踩（父切走 / 子回落默认值）。父 panel + 子 tab 各管一层，深链两级都保得住。
//
// 门禁：/data-ops/console 在 governance.adminOnlyRoutes 内，仅 ADMIN/BOSS 可见可进。
import { defineAsyncComponent, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import OpsOverviewPanel from './OpsOverviewPanel.vue'

const PANELS = [
  { name: 'overview', label: '运维总览', component: OpsOverviewPanel },
  { name: 'upload', label: '数据上传中心', component: defineAsyncComponent(() => import('./DataUploadView.vue')) },
  { name: 'import-hub', label: '数据导入融合台', component: defineAsyncComponent(() => import('../ImportHubView.vue')) },
  { name: 'onboarding', label: '数据接入向导', component: defineAsyncComponent(() => import('../DataOnboardingView.vue')) },
  { name: 'ingest', label: '数据摄取管理', component: defineAsyncComponent(() => import('../DataIngestionView.vue')) },
  { name: 'governance', label: '数据治理控制台', component: defineAsyncComponent(() => import('../DataGovernanceView.vue')) },
  { name: 'data-source', label: '数据源接入', component: defineAsyncComponent(() => import('../DataSourceSettingsView.vue')) }
] as const

const PANEL_NAMES = PANELS.map((p) => p.name) as readonly string[]
const DEFAULT_PANEL = PANELS[0].name

const route = useRoute()
const router = useRouter()

function normalizePanel(raw: unknown): string {
  const value = Array.isArray(raw) ? raw[0] : raw
  return typeof value === 'string' && PANEL_NAMES.includes(value) ? value : DEFAULT_PANEL
}

const activePanel = ref(normalizePanel(route.query.panel))

// 外部改 query（旧路径 redirect、浏览器前进后退）时跟随；非法值落默认面板。
watch(
  () => route.query.panel,
  (raw) => {
    const next = normalizePanel(raw)
    if (next !== activePanel.value) activePanel.value = next
  }
)

// 用 replace 而非 push：切面板是页内视图切换，不该在浏览器历史里堆一串条目。
function onPanelChange(name: string | number) {
  const panel = String(name)
  if (normalizePanel(route.query.panel) === panel) return
  // 切走时丢掉子页自己的 ?tab=（那是上一个面板的子 tab，留着会让新面板读到不属于它的值）。
  const { tab: _tab, ...rest } = route.query
  void router.replace({ query: { ...rest, panel } })
}

// 总览里的行动按钮直接切到对应面板。
function goPanel(panel: string) {
  activePanel.value = normalizePanel(panel)
  onPanelChange(activePanel.value)
}
</script>

<template>
  <div class="data-ops-console">
    <header class="page-head">
      <h1>数据运维工作台</h1>
      <!-- 一行导语即可：各面板分工的完整说明在面包屑旁「?」（pageHelp 注册表 DataOpsConsole 条目），dljy#3385。 -->
      <p class="sub">数据进入平台的全链路操作面：接入 → 入库 → 摄取 → 治理与回放（仅系统管理员可见）</p>
    </header>

    <el-tabs v-model="activePanel" class="ops-tabs" @tab-change="onPanelChange">
      <el-tab-pane v-for="panel in PANELS" :key="panel.name" :label="panel.label" :name="panel.name">
        <!-- 只渲染当前面板 + KeepAlive 缓存（同 AI 工作室）：切走触发 onDeactivated，
             子页的轮询/采集面板据此停轮询，不在后台空打接口；切回保留表单与步骤状态。 -->
        <KeepAlive>
          <component
            :is="panel.component"
            v-if="activePanel === panel.name"
            @navigate="goPanel"
          />
        </KeepAlive>
      </el-tab-pane>
    </el-tabs>
  </div>
</template>

<style scoped>
.data-ops-console {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.page-head h1 {
  margin: 0;
  font-size: var(--font-20);
  font-weight: 600;
  color: var(--el-text-color-primary);
}

.page-head .sub {
  margin: 4px 0 0;
  font-size: var(--font-md);
  line-height: 1.7;
  color: var(--el-text-color-secondary);
}

/* 子页自带 section/card 外距，tab 面板不再叠加内边距，避免双重留白。 */
.ops-tabs :deep(.el-tab-pane) {
  padding: 0;
}
</style>
