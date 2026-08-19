<script setup lang="ts">
// 数据源接入 · 电网官方平台 tab（Epic #1893 / Issue #1896）。
//
// 2026-08-10 拍板的「当前地区聚焦 + 全网概览」：
//   - 聚焦：右上角地区选择器选到哪个省，就展开该省官方平台接入点的完整操作面板
//     （凭据录入 + 采集服务运维）。无接入点或未开放录入的省，显示诚实的就绪度说明。
//   - 概览：下方矩阵铺开全国网省的接入就绪度（live/ready/maintenance/unreachable/planned），
//     一眼看出哪些省能接、哪些还在等平台/凭据/网络。
//
// 当前仅四川开放凭据录入并绑定采集服务（sgcc-sichuan：credentialEntry + serviceBinding）；
// 其余省的接入点已登记在册（就绪度用 2026-08-09 实测初始化），待 #1895 采集服务省份化后逐省打开。
// 故「凭据卡片」与「运维面板」目前是四川专用组件，这里按 currentPoint.credentialEntry /
// serviceBinding 决定是否渲染，#1895 后它们泛化为按接入点驱动。
import { computed, onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { MapPinned, Radio, ServerCog } from 'lucide-vue-next'
import { ApiError } from '@/services/api'
import { currentRegion, selectedRegionId } from '@/services/region/regionContext'
import {
  fetchGridAccessPoints,
  type GridAccessPointListItem,
  type GridAccessReadiness,
} from '@/services/gridAccess'
import SichuanCredentialCard from '@/components/SichuanCredentialCard.vue'
import SichuanIngestOpsPanel from '@/components/SichuanIngestOpsPanel.vue'

const points = ref<GridAccessPointListItem[]>([])
const loading = ref(false)
const forbidden = ref(false)

// 就绪度展示元信息：标签 + el-tag 类型。
const READINESS_META: Record<GridAccessReadiness, { label: string; type: 'success' | 'primary' | 'warning' | 'info' }> = {
  live: { label: '已上线', type: 'success' },
  ready: { label: '待凭据', type: 'primary' },
  maintenance: { label: '维护中', type: 'warning' },
  unreachable: { label: '不可达', type: 'info' },
  planned: { label: '待规划', type: 'info' },
}

const GRID_LABELS: Record<string, string> = {
  sgcc: '国家电网',
  csg: '南方电网',
  mengxi: '蒙西地方电网',
  other: '其它',
}

const officialPoints = computed(() => points.value.filter((p) => p.kind === 'official-platform'))

// 当前地区的官方平台接入点。网区级占位条目 regionId 为 null，不匹配具体省份
// 它们只进概览矩阵、不进聚焦面板。
const currentPoint = computed(() =>
  officialPoints.value.find((p) => p.regionId === selectedRegionId.value) ?? null,
)

// 按电网体系分组（保序）：sgcc 25 省 → csg 网区 → mengxi 网区。
const byOperator = computed(() => {
  const groups: { operator: string; items: GridAccessPointListItem[] }[] = []
  for (const p of officialPoints.value) {
    let g = groups.find((it) => it.operator === p.gridOperator)
    if (!g) { g = { operator: p.gridOperator, items: [] }; groups.push(g) }
    g.items.push(p)
  }
  return groups
})

const regionLabel = computed(() => currentRegion.value?.name ?? selectedRegionId.value ?? '未选择')

async function load() {
  loading.value = true
  try {
    points.value = await fetchGridAccessPoints()
    forbidden.value = false
  } catch (e) {
    if (e instanceof ApiError && e.status === 403) forbidden.value = true
    else ElMessage.error('无法加载接入点清单：请确认后端(4174)已启动')
  } finally {
    loading.value = false
  }
}

onMounted(load)
</script>

<template>
  <div class="official-tab" v-loading="loading">
    <el-alert
      v-if="forbidden"
      type="warning"
      :closable="false"
      show-icon
      title="仅系统管理员(ADMIN/BOSS)可管理数据接入点"
      description="请联系管理员配置，或切换管理员账号。"
    />

    <template v-else>
      <!-- 当前地区聚焦 -->
      <section class="focus-panel">
        <div class="focus-head">
          <MapPinned :size="18" aria-hidden="true" />
          <h3>当前地区：{{ regionLabel }}</h3>
          <span class="focus-hint">切换右上角地区选择器可查看其它省份的接入点</span>
        </div>

        <!-- 有官方平台接入点且开放凭据录入：凭据卡片 + 采集运维面板 -->
        <template v-if="currentPoint && currentPoint.credentialEntry">
          <SichuanCredentialCard />
          <SichuanIngestOpsPanel v-if="currentPoint.serviceBinding" />
        </template>

        <!-- 有接入点但凭据录入未开放：诚实说明就绪度与待办 -->
        <el-alert
          v-else-if="currentPoint"
          :type="currentPoint.readiness === 'live' || currentPoint.readiness === 'ready' ? 'info' : 'warning'"
          :closable="false"
          show-icon
          :title="`${currentPoint.name}：${READINESS_META[currentPoint.readiness].label}`"
        >
          <div>{{ currentPoint.readinessNote }}</div>
          <div class="focus-todo">该省份的凭据录入尚未开放——采集服务省份化（#1895）落地后逐省打开。</div>
        </el-alert>

        <!-- 当前地区无官方平台接入点（如云南：真实数据走企业自建通道，见「企业自建通道」tab） -->
        <el-empty v-else :image-size="70">
          <template #description>
            <p>当前地区暂无电网官方平台接入点。</p>
            <p class="empty-sub">该地区的数据接入若已就绪，通常走「企业自建通道」（如云南中广核透传），切到对应 tab 查看。</p>
          </template>
        </el-empty>
      </section>

      <!-- 全网就绪度概览 -->
      <section class="matrix-panel">
        <div class="matrix-head">
          <Radio :size="16" aria-hidden="true" />
          <h3>全网接入就绪度</h3>
          <span class="matrix-hint">全国同一套「新一代电力交易平台」，省份只是配置；就绪度来自 2026-08-09 实测</span>
        </div>

        <div v-for="g in byOperator" :key="g.operator" class="op-group">
          <div class="op-label">{{ GRID_LABELS[g.operator] ?? g.operator }}</div>
          <div class="op-grid">
            <el-tooltip
              v-for="p in g.items"
              :key="p.id"
              :content="p.readinessNote"
              placement="top"
              :show-after="200"
            >
              <div :class="['op-cell', `r-${p.readiness}`, { current: p.regionId === selectedRegionId }]">
                <div class="cell-name">
                  {{ p.regionId ? (p.name.replace(/^国网/, '').replace(/·.*$/, '')) : p.name }}
                </div>
                <div class="cell-host">{{ p.platformHost ?? '—' }}</div>
                <el-tag :type="READINESS_META[p.readiness].type" size="small" effect="plain">
                  {{ READINESS_META[p.readiness].label }}
                </el-tag>
                <div v-if="p.credentials?.effectiveOwner" class="cell-owner">
                  <ServerCog :size="11" /> {{ p.credentials.effectiveOwner }}
                </div>
              </div>
            </el-tooltip>
          </div>
        </div>
      </section>
    </template>
  </div>
</template>

<style scoped>
.official-tab { display: flex; flex-direction: column; gap: 18px; }

.focus-panel {
  padding: 18px 20px;
  border: 1px solid var(--el-border-color-light);
  border-radius: 14px;
  background: var(--el-bg-color);
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.focus-head { display: flex; align-items: center; gap: 8px; }
.focus-head h3 { margin: 0; font-size: var(--font-16); font-weight: 600; color: var(--el-text-color-primary); }
.focus-hint { margin-left: auto; font-size: var(--font-sm); color: var(--el-text-color-secondary); }
.focus-todo { margin-top: 6px; font-size: var(--font-12-5); color: var(--el-text-color-secondary); }
.empty-sub { font-size: var(--font-sm); color: var(--el-text-color-secondary); }

.matrix-panel {
  padding: 18px 20px;
  border: 1px solid var(--el-border-color-light);
  border-radius: 14px;
  background: var(--el-bg-color);
}
.matrix-head { display: flex; align-items: center; gap: 8px; margin-bottom: 14px; }
.matrix-head h3 { margin: 0; font-size: var(--font-15); font-weight: 600; color: var(--el-text-color-primary); }
.matrix-hint { margin-left: auto; font-size: var(--font-sm); color: var(--el-text-color-secondary); }

.op-group + .op-group { margin-top: 16px; }
.op-label { font-size: var(--font-md); font-weight: 600; color: var(--el-text-color-secondary); margin-bottom: 8px; }
.op-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(170px, 1fr)); gap: 10px; }

.op-cell {
  padding: 10px 12px;
  border: 1px solid var(--el-border-color-light);
  border-radius: 10px;
  background: var(--el-fill-color-blank);
  display: flex;
  flex-direction: column;
  gap: 5px;
  cursor: default;
  transition: border-color 0.15s;
}
.op-cell.current { border-color: var(--el-color-primary); box-shadow: 0 0 0 2px var(--el-color-primary-light-8); }
.cell-name { font-size: var(--font-md); font-weight: 600; color: var(--el-text-color-primary); }
.cell-host { font-family: var(--el-font-family-mono, monospace); font-size: var(--font-xs); color: var(--el-text-color-placeholder); word-break: break-all; }
.cell-owner { display: flex; align-items: center; gap: 4px; font-size: var(--font-xs); color: var(--el-text-color-secondary); }
</style>
