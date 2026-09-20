<script setup lang="ts">
// 已保存研究窗口（dljy#3094，OpenSpec 任务 14.4；RS06、CH05、design D9 保存方式段）
// ----------------------------------------------------------------------------
// 研究页「已保存分析」的唯一入口，四个动作都走后端四端点（前端零持久化、零缓存）：
//   1. 列表（GET research/definitions）：公司隔离由后端会话决定（RLS + 显式范围双层），
//      前端不做二次过滤也不假装过滤；地区范围随统一地区头下发，切地区即重新取数。
//   2. 查看（GET research/definitions/{id}）：只读展示定义摘要、运行版本清单与任一版本的
//      冻结产物——来源引用与样本说明原文都在冻结结果里，这里只呈现、绝不重算。
//   3. 按新源重算（POST research/definitions/{id}/run）：需公司写权限；changed=true 追加
//      新版本（旧版本永不改写）；changed=false 是「源未变化、读回既有版本」，如实提示，
//      不冒充新算、不重复建版本。
//   4. 权限语义分离：无写权限仍可列表与查看（含合法的受限查阅），只隐藏重算入口；
//      后端闸门才是权威，这里只管显隐。
// 语义纪律：失败诚实报错（不冒充空列表、不提示假成功）；界面只出现业务语言，
// 不出现定义标识/预设标识/版本指纹等内部记号。

import { computed, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import {
  getResearchDefinition,
  listResearchDefinitions,
  runResearchDefinition,
  type ResearchDefinitionDetail,
  type ResearchDefinitionRow,
} from '@/services/insight/researchClient'
import type { InsightRequestError } from '@/services/insight/insightClient'

const props = defineProps<{
  /** v-model：窗口开关 */
  modelValue: boolean
  /** 公司写权限显隐（重算入口只对可写账号显示；列表与查看始终可用）。 */
  canWrite: boolean
}>()

const emit = defineEmits<{ 'update:modelValue': [value: boolean] }>()

const visible = computed({
  get: () => props.modelValue,
  set: (value: boolean) => emit('update:modelValue', value),
})

// ── 状态（先声明再注册 watch：immediate 回调要访问它们）─────────────────────────────────

const EX_POST_BADGE = '事后对照'
const EX_ANTE_BADGE = '事前 · 截至时点'
const LIST_HINT = '只显示本公司保存的研究条目；其他公司的条目不可见，查看到的产物以冻结时点的资料为准'

/** 视图：list 列表 / detail 查看详情。 */
const view = ref<'list' | 'detail'>('list')

const listState = ref<{ rows: ResearchDefinitionRow[]; hasMore: boolean; offset: number } | null>(null)
const listLoading = ref(false)
const listError = ref('')

const detail = ref<ResearchDefinitionDetail | null>(null)
const detailLoading = ref(false)
const detailError = ref('')
/** 正在查看的运行版本号（默认最新；可切历史版本——旧版本永不改写）。 */
const viewRunNo = ref<number | null>(null)

const rerunning = ref(false)
const rerunNotice = ref('')
const rerunError = ref('')

watch(
  () => props.modelValue,
  (open) => {
    if (!open) return
    view.value = 'list'
    detail.value = null
    detailError.value = ''
    rerunNotice.value = ''
    rerunError.value = ''
    listError.value = ''
    listState.value = null
    void loadList(0)
  },
  { immediate: true }
)

async function loadList(offset: number): Promise<void> {
  listLoading.value = true
  listError.value = ''
  try {
    const page = await listResearchDefinitions(offset > 0 ? { offset } : undefined)
    listState.value = {
      rows: offset > 0 ? [...(listState.value?.rows ?? []), ...page.rows] : page.rows,
      hasMore: page.hasMore,
      offset: page.offset,
    }
  } catch (error) {
    listError.value = (error as InsightRequestError).message || '已保存研究列表读取失败，请稍后重试'
  } finally {
    listLoading.value = false
  }
}

function modeText(mode: string | undefined): string {
  if (mode === 'ex-ante') return EX_ANTE_BADGE
  if (mode === 'ex-post') return EX_POST_BADGE
  return mode === undefined || mode === '' ? '—' : mode
}

function timeText(value: string | null | undefined): string {
  if (!value) return '—'
  return value.replace('T', ' ').slice(0, 16)
}

/** 正在查看的冻结产物：最新版本或切到历史版本时后端返回的那一版（只读，前端不重算）。 */
const viewedRun = computed(() => {
  const run = detail.value?.latestRun ?? null
  if (run && (viewRunNo.value === null || viewRunNo.value === run.runNo)) return run
  return null
})

/** 查看历史版本时后端返回该版本的完整产物；最新版本字段以外的版本经同一端点带版本号取回。 */
async function openDetail(row: ResearchDefinitionRow): Promise<void> {
  viewRunNo.value = null
  detail.value = null
  rerunNotice.value = ''
  rerunError.value = ''
  view.value = 'detail'
  await loadDetail(row.definitionId)
}

async function loadDetail(definitionId: string, runNo: number | null = null): Promise<void> {
  detailLoading.value = true
  detailError.value = ''
  try {
    detail.value = await getResearchDefinition(definitionId, runNo !== null ? { runNo } : undefined)
    viewRunNo.value = runNo ?? detail.value.latestRun?.runNo ?? null
    if (runNo !== null && !detail.value.latestRun?.content) {
      // 该版本没有可展示的冻结产物：不渲染空壳，如实说明。
      detailError.value = '该版本暂无可展示的运行产物'
    }
  } catch (error) {
    detailError.value = (error as InsightRequestError).message || '研究条目读取失败，请稍后重试'
  } finally {
    detailLoading.value = false
  }
}

function backToList(): void {
  view.value = 'list'
  detail.value = null
  detailError.value = ''
  rerunNotice.value = ''
  rerunError.value = ''
}

// ── 按新源重算（写权限；旧版本不变，源未变化如实说）──────────────────────────────────────

async function rerun(): Promise<void> {
  const current = detail.value
  if (!current || rerunning.value) return
  rerunning.value = true
  rerunNotice.value = ''
  rerunError.value = ''
  try {
    const result = await runResearchDefinition(current.definitionId)
    if (!result.changed) {
      // 源未变化：读回既有版本，不假装新算。
      rerunNotice.value = result.note || '源资料未变化：返回既有版本，未生成新版本'
    } else {
      const version = result.run?.runNo ?? result.runs[0]?.runNo ?? null
      ElMessage.success(version !== null ? `已按新源重算：新增版本 ${version}（旧版本不变）` : '已按新源重算')
    }
    await loadDetail(current.definitionId, result.changed ? null : viewRunNo.value)
  } catch (error) {
    rerunError.value = (error as InsightRequestError).message || '重算未完成，请稍后重试'
  } finally {
    rerunning.value = false
  }
}
</script>

<template>
  <el-dialog
    v-model="visible"
    title="已保存分析"
    width="720px"
    append-to-body
    data-testid="insight-research-saved-dialog"
  >
    <p class="irs__meta" data-testid="irs-hint">{{ LIST_HINT }}</p>

    <!-- 列表视图：公司隔离条目（后端返回什么显示什么，不二次过滤） -->
    <template v-if="view === 'list'">
      <el-alert
        v-if="listError"
        type="error"
        show-icon
        :closable="false"
        :title="listError"
        data-testid="irs-list-error"
      />
      <el-empty
        v-else-if="!listLoading && listState && !listState.rows.length"
        description="本公司还没有保存过研究条目：运行预览后点「保存分析」即可保存"
        data-testid="irs-empty"
      />
      <div
        v-for="row in listState?.rows ?? []"
        :key="row.definitionId"
        class="irs__row"
        data-testid="irs-row"
      >
        <div class="irs__row-main">
          <h4 class="irs__row-title">{{ row.title }}</h4>
          <p class="irs__row-meta">
            业务窗口 {{ row.businessWindow?.start }} ~ {{ row.businessWindow?.end }} ·
            <span data-testid="irs-row-mode">{{ modeText(row.mode) }}</span> ·
            {{ row.runCount }} 个版本
            <template v-if="row.latestRun"> · 最新版本 {{ row.latestRun.runNo }}（{{ timeText(row.latestRun.createdAt) }}）</template>
            <template v-if="row.updatedAt"> · 更新于 {{ timeText(row.updatedAt) }}</template>
          </p>
        </div>
        <el-button
          size="small"
          plain
          type="primary"
          data-testid="irs-view"
          @click="openDetail(row)"
        >
          查看
        </el-button>
      </div>
      <div v-if="listLoading" class="irs__loading" data-testid="irs-list-loading">正在读取…</div>
      <div v-if="listState?.hasMore" class="irs__more">
        <el-button size="small" :loading="listLoading" data-testid="irs-more" @click="loadList(listState.offset + (listState.rows.length || 0))">
          加载更多
        </el-button>
      </div>
    </template>

    <!-- 查看视图：定义摘要 + 版本清单 + 冻结产物只读展示 -->
    <template v-else>
      <el-button size="small" data-testid="irs-back" @click="backToList">返回列表</el-button>
      <div v-if="detailLoading" class="irs__loading" data-testid="irs-detail-loading">正在读取…</div>
      <el-alert
        v-else-if="detailError"
        type="error"
        show-icon
        :closable="false"
        :title="detailError"
        data-testid="irs-detail-error"
      />
      <div v-else-if="detail" class="irs__detail" data-testid="irs-detail">
        <header class="irs__detail-head">
          <h4 class="irs__row-title" data-testid="irs-detail-title">{{ detail.title }}</h4>
          <span class="irs__tag" data-testid="irs-detail-mode">{{ modeText(detail.mode) }}</span>
          <el-button
            v-if="canWrite"
            size="small"
            type="primary"
            :loading="rerunning"
            data-testid="irs-rerun"
            @click="rerun"
          >
            按新源重算
          </el-button>
        </header>
        <p class="irs__meta" data-testid="irs-detail-summary">
          业务窗口 {{ detail.businessWindow?.start }} ~ {{ detail.businessWindow?.end }} ·
          共 {{ detail.runCount }} 个版本<template v-if="detail.latestRun"> · 当前查看版本 {{ viewRunNo ?? '—' }}（冻结于 {{ timeText(detail.latestRun.content?.frozenAt) }}）</template>
        </p>

        <el-alert
          v-if="rerunNotice"
          type="info"
          show-icon
          :closable="false"
          :title="rerunNotice"
          data-testid="irs-rerun-notice"
        />
        <el-alert
          v-if="rerunError"
          type="error"
          show-icon
          :closable="false"
          :title="rerunError"
          data-testid="irs-rerun-error"
        />
        <el-alert
          v-if="detail.replay"
          type="info"
          show-icon
          :closable="false"
          :title="detail.note || '该条目此前已保存，未重复创建'"
          data-testid="irs-replay-note"
        />

        <!-- 版本清单：查看保存结果与按新源重算是两个动作，这里只切换查看 -->
        <div class="irs__runs" data-testid="irs-runs">
          <span class="irs__runs-label">运行版本（新版本追加，旧版本永不改写）：</span>
          <el-button
            v-for="run in detail.runs"
            :key="run.runNo"
            size="small"
            :type="run.runNo === viewRunNo ? 'primary' : ''"
            plain
            data-testid="irs-run"
            @click="loadDetail(detail.definitionId, run.runNo)"
          >
            版本 {{ run.runNo }} · {{ timeText(run.createdAt) }}
          </el-button>
        </div>

        <!-- 冻结产物（只读）：来源引用与样本说明原文 -->
        <template v-if="viewedRun?.content">
          <p class="irs__meta" data-testid="irs-frozen-note">{{ viewedRun.content.note }}</p>
          <div class="irs__evidence" data-testid="irs-evidence">
            <h5>来源引用与样本说明（冻结原文）</h5>
            <ul data-testid="irs-evidence-inputs">
              <li v-for="input in viewedRun.content.result.inputs" :key="input.id">
                {{ input.label }}：有效槽位 {{ input.validSlots }}<template v-if="input.expectedSlots !== null"> / 期望 {{ input.expectedSlots }}</template>
                <template v-if="input.coverageRatio"> · 覆盖 {{ Math.round(Number(input.coverageRatio) * 1000) / 10 }}%</template>
              </li>
            </ul>
            <p data-testid="irs-evidence-sample">
              样本 {{ viewedRun.content.result.sample.primarySamples }} 条
              （最低要求 {{ viewedRun.content.result.sample.conditions.minSamples }} 条）
              · 观测 {{ viewedRun.content.result.sample.observed }} 个
              · 方法版本 {{ viewedRun.content.result.methodVersion }}
            </p>
            <ul data-testid="irs-evidence-notes">
              <li v-for="(note, index) in viewedRun.content.result.method.notes" :key="index">{{ note }}</li>
            </ul>
          </div>
        </template>
      </div>
    </template>
  </el-dialog>
</template>

<style scoped>
.irs__meta {
  margin: 0;
  color: var(--el-text-color-secondary);
  font-size: var(--el-font-size-extra-small);
}

.irs__row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 8px;
  padding: 10px 12px;
  margin-top: 8px;
}

.irs__row-main {
  min-width: 0;
}

.irs__row-title {
  margin: 0;
  font-size: var(--el-font-size-base);
}

.irs__row-meta {
  margin: 4px 0 0;
  font-size: var(--el-font-size-extra-small);
  color: var(--el-text-color-secondary);
}

.irs__loading,
.irs__more {
  text-align: center;
  padding: 8px 0 0;
  font-size: var(--el-font-size-extra-small);
  color: var(--el-text-color-secondary);
}

.irs__detail {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-top: 8px;
}

.irs__detail-head {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.irs__tag {
  font-size: var(--el-font-size-extra-small);
  color: var(--el-color-primary);
  border: 1px solid var(--el-color-primary-light-5);
  border-radius: 4px;
  padding: 0 6px;
}

.irs__runs {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
}

.irs__runs-label {
  font-size: var(--el-font-size-extra-small);
  color: var(--el-text-color-secondary);
}

.irs__evidence {
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 8px;
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.irs__evidence h5 {
  margin: 0;
  font-size: var(--el-font-size-small);
}

.irs__evidence ul,
.irs__evidence p {
  margin: 0;
  padding-left: 18px;
  font-size: var(--el-font-size-extra-small);
  color: var(--el-text-color-regular);
}

.irs__evidence p {
  padding-left: 0;
}
</style>
