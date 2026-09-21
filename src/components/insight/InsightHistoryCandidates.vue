<script setup lang="ts">
// 市场洞察可分析历史候选面板（dljy#2996，OpenSpec 任务 5.6，design D3.1 / OV06）
// ----------------------------------------------------------------------------
// 显式的「哪段历史能算」入口：打开时调 POST /coverage，按所选来源逐日逐序列的真实
// 完整度求交集，把可分析的连续区段（或离散日）列给用户点选。
//   - 不自动跳日：页面默认窗口仍是当日，换日期只能由用户在这里点一个候选（A02）；
//   - 离散日明确写「只有离散的若干天，不是连续区间」，不包装成一段连续历史；
//   - 无交集时如实写「所选来源没有共同完整的日期」，并列出各来源各自的完整区段；
//   - 用户点击候选才 emit('select', {start, end})，组件自己不改查询上下文；
//   - 关闭即中止在途 coverage 请求（迟到响应不写面板状态）。
// 数据形状见 dljy 仓 docs/api/market-insight-contract.md「覆盖与候选」。

import { computed, onBeforeUnmount, ref, watch } from 'vue'
import type { InsightContextInput } from 'shared/insight/contract.mjs'
import type { DateRange } from 'shared/insight/coverage.mjs'
import {
  fetchInsightCoverage,
  type InsightCoverageResult,
  type InsightRequestError,
} from '@/services/insight/insightClient'
import { insightErrorCopy, insightSourceTitle, type InsightSourceTitle } from './insightText'

const props = defineProps<{
  modelValue: boolean
  analysisId: string
  context: InsightContextInput
  filters?: Record<string, unknown>
  /** 把其余来源降为可选、只按这些来源求交集；缺省按分析的全部来源。 */
  requiredSourceIds?: string[]
  sourceTitles?: Record<string, InsightSourceTitle>
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  /** 用户点击一个候选（单日或区段）；由页面把它写进业务日期窗。 */
  'select': [range: { start: string; end: string }]
}>()

const visible = computed({
  get: () => props.modelValue,
  set: (value: boolean) => emit('update:modelValue', value),
})

const loading = ref(false)
const error = ref<InsightRequestError | null>(null)
const coverage = ref<InsightCoverageResult | null>(null)
let controller: AbortController | null = null

watch(visible, (open) => {
  if (open) void load()
  else closeRequest()
})

onBeforeUnmount(closeRequest)

/** 关闭即取消在途请求：迟到响应不属于这次浏览。 */
function closeRequest(): void {
  controller?.abort()
  controller = null
}

async function load(): Promise<void> {
  controller?.abort()
  controller = new AbortController()
  const signal = controller.signal
  loading.value = true
  error.value = null
  try {
    coverage.value = await fetchInsightCoverage(
      { analysisId: props.analysisId, context: props.context, filters: props.filters, requiredSourceIds: props.requiredSourceIds },
      { signal }
    )
  } catch (caught) {
    // 被取消（关闭面板/重新打开）不是失败：静默丢弃，不写错误状态。
    if ((caught as { name?: string })?.name === 'AbortError') return
    error.value = caught as InsightRequestError
    coverage.value = null
  } finally {
    if (!signal.aborted) loading.value = false
  }
}

/** 各来源完整度：业务标题 + 完整日数 + 完整区段（停用来源如实说明）。 */
const sourceRows = computed(() =>
  (coverage.value?.sources ?? []).map((source) => {
    const meta = insightSourceTitle(source.sourceId, props.sourceTitles)
    return {
      sourceId: source.sourceId,
      title: meta?.title ?? '来源',
      required: source.required,
      disabled: source.status === 'source-disabled',
      completeDays: source.completeDates.length,
      ranges: source.ranges,
    }
  })
)

const candidates = computed(() => coverage.value?.candidates ?? null)

function rangeLabel(range: DateRange): string {
  return range.start === range.end ? range.start : `${range.start} ~ ${range.end}（${range.days} 天）`
}
</script>

<template>
  <el-dialog v-model="visible" title="可分析日期" width="560px" append-to-body>
    <div v-if="loading" class="insight-candidates__loading" role="status">正在核对各来源的完整日期…</div>

    <div v-else-if="error" class="insight-candidates__error">
      <el-alert :title="insightErrorCopy(error).title" type="error" show-icon :closable="false">
        <p class="insight-candidates__hint">候选日期暂时读不出来，可稍后重试；不影响当前已展示的结果。</p>
      </el-alert>
      <el-button size="small" @click="load">重试</el-button>
    </div>

    <div v-else-if="coverage" class="insight-candidates">
      <h4 class="insight-candidates__section">各来源完整日期</h4>
      <ul class="insight-candidates__sources">
        <li v-for="row in sourceRows" :key="row.sourceId">
          <span class="insight-candidates__source-name">
            {{ row.title }}
            <el-tag v-if="row.required" size="small" type="info">必需</el-tag>
          </span>
          <span v-if="row.disabled" class="insight-candidates__muted">来源尚未启用，无完整日期</span>
          <span v-else-if="!row.completeDays" class="insight-candidates__muted">所选范围内没有完整日期</span>
          <span v-else>
            完整 {{ row.completeDays }} 天：
            <template v-if="row.ranges.length">
              <el-tag v-for="range in row.ranges" :key="range.start" size="small" class="insight-candidates__range">
                {{ rangeLabel(range) }}
              </el-tag>
            </template>
          </span>
        </li>
      </ul>

      <h4 class="insight-candidates__section">共同可分析区段</h4>
      <p v-if="candidates?.discrete" class="insight-candidates__discrete">
        只有离散的若干天，不是连续区间：下列每一天都单独完整，中间夹着缺数的日子。
      </p>
      <div v-if="candidates?.ranges.length" class="insight-candidates__list">
        <el-button
          v-for="range in candidates.ranges"
          :key="`${range.start}:${range.end}`"
          size="small"
          @click="emit('select', { start: range.start, end: range.end })"
        >
          {{ rangeLabel(range) }}
        </el-button>
      </div>
      <el-alert
        v-else
        type="warning"
        show-icon
        :closable="false"
        title="所选来源没有共同完整的日期"
        description="上面列出了各来源各自的完整区段；可更换来源组合，或缩小对象选择后再试。"
      />
      <p class="insight-candidates__note">{{ coverage.note }}</p>
    </div>

    <el-empty v-else description="暂无候选数据" />
  </el-dialog>
</template>

<style scoped>
.insight-candidates {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.insight-candidates__loading {
  padding: 24px 0;
  text-align: center;
  color: var(--muted, #909399);
}

.insight-candidates__error {
  display: flex;
  flex-direction: column;
  gap: 8px;
  align-items: flex-start;
}

.insight-candidates__section {
  margin: 8px 0 2px;
  font-size: var(--font-md, 14px);
  font-weight: 600;
  color: var(--text, #1f2a37);
}

.insight-candidates__sources {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.insight-candidates__sources li {
  display: flex;
  align-items: baseline;
  gap: 8px;
  flex-wrap: wrap;
  font-size: var(--font-sm, 13px);
}

.insight-candidates__source-name {
  font-weight: 600;
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.insight-candidates__muted {
  color: var(--muted, #909399);
}

.insight-candidates__range {
  margin: 0 4px 2px 0;
}

.insight-candidates__discrete {
  margin: 0;
  color: #b45309;
  font-size: var(--font-sm, 13px);
}

.insight-candidates__list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.insight-candidates__note {
  margin: 4px 0 0;
  color: var(--muted, #909399);
  font-size: var(--font-xs, 12px);
}

.insight-candidates__hint {
  margin: 4px 0 0;
  font-size: var(--font-sm, 13px);
}
</style>
