<script setup lang="ts">
// 市场洞察证据抽屉（dljy#2996，OpenSpec 任务 5.5，design D4.1 / DE11）
// ----------------------------------------------------------------------------
// 区块级证据面板：这份结果「从哪来、读到哪、什么口径」。字段全部来自区块结果本体：
//   - 结果版本 / 读取版本集合（rv1:/rs1: 摘要短码 + 复制完整值——下钻、翻页、导出、
//     保存都靠它向后端核验「看的还是这一版」）；
//   - 各来源（业务标题、公开/获权、版本标记短码、读到的有效时段数）；
//   - 覆盖（每条序列 应有/有效/缺/冲突/剔除/重复 时段数；对象 已读到/未读到/来源里没有）；
//   - 质量汇总、新鲜度说明（freshness.evidence）、分页范围（本页 x/y 行 或 全量 y 行）；
//   - 口径说明（派生程度 + 粒度：原生 n 分钟 → 当前 m 分钟）；
//   - 可选默认插槽：调用方补充「这份证据与某视图是同一份读取」之类的页面级说明
//     （dljy#3007 价格页：价差/摘要/切面与明细共用读取版本集合），不传不影响现有用法。
// 展示纪律：不出现 family / SQL / 表名 / 来源标识原文；版本摘要给短码、完整值仅复制用。

import { computed } from 'vue'
import { ElMessage } from 'element-plus'
import type { InsightBlockResult } from '@/services/insight/insightClient'
import {
  DERIVATION_TEXT,
  formatBeijingDateTime,
  insightSeriesName,
  insightSourceTitle,
  shortRef,
  type InsightSourceTitle,
} from './insightText'

const props = defineProps<{
  /** v-model：抽屉开关 */
  modelValue: boolean
  result: InsightBlockResult | null
  sourceTitles?: Record<string, InsightSourceTitle>
}>()

const emit = defineEmits<{ 'update:modelValue': [value: boolean] }>()

const visible = computed({
  get: () => props.modelValue,
  set: (value: boolean) => emit('update:modelValue', value),
})

/** 各来源证据行：标题/访问范围/版本短码/有效时段数（coverage 序列 validSlots 之和）。 */
const sourceRows = computed(() => {
  const result = props.result
  if (!result?.sourceRefs) return []
  return result.sourceRefs.map((ref) => {
    const meta = insightSourceTitle(ref.sourceId, props.sourceTitles)
    const perSource = (result.coverage as Record<string, { series?: Record<string, { validSlots?: number }> }> | undefined)?.[ref.sourceId]
    const validSlots = Object.values(perSource?.series ?? {}).reduce((sum, item) => sum + (item.validSlots ?? 0), 0)
    return {
      sourceId: ref.sourceId,
      title: meta?.title ?? '来源',
      accessScope: meta?.accessScope ?? ref.accessScope,
      versionToken: shortRef(ref.versionToken),
      validSlots,
    }
  })
})

type CoverageRow = {
  seriesId: string
  name: string
  expectedSlots: number
  validSlots: number
  missingSlots: number
  conflictSlots: number
  excludedValues: number
  duplicateRows: number
}

/** 每条序列的覆盖（序列显示名取序列目录的业务名，找不到时退化为短码）。 */
const coverageRows = computed<CoverageRow[]>(() => {
  const result = props.result
  if (!result?.coverage || typeof result.coverage !== 'object') return []
  const catalog = new Map((result.data?.series ?? []).map((series) => [series.seriesId, series]))
  const rows: CoverageRow[] = []
  for (const [sourceId, perSource] of Object.entries(result.coverage as Record<string, { series?: Record<string, CoverageRow> }>)) {
    for (const [seriesId, series] of Object.entries(perSource?.series ?? {})) {
      const meta = catalog.get(seriesId)
      rows.push({
        seriesId,
        name: meta ? insightSeriesName(meta) : `${insightSourceTitle(sourceId, props.sourceTitles)?.title ?? '序列'} ${shortRef(seriesId)}`,
        expectedSlots: series.expectedSlots,
        validSlots: series.validSlots,
        missingSlots: series.missingSlots,
        conflictSlots: series.conflictSlots,
        excludedValues: series.excludedValues,
        duplicateRows: series.duplicateRows,
      })
    }
  }
  return rows
})

/** 对象覆盖：已读到 / 未读到（所选但没读出）/ 来源里没有（unmappedNames）。 */
const objectRows = computed(() => {
  const result = props.result
  if (!result?.coverage || typeof result.coverage !== 'object') return []
  const rows: Array<{ source: string; observed: string; missing: string; unmapped: string }> = []
  for (const [sourceId, perSource] of Object.entries(result.coverage as Record<string, { objects?: { observedObjects?: number; missingRequested?: string[]; unmappedNames?: string[] } | null }>)) {
    if (!perSource?.objects) continue
    rows.push({
      source: insightSourceTitle(sourceId, props.sourceTitles)?.title ?? '来源',
      observed: perSource.objects.observedObjects != null ? `${perSource.objects.observedObjects} 个` : '—',
      missing: perSource.objects.missingRequested?.length ? perSource.objects.missingRequested.join('、') : '无',
      unmapped: perSource.objects.unmappedNames?.length ? perSource.objects.unmappedNames.join('、') : '无',
    })
  }
  return rows
})

/** 质量汇总（按来源：冲突/剔除/重复行）。 */
const qualityRows = computed(() => {
  const result = props.result
  if (!result?.quality || typeof result.quality !== 'object') return []
  return Object.entries(result.quality as Record<string, { conflictSlots?: number; excludedValues?: number; duplicateRows?: number }>).map(
    ([sourceId, item]) => ({
      source: insightSourceTitle(sourceId, props.sourceTitles)?.title ?? '来源',
      conflictSlots: item.conflictSlots ?? 0,
      excludedValues: item.excludedValues ?? 0,
      duplicateRows: item.duplicateRows ?? 0,
    })
  )
})

/** 分页范围：本页 x 行 / 全量 y 行（不带 page 请求时全量）。 */
const pageText = computed(() => {
  const page = props.result?.page
  if (!page) return '—'
  if (page.scope === 'page') return `本页 ${page.returnedRows ?? 0} 行 / 全量 ${page.totalRows ?? 0} 行`
  return `全量 ${page.totalRows ?? 0} 行`
})

/** 口径说明：派生程度 + 粒度（原生 n 分钟 → 当前 m 分钟；不一致才写换算）。 */
const derivationText = computed(() => {
  const result = props.result
  if (!result?.derivation) return '—'
  const parts = [DERIVATION_TEXT[result.derivation] ?? result.derivation]
  const series = result.data?.series ?? []
  const nativeSet = new Set(series.map((item) => item.nativeResolutionMinutes))
  const currentSet = new Set(series.map((item) => item.resolutionMinutes))
  if (nativeSet.size === 1 && currentSet.size === 1 && nativeSet.values().next().value !== currentSet.values().next().value) {
    parts.push(`粒度：原生 ${nativeSet.values().next().value} 分钟 → 当前 ${currentSet.values().next().value} 分钟`)
  } else if (nativeSet.size === 1) {
    parts.push(`粒度：原生 ${nativeSet.values().next().value} 分钟`)
  }
  return parts.join('；')
})

async function copyRef(value: string | null | undefined): Promise<void> {
  if (!value) return
  try {
    await navigator.clipboard.writeText(value)
    ElMessage.success('已复制完整版本号')
  } catch {
    ElMessage.warning('复制失败，请手动记录版本号')
  }
}
</script>

<template>
  <el-drawer v-model="visible" title="证据与口径" size="520px" append-to-body>
    <div v-if="result" class="insight-evidence">
      <el-descriptions :column="1" border size="small">
        <el-descriptions-item label="结果版本">
          <span class="insight-evidence__ref">{{ shortRef(result.resultVersion) }}</span>
          <el-button link type="primary" size="small" @click="copyRef(result.resultVersion)">复制完整值</el-button>
        </el-descriptions-item>
        <el-descriptions-item label="读取版本集合">
          <span class="insight-evidence__ref">{{ shortRef(result.readSetRef) }}</span>
          <el-button link type="primary" size="small" @click="copyRef(result.readSetRef)">复制完整值</el-button>
        </el-descriptions-item>
        <el-descriptions-item label="生成时间">{{ formatBeijingDateTime(result.generatedAt) }}（北京时间）</el-descriptions-item>
        <el-descriptions-item label="分页范围">{{ pageText }}</el-descriptions-item>
        <el-descriptions-item label="口径说明">{{ derivationText }}</el-descriptions-item>
        <el-descriptions-item label="新鲜度">{{ result.runtime.freshness.evidence || '—' }}</el-descriptions-item>
      </el-descriptions>

      <h4 class="insight-evidence__section">来源</h4>
      <el-table :data="sourceRows" size="small" border>
        <el-table-column prop="title" label="来源" min-width="160" show-overflow-tooltip />
        <el-table-column label="访问范围" width="80">
          <template #default="{ row }">{{ row.accessScope === 'company' ? '获权' : '公开' }}</template>
        </el-table-column>
        <el-table-column prop="versionToken" label="版本标记" width="120" />
        <el-table-column prop="validSlots" label="有效时段数" width="90" align="right" />
      </el-table>

      <h4 class="insight-evidence__section">序列覆盖（时段数）</h4>
      <el-table :data="coverageRows" size="small" border max-height="240">
        <el-table-column prop="name" label="序列" min-width="180" show-overflow-tooltip />
        <el-table-column prop="expectedSlots" label="应有" width="70" align="right" />
        <el-table-column prop="validSlots" label="有效" width="70" align="right" />
        <el-table-column prop="missingSlots" label="缺" width="60" align="right" />
        <el-table-column prop="conflictSlots" label="冲突" width="60" align="right" />
        <el-table-column prop="excludedValues" label="剔除" width="60" align="right" />
        <el-table-column prop="duplicateRows" label="重复" width="60" align="right" />
      </el-table>

      <h4 class="insight-evidence__section">对象覆盖</h4>
      <el-table v-if="objectRows.length" :data="objectRows" size="small" border>
        <el-table-column prop="source" label="来源" min-width="140" show-overflow-tooltip />
        <el-table-column prop="observed" label="已读到" width="90" />
        <el-table-column prop="missing" label="未读到" min-width="140" show-overflow-tooltip />
        <el-table-column prop="unmapped" label="来源里没有" min-width="120" show-overflow-tooltip />
      </el-table>
      <p v-else class="insight-evidence__muted">本区块没有对象维度。</p>

      <h4 class="insight-evidence__section">质量汇总</h4>
      <el-table v-if="qualityRows.length" :data="qualityRows" size="small" border>
        <el-table-column prop="source" label="来源" min-width="160" show-overflow-tooltip />
        <el-table-column prop="conflictSlots" label="冲突时段" width="90" align="right" />
        <el-table-column prop="excludedValues" label="剔除值" width="80" align="right" />
        <el-table-column prop="duplicateRows" label="重复行" width="80" align="right" />
      </el-table>

      <!-- 页面级补充说明（如「与明细是同一份读取」）；内容由调用方决定显隐 -->
      <slot />
    </div>
    <el-empty v-else description="暂无证据（未查询或查询失败）" />
  </el-drawer>
</template>

<style scoped>
.insight-evidence {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.insight-evidence__section {
  margin: 12px 0 4px;
  font-size: var(--font-md, 14px);
  font-weight: 600;
  color: var(--text, #1f2a37);
}

.insight-evidence__ref {
  font-family: var(--font-mono, monospace);
  font-size: var(--font-sm, 13px);
  margin-right: 8px;
}

.insight-evidence__muted {
  margin: 0;
  color: var(--muted, #909399);
  font-size: var(--font-sm, 13px);
}
</style>
