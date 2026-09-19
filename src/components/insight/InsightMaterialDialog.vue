<script setup lang="ts">
// 市场洞察区块 → 复盘底稿材料窗口（dljy#3078，OpenSpec 任务 14.5，CH02/DE11/A24）
// ----------------------------------------------------------------------------
// 把当前区块结果（事实 + 图表定义 + 质量 + 版本引用）保存为复盘底稿材料，全流程复用既有协议：
//   1. 冻结保存走 POST /api/v1/review/evidence（kind: 'market_insight'，dljy#3020 契约）：
//      请求只带「登记分析 + 上下文 + 筛选 + 期望版本」，服务端按登记分析重新读取并核对版本，
//      不一致返回 409（提示先重新运行，绝不静默保存新值）；幂等键按内容派生，重复保存同一份
//      结果返回同一份材料（不重复创建）。
//   2. 加入底稿走既有底稿读写（GET + PATCH /api/v1/review/workpapers/{id}）：材料以「图表块」
//      进入正文；底稿只允许主笔修改（canEdit），材料范围与复盘对象是否一致按服务端同一口径
//      判定「本次依据 / 比较依据」。
//   3. 语义纪律：未成功绝不提示成功；冻结成功但入稿失败时如实说明两步各自的状态；
//      底稿服务不可用只在本窗口诚实报错，不阻断分析页其余功能。
//   4. 选择器纪律：只列既有底稿（复盘工作台同一份列表），不新建第二套底稿/专题选择协议。

import { computed, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { idempotencyKeyOf } from '@/services/api'
import {
  captureInsightMaterial,
  getWorkpaper,
  insightAttachError,
  insightMaterialError,
  listWorkpapers,
  saveWorkpaper,
  type InsightMaterialEvidence,
  type Workpaper,
} from '@/services/review/workpapers'
import { workpaperOptionLabel } from '@/services/review/reportPresentation'
import { shortRef } from './insightText'

/**
 * 材料主体的版本引用视图：窗口只消费业务窗口起止与期望版本（resultVersion/readSetRef），
 * 洞察区块结果（insight/v1）与研究运行产物（insight-research/v1）都满足——保存核对走
 * 期望版本，组件不依赖其它结果字段（价格页与研究页同一入口，任务 14.5/14.6）。
 */
type InsightMaterialResultRef = {
  businessWindow: { start: string; end: string }
  resultVersion?: string
  readSetRef?: string
}

const props = defineProps<{
  /** v-model：窗口开关 */
  modelValue: boolean
  region: string
  companyId: string
  /** 区块业务标题（提示与成功文案用，如「时段走势」） */
  subject: string
  /** 冻结请求：登记分析 + 上下文 + 筛选（上下文不含代次，保证同口径重复保存幂等键稳定） */
  request: { analysisId: string; context: Record<string, unknown>; filters?: Record<string, unknown> } | null
  /** 当前结果主体：提供期望版本（resultVersion/readSetRef）与业务窗口说明 */
  result: InsightMaterialResultRef | null
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  /** 冻结并加入底稿成功（幂等命中「已在底稿中」也算成功路径） */
  saved: []
}>()

const visible = computed({
  get: () => props.modelValue,
  set: (value: boolean) => emit('update:modelValue', value),
})

const papers = ref<Workpaper[]>([])
const paperId = ref('')
const loading = ref(false)
const saving = ref(false)
const error = ref('')

watch(
  () => props.modelValue,
  (open) => {
    if (!open) return
    paperId.value = ''
    error.value = ''
    papers.value = []
    void loadPapers()
  },
  // immediate：挂载时已打开（KeepAlive 恢复、测试直接挂开态）也要先读底稿列表
  { immediate: true }
)

async function loadPapers(): Promise<void> {
  loading.value = true
  error.value = ''
  try {
    const page = await listWorkpapers(props.companyId, props.region)
    papers.value = page.rows
  } catch (e) {
    // 底稿列表读不到：本窗口诚实报错，分析页其余功能不受影响。
    error.value = insightMaterialError(e, '底稿列表读取失败，请稍后重试；不影响分析页其余功能。')
  } finally {
    loading.value = false
  }
}

/**
 * 与服务端 validateMaterialReferences 同口径：材料窗口覆盖复盘对象且对象在所选对象里，
 * 才能作「本次依据」；市场级材料（无对象维度）或范围不同一律「比较依据」。
 */
function evidenceRoleOf(paper: Workpaper, material: InsightMaterialEvidence): 'primary' | 'comparison' {
  const window = material.content.input.context.businessWindow
  const objects = material.content.input.filters?.objectIds
  const covers =
    Array.isArray(objects) &&
    objects.includes(paper.scope.objectId) &&
    window.start >= paper.scope.startDate &&
    window.end <= paper.scope.endDate
  return covers ? 'primary' : 'comparison'
}

async function save(): Promise<void> {
  const request = props.request
  const result = props.result
  if (!request || !result?.resultVersion || !result.readSetRef || !paperId.value || saving.value) return
  if (!props.companyId) {
    error.value = '请先选择公司再保存材料，本次未保存'
    return
  }
  saving.value = true
  error.value = ''
  const expected = { resultVersion: result.resultVersion, readSetRef: result.readSetRef }
  // 幂等键按业务内容派生（仓库既有约定 idempotencyKeyOf）：同口径重复保存同键 → 服务端
  // 返回同一份冻结材料；换底稿再存也不会重复创建材料。
  const key = idempotencyKeyOf('insight-material', {
    region: props.region,
    analysisId: request.analysisId,
    filters: request.filters ?? null,
    expected,
  })
  try {
    // 先读底稿再冻结：主笔之外改不了底稿，先说清，避免留下一份无处可挂的孤儿材料。
    const paper = await getWorkpaper(props.companyId, props.region, paperId.value)
    if (paper.canEdit !== true) {
      error.value = `这份底稿由 ${paper.authorId} 主笔，只有主笔可以修改。本次未保存；请选择你主笔的底稿。`
      return
    }
    let material: InsightMaterialEvidence
    try {
      material = await captureInsightMaterial(props.companyId, props.region, request, expected, key)
    } catch (e) {
      error.value = insightMaterialError(e, '材料服务暂不可用，本次未保存；分析页其余功能不受影响。')
      return
    }
    if (paper.blocks.some((block) => block.evidenceId === material.id)) {
      // 幂等命中：同一份结果重复保存，不重复创建、不重复入稿。
      ElMessage.success(`「${props.subject}」的材料已在底稿「${paper.title}」中，未重复创建`)
      emit('saved')
      visible.value = false
      return
    }
    paper.blocks.push({
      id: crypto.randomUUID(),
      kind: 'chart',
      title: material.content.labels.join('与'),
      text: '',
      evidenceId: material.id,
      evidenceRole: evidenceRoleOf(paper, material),
    })
    try {
      await saveWorkpaper(props.companyId, paper)
    } catch (e) {
      error.value = insightAttachError(e)
      return
    }
    ElMessage.success(`已把「${props.subject}」加入底稿「${paper.title}」`)
    emit('saved')
    visible.value = false
  } catch (e) {
    // 底稿读取失败：还没有保存任何东西，如实说未保存。
    error.value = insightMaterialError(e, '底稿读取失败，本次未保存；请稍后重试。')
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <el-dialog
    v-model="visible"
    title="把分析加入复盘底稿"
    width="540px"
    append-to-body
    data-testid="insight-material-dialog"
  >
    <div v-if="result && request" class="insight-material">
      <p class="insight-material__meta">
        将保存「{{ subject }}」：业务窗口 {{ result.businessWindow.start }} ~ {{ result.businessWindow.end }} ·
        结果版本 {{ shortRef(result.resultVersion) }}
      </p>
      <p class="insight-material__meta">
        服务端会按相同口径重新读取并核对版本，核对一致才冻结保存；资料已更新时会要求先重新运行。重复保存同一份结果不会重复创建。
      </p>
      <label class="insight-material__field">
        <span>选择已有底稿</span>
        <el-select
          v-model="paperId"
          filterable
          placeholder="选择要加入的底稿"
          :loading="loading"
          data-testid="insight-material-paper"
        >
          <el-option v-for="paper in papers" :key="paper.id" :label="workpaperOptionLabel(paper)" :value="paper.id" />
        </el-select>
      </label>
      <el-alert
        v-if="error"
        type="error"
        show-icon
        :closable="false"
        :title="error"
        data-testid="insight-material-error"
      />
      <div class="insight-material__actions">
        <el-button size="small" @click="visible = false">取消</el-button>
        <el-button
          size="small"
          type="primary"
          :loading="saving"
          :disabled="!paperId"
          data-testid="insight-material-save"
          @click="save"
        >
          {{ saving ? '正在保存…' : '保存并加入底稿' }}
        </el-button>
      </div>
    </div>
    <el-empty v-else description="当前区块没有可保存的结果" />
  </el-dialog>
</template>

<style scoped>
.insight-material {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.insight-material__meta {
  margin: 0;
  color: var(--muted, #687987);
  font-size: var(--font-sm, 13px);
  line-height: 1.6;
}

.insight-material__field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.insight-material__field > span {
  color: var(--muted, #50616e);
  font-size: var(--font-sm, 13px);
  font-weight: 650;
}

.insight-material__actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
</style>
