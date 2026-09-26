<script setup lang="ts">
// 市场洞察区块容器（dljy#2996，OpenSpec 任务 5.5，design D3/D4）
// ----------------------------------------------------------------------------
// 包裹一个分析区块：加载 / 错误 / 空态（按业务原因）/ 部分可用提示 / 正常内容的
// 统一外壳。页面只管把结果与错误塞进来、把内容画进默认插槽。
//
// 文案纪律（全部业务话术，禁止 family/datasetKey/SQL/表名/sourceId 原文）：
//   - 403 只说「没有查看权限」，不透露资料是否存在；
//   - 409 只说「资料已更新」，给「刷新」按钮由用户决定换版本，绝不静默替换当前图；
//   - 400/422 显示后端给出的可行动原因（范围过大、需先选对象等）；
//   - 空态按 runtime.availability.reason 显示中文原因并配后端 detail，
//     提供「查看可分析日期」入口（emit，由页面打开候选面板，本组件不改上下文）。
// 部分可用（partial）内容照常渲染：顶部浅色提示条写 detail，并列出没读到的对象
// （coverage.objects.missingRequested）——部分资料如实标注，不装作完整（A03）。
//
// 头部动作区（dljy#3078，任务 15.2/14.5）：
//   - 「导出 CSV」：只读动作，凡声明 exportable 的区块人人可用；只对全量口径（page.scope
//     === 'all'）开放，导出同版本全量行（复用 insightCsv，精度不加工），文件名含业务窗口；
//   - 「加入材料」：公司写入，页面按权限决定是否传 materializable（公共读者不传=不出现），
//     点击 emit('add-material') 由页面打开材料窗口，本组件不持保存状态；
//   - 「前往资料维护」（dljy#3096，任务 15.5）：空态原因为「未接入 / 超覆盖」且页面传
//     maintenance（页面已按 governance 判定资料维护权限）时出现；点击 emit 由页面跳转
//     上传中心。只在空态出现，部分缺数（partial）不引导维护；返回后的重查由页面负责，
//     返回不视为已补齐（PP07）。
//   - 版本绑定：页面传 stale（与页面查询键同步）或区块处于 409 冲突（旧结果仍在展示）时，
//     两个入口禁用并提示「结果已过期，请刷新后再导出」——过期结果不导出、不保存。

import { computed } from 'vue'
import { ElMessage } from 'element-plus'
import type { InsightBlockResult, InsightRequestError } from '@/services/insight/insightClient'
import {
  availabilityReasonText,
  insightErrorCopy,
  insightSourceTitle,
  type InsightSourceTitle,
} from './insightText'
import { buildInsightCsv, downloadInsightCsv } from './insightCsv'
import EmptyState from '../common/EmptyState.vue'
import LoadingState from '../common/LoadingState.vue'

const props = defineProps<{
  title: string
  /** 总览将来源清单折叠，保留公开/获权标记与证据入口。 */
  compactSources?: boolean
  /** 区块结果（null = 尚未查询或查询失败） */
  result: InsightBlockResult | null
  /** 请求错误（InsightRequestError）；与 result 互斥出现 */
  error: InsightRequestError | null
  loading?: boolean
  /** 「重试」回调（503 / 网络 / 参数类错误后重新发起同一查询） */
  onRetry?: () => void
  /** 「刷新」回调（409 版本冲突后重新查询取新版本；绝不静默替换，由用户点击） */
  onRefresh?: () => void
  /** 来源标题目录（来自 capabilities.sources）；未传时回落共享契约镜像 */
  sourceTitles?: Record<string, InsightSourceTitle>
  /** 头部「导出 CSV」入口开关：页面声明本区块结果可导出；仅全量口径实际可导 */
  exportable?: boolean
  /** 头部「加入材料」入口开关：页面已按公司写权限判断显隐（显隐在页面，禁用在组件） */
  materializable?: boolean
  /** 空态「前往资料维护」开关（dljy#3096）：页面已按 governance 判定资料维护权限；仅未接入/超覆盖空态出现 */
  maintenance?: boolean
  /** 页面声明当前结果已过期（与页面查询键同步）：导出与材料入口禁用并提示 */
  stale?: boolean
}>()

const emit = defineEmits<{
  /** 「查看可分析日期」：由页面打开历史候选面板 */
  'open-candidates': []
  /** 「证据」：由页面打开证据抽屉 */
  'open-evidence': []
  /** 「加入材料」：由页面打开材料窗口（冻结请求与期望版本由页面组装） */
  'add-material': []
  /** 「前往资料维护」：由页面跳转上传中心/资料维护页（dljy#3096，任务 15.5） */
  'open-maintenance': []
}>()

const errorCopy = computed(() => (props.error ? insightErrorCopy(props.error) : null))

/** 版本冲突且旧结果还在：内容继续显示，冲突以警告条叠在顶部（不藏旧图、不静默换新）。 */
const conflictWithResult = computed(() => props.error?.status === 409 && props.result !== null)

const denied = computed(() => props.result?.runtime.access === 'denied')
const availability = computed(() => props.result?.runtime.availability ?? null)
const isEmpty = computed(() => availability.value?.state === 'empty')
const isPartial = computed(() => availability.value?.state === 'partial')

/** 结果是否已过期仍在展示：页面按查询键声明 stale，或 409 冲突后旧结果还在。 */
const resultStale = computed(() => props.stale === true || conflictWithResult.value)

/** 导出入口：只对有版本引用的全量口径开放；分页结果只是一页，导出会冒充全量。 */
const exportReady = computed(() => {
  const result = props.result
  return Boolean(
    props.exportable &&
      result &&
      !denied.value &&
      result.data &&
      result.resultVersion &&
      result.readSetRef &&
      result.page?.scope === 'all'
  )
})

/** 过期（页面声明或 409 冲突）时入口禁用：过期版本不导出、不保存，先刷新换版本。 */
const exportBlocked = computed(() => exportReady.value && resultStale.value)

/** 头部「导出 CSV」：同版本全量行直落 CSV（复用 insightCsv 口径），文件名含业务窗口。 */
function exportCsv(): void {
  const result = props.result
  if (!exportReady.value || exportBlocked.value || !result?.data) return
  const window = result.businessWindow
  downloadInsightCsv(buildInsightCsv(result, props.sourceTitles), `洞察-${props.title}-${window.start}至${window.end}.csv`)
  ElMessage.success(`已导出「${props.title}」${window.start}至${window.end} 的同版本全量结果`)
}

/** 头部来源标签：业务标题 + 公开/获权样式（不显示来源标识原文）。 */
const sourceTags = computed(() => {
  const refs = props.result?.sourceRefs
  const tags: Array<{ title: string; accessScope: string }> = []
  for (const ref of refs ?? []) {
    const meta = insightSourceTitle(ref.sourceId, props.sourceTitles)
    if (meta) tags.push({ title: meta.title, accessScope: meta.accessScope })
  }
  return tags
})

/** 部分可用时没读到的对象（各来源 coverage.objects.missingRequested 合并去重）。 */
const missingObjects = computed(() => {
  const coverage = props.result?.coverage
  if (!coverage || typeof coverage !== 'object') return []
  const names = new Set<string>()
  for (const perSource of Object.values(coverage as Record<string, { objects?: { missingRequested?: string[] } | null }>)) {
    for (const name of perSource?.objects?.missingRequested ?? []) names.add(name)
  }
  return [...names]
})

/** 空态是否提供「查看可分析日期」入口：日期相关原因才有候选可看。 */
const showCandidatesEntry = computed(() => {
  const reason = availability.value?.reason
  return isEmpty.value && (reason === 'beyond-coverage' || reason === 'not-onboarded' || reason === 'not-published')
})

/** 空态是否提供「前往资料维护」入口（dljy#3096，任务 15.5）：仅「未接入 / 超覆盖」——
 *  这两种是补录资料能解决的缺口；其余空态（未发布、不适用等）引导维护是误导。
 *  显隐的权限判定在页面（maintenance prop），部分缺数不引导（内容照常展示）。 */
const showMaintenanceEntry = computed(() => {
  const reason = availability.value?.reason
  return Boolean(props.maintenance) && isEmpty.value && (reason === 'beyond-coverage' || reason === 'not-onboarded')
})
</script>

<template>
  <section class="insight-block">
    <header class="insight-block__head">
      <h3 class="insight-block__title">{{ title }}</h3>
      <div class="insight-block__meta">
        <details v-if="compactSources && sourceTags.length" class="insight-block__sources">
          <summary>{{ sourceTags.length }} 个来源 · {{ sourceTags.some(tag => tag.accessScope === 'company') ? '含获权' : '公开' }}</summary>
          <div class="insight-block__source-list">
        <span
          v-for="tag in sourceTags"
          :key="tag.title"
          class="insight-block__source"
          :class="{ 'insight-block__source--company': tag.accessScope === 'company' }"
        >
          {{ tag.title }}·{{ tag.accessScope === 'company' ? '获权' : '公开' }}
        </span>
          </div>
        </details>
        <template v-else>
        <span
          v-for="tag in sourceTags"
          :key="tag.title"
          class="insight-block__source"
          :class="{ 'insight-block__source--company': tag.accessScope === 'company' }"
        >
          {{ tag.title }}·{{ tag.accessScope === 'company' ? '获权' : '公开' }}
        </span>
        </template>
        <span
          v-if="exportBlocked"
          class="insight-block__stale-hint"
          data-testid="insight-export-stale-hint"
        >
          结果已过期，请刷新后再导出
        </span>
        <el-button
          v-if="exportReady"
          link
          type="primary"
          size="small"
          :disabled="exportBlocked"
          data-testid="insight-export-csv"
          @click="exportCsv"
        >
          导出 CSV
        </el-button>
        <el-button
          v-if="materializable && result && !denied"
          link
          type="primary"
          size="small"
          :disabled="resultStale"
          data-testid="insight-add-material"
          @click="emit('add-material')"
        >
          加入材料
        </el-button>
        <el-button
          v-if="result && !denied"
          link
          type="primary"
          size="small"
          @click="emit('open-evidence')"
        >
          证据
        </el-button>
      </div>
    </header>

    <LoadingState v-if="loading" text="正在读取资料…" />

    <div v-else-if="error && !conflictWithResult" class="insight-block__state">
      <el-alert :title="errorCopy!.title" :type="error!.status === 409 ? 'warning' : 'error'" show-icon :closable="false">
        <p v-if="errorCopy!.action === 'refresh'" class="insight-block__hint">
          点击「刷新」将放弃当前版本并重新查询；不刷新则继续查看当前结果。
        </p>
      </el-alert>
      <div class="insight-block__actions">
        <el-button
          v-if="errorCopy!.action === 'refresh' && onRefresh"
          size="small"
          type="primary"
          @click="onRefresh"
        >
          刷新
        </el-button>
        <el-button v-if="errorCopy!.action === 'retry' && onRetry" size="small" @click="onRetry">
          重试
        </el-button>
      </div>
    </div>

    <div v-else-if="denied" class="insight-block__state">
      <el-alert title="当前公司没有这类资料的查看权限" type="warning" show-icon :closable="false" />
    </div>

    <div v-else-if="isEmpty" class="insight-block__state">
      <EmptyState :text="availabilityReasonText(availability?.reason)" />
      <p v-if="availability?.detail" class="insight-block__detail">{{ availability.detail }}</p>
      <div v-if="showCandidatesEntry || showMaintenanceEntry" class="insight-block__actions">
        <el-button v-if="showCandidatesEntry" size="small" @click="emit('open-candidates')">查看可分析日期</el-button>
        <el-button
          v-if="showMaintenanceEntry"
          size="small"
          data-testid="insight-open-maintenance"
          @click="emit('open-maintenance')"
        >
          前往资料维护
        </el-button>
      </div>
    </div>

    <template v-else>
      <div v-if="conflictWithResult" class="insight-block__state insight-block__state--conflict">
        <el-alert :title="errorCopy!.title" type="warning" show-icon :closable="false">
          <p class="insight-block__hint">点击「刷新」将放弃当前版本并重新查询；不刷新则继续查看当前结果。</p>
        </el-alert>
        <div v-if="onRefresh" class="insight-block__actions">
          <el-button size="small" type="primary" @click="onRefresh">刷新</el-button>
        </div>
      </div>
      <el-alert
        v-if="isPartial"
        class="insight-block__partial"
        type="info"
        show-icon
        :closable="false"
        :title="availability?.detail || '部分时段或来源缺数，缺测处已断开显示'"
      >
        <p v-if="missingObjects.length" class="insight-block__hint">
          未读到的对象：{{ missingObjects.join('、') }}
        </p>
      </el-alert>
      <slot />
    </template>
  </section>
</template>

<style scoped>
.insight-block__sources { font-size: var(--font-xs); color: var(--muted); }
.insight-block__sources summary { cursor: pointer; }
.insight-block__sources summary:focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; }
.insight-block__source-list { display: grid; gap: 6px; padding: 10px 0; }

.insight-block {
  display: flex;
  flex-direction: column;
  gap: 10px;
  background: var(--panel, #fff);
  border: 1px solid var(--line, #e5e7eb);
  border-radius: 12px;
  padding: 14px 16px;
}

.insight-block__head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.insight-block__title {
  flex-shrink: 0;
  margin: 0;
  font-size: var(--font-lg, 16px);
  font-weight: 600;
  color: var(--text, #1f2a37);
}

.insight-block__meta {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.insight-block__source {
  font-size: var(--font-xs, 12px);
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--panel-sub, #f1f5f9);
  color: var(--muted, #64748b);
  border: 1px solid var(--line, #e2e8f0);
}

.insight-block__source--company {
  background: rgba(217, 119, 6, 0.08);
  color: #b45309;
  border-color: rgba(217, 119, 6, 0.35);
}

.insight-block__stale-hint {
  color: #b45309;
  font-size: var(--font-xs, 12px);
}

.insight-block__state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding: 8px 0;
}

.insight-block__state--conflict {
  align-items: stretch;
  padding: 0;
}

.insight-block__detail {
  margin: 0;
  color: var(--muted, #909399);
  font-size: var(--font-sm, 13px);
  text-align: center;
}

.insight-block__actions {
  display: flex;
  gap: 8px;
}

.insight-block__partial {
  border-radius: 8px;
}

.insight-block__hint {
  margin: 4px 0 0;
  font-size: var(--font-sm, 13px);
}
</style>
