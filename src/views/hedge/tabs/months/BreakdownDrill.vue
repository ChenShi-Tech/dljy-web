<script setup lang="ts">
// 钻取区：/breakdown 的维度分类 → 合同明细（HW-04/HC-02/HM-06；openspec build-midlong-spot-hedging 任务 8.3，ChenShi-Tech/dljy#3421）。
//
// 层级为「公司合计 → 所选维度分类 → 该分类下的合同（只读，链接中长期合同详情）」。接口按维度返回全公司
// 分类（无按上层 key 过滤的参数），所以每层的一致性用双显示呈现：服务端 consistency 徽标（权威）+ 前端
// 十进制「分类求和」与「公司合计」并排对照（HM-06：明细之和等于上一层）。FORBIDDEN 显示「无权限查看中长期
// 持仓」，不渲染分类与合计，绝不显示 0（HW-04）。维度切换用序号丢弃迟到响应，作用域变化由
// workbench.scopedRequest 兜底丢弃。窗口只收「已提交范围」（父页签点「按此范围加载」后经 props 传入并显式
// 调 load，草稿月份不触发取数——月卡与钻取恒为同一窗口，#3421 审查 R1-01）。
import { computed, ref } from 'vue'
import { RouterLink } from 'vue-router'
import { HedgeApiError } from '@/services/hedge/hedgeApi'
import {
  BREAKDOWN_QUERY_DIMENSIONS, BREAKDOWN_QUERY_DIMENSION_LABELS, BREAKDOWN_SPECIAL_KEY_LABELS,
  fetchBreakdownView, monthWindowOf,
} from '@/services/hedge/hedgeMonthsApi'
import type { BreakdownDimension, HedgeBreakdownPayload } from '@/services/hedge/hedgeMonthsApi'
import { formatBeijingTime } from '@/services/hedge/hedgeMaintenanceModel'
import { injectHedgeWorkbench } from '../../useHedgeWorkbench'
import { consistencyView, sumRowMwh } from './monthsModel'

const props = defineProps<{ fromMonth: string; toMonth: string }>()

const workbench = injectHedgeWorkbench()

const FORBIDDEN_TEXT = '无权限查看中长期持仓'

const dimension = ref<BreakdownDimension>('subject')
const payload = ref<HedgeBreakdownPayload | null>(null)
const loading = ref(false)
const error = ref<string | null>(null)
/** 展开的分类行（key 字符串化做索引）。 */
const expandedKeys = ref<Record<string, boolean>>({})

/** 维度切换连续变化时丢弃被取代的迟到响应（与维护页签基准查询同一模式）。 */
let seq = 0

async function load() {
  const window = monthWindowOf(props.fromMonth, props.toMonth)
  if (!window) {
    error.value = '月份范围无效，钻取未加载'
    return
  }
  const scoped = workbench.scopedRequest()
  const mySeq = ++seq
  const current = () => scoped() && mySeq === seq
  loading.value = true
  error.value = null
  try {
    const data = await fetchBreakdownView({
      fromDate: window.fromDate, toDate: window.toDate, dimension: dimension.value,
      asOf: workbench.asOf.value ?? undefined,
    })
    if (!current()) return // 迟到响应丢弃（作用域或序号已过）
    payload.value = data
    expandedKeys.value = {}
  } catch (err) {
    if (!current()) return
    payload.value = null
    error.value = err instanceof HedgeApiError ? `${err.errorCode}：${err.message}` : '钻取数据加载失败，可重试'
  } finally {
    if (current()) loading.value = false
  }
}

/** 公司/地区切换时由页签 lifecycle 调用：清空全部结果并作废在途请求。 */
function reset() {
  seq++
  payload.value = null
  loading.value = false
  error.value = null
  expandedKeys.value = {}
}

function switchDimension(next: string) {
  if (dimension.value === next) return
  dimension.value = next as BreakdownDimension
  void load()
}

function toggleRow(key: string | number) {
  const id = String(key)
  expandedKeys.value[id] = !expandedKeys.value[id]
}

/** 特殊分类键用契约标签（未分类/未分配/月份未分到场站），普通分类用服务端 label。 */
function rowLabel(row: { key: string | number; label: string }): string {
  return BREAKDOWN_SPECIAL_KEY_LABELS[row.key as keyof typeof BREAKDOWN_SPECIAL_KEY_LABELS] ?? row.label
}

const consistency = computed(() => consistencyView(payload.value?.consistency ?? null))

defineExpose({ load, reset })
</script>

<template>
  <section class="drill" data-test="breakdown-drill">
    <header class="drill-head">
      <h3>钻取：公司 → 维度分类 → 合同</h3>
      <span class="hint">{{ payload?.basisNote ?? '按窗口所触及月份的月度净义务分类（只读）' }}</span>
    </header>

    <div class="dim-bar" data-test="drill-dimensions">
      <button
        v-for="dim in BREAKDOWN_QUERY_DIMENSIONS"
        :key="dim"
        type="button"
        :class="{ active: dimension === dim }"
        :data-test="`drill-dim-${dim}`"
        @click="switchDimension(dim)"
      >{{ BREAKDOWN_QUERY_DIMENSION_LABELS[dim as BreakdownDimension] }}</button>
    </div>

    <p v-if="error" class="error" data-test="drill-error">{{ error }}</p>
    <p v-else-if="loading" data-test="drill-loading">加载中…</p>

    <!-- FORBIDDEN：整块只说无权限，不渲染分类与合计——没有数据不是 0（HW-04） -->
    <div v-else-if="payload?.status === 'FORBIDDEN'" class="forbidden" data-test="drill-forbidden">
      {{ FORBIDDEN_TEXT }}{{ payload.reason ? `（${payload.reason}）` : '' }}——不显示分类与合计
    </div>

    <template v-else-if="payload">
      <div class="drill-summary">
        <span>公司合计：<b data-test="drill-total">{{ payload.totalMwh ?? '未知' }} MWh</b></span>
        <span>分类求和：<b data-test="drill-sum">{{ sumRowMwh(payload.rows) }} MWh</b></span>
        <span
          v-if="consistency"
          class="badge"
          :class="consistency.tone"
          data-test="drill-consistency"
        >{{ consistency.text }}</span>
      </div>

      <table class="drill-table" data-test="drill-rows">
        <thead>
          <tr><th>{{ BREAKDOWN_QUERY_DIMENSION_LABELS[dimension] }}</th><th>锁价量（MWh）</th><th>合同数</th><th></th></tr>
        </thead>
        <tbody>
          <template v-for="row in payload.rows" :key="row.key">
            <tr :data-test="`drill-row-${row.key}`">
              <td>{{ rowLabel(row) }}</td>
              <td>{{ row.quantityMwh }}</td>
              <td>{{ row.contractCount }}</td>
              <td>
                <button
                  v-if="row.contracts.length"
                  type="button"
                  class="link"
                  :data-test="`drill-toggle-${row.key}`"
                  @click="toggleRow(row.key)"
                >{{ expandedKeys[String(row.key)] ? '收起合同' : '展开合同' }}</button>
              </td>
            </tr>
            <tr v-if="expandedKeys[String(row.key)]" class="contract-row" :data-test="`drill-contracts-${row.key}`">
              <td colspan="4">
                <table class="contract-table" :data-test="`drill-contract-table-${row.key}`">
                  <thead>
                    <tr><th>合同</th><th>外部编号</th><th>版本</th><th>锁价量（MWh）</th><th>确认时间</th><th>指纹</th><th></th></tr>
                  </thead>
                  <tbody>
                    <tr v-for="contract in row.contracts" :key="contract.contractId" :data-test="`drill-contract-${contract.contractId}`">
                      <td>{{ contract.contractName ?? `合同 #${contract.contractId}` }}</td>
                      <td>{{ contract.externalContractNo ?? '—' }}</td>
                      <td>v{{ contract.revisionNo ?? '—' }}</td>
                      <td>{{ contract.quantityMwh }}</td>
                      <td>{{ formatBeijingTime(contract.confirmedAt) }}</td>
                      <td><span :title="contract.fingerprint ?? ''">{{ contract.fingerprint ? `${contract.fingerprint.slice(0, 12)}…` : '—' }}</span></td>
                      <td>
                        <RouterLink
                          v-if="contract.detail"
                          :to="`/zcqjy/contracts/${contract.detail.contractId}`"
                          :data-test="`drill-contract-link-${contract.contractId}`"
                        >查看合同</RouterLink>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </td>
            </tr>
          </template>
          <tr v-if="!payload.rows.length">
            <td colspan="4" class="hint">该维度下暂无中长期月度净义务</td>
          </tr>
        </tbody>
      </table>
    </template>

    <p v-else class="hint">选择月份范围后自动加载钻取</p>
  </section>
</template>

<style scoped>
.drill { border: 1px solid var(--border, #e5e7eb); border-radius: 8px; padding: 14px 16px; display: flex; flex-direction: column; gap: 10px; }
.drill-head { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; }
.drill-head h3 { margin: 0; font-size: var(--font-lg, 16px); }
.dim-bar { display: flex; gap: 6px; flex-wrap: wrap; }
.dim-bar button { padding: 3px 12px; border-radius: 999px; border: 1px solid var(--border, #dcdfe6); background: transparent; font-size: var(--font-sm, 13px); cursor: pointer; }
.dim-bar button.active { color: var(--accent, #409eff); border-color: currentColor; font-weight: 600; }
.drill-summary { display: flex; gap: 16px; align-items: center; flex-wrap: wrap; font-size: var(--font-sm, 13px); }
.badge { padding: 1px 8px; border-radius: 999px; font-size: var(--font-xs, 12px); border: 1px solid; }
.badge.ok { color: var(--success, #67c23a); border-color: currentColor; }
.badge.partial { color: var(--warning, #e6a23c); border-color: currentColor; }
.badge.danger { color: var(--danger, #f56c6c); border-color: currentColor; }
.drill-table, .contract-table { width: 100%; border-collapse: collapse; font-size: var(--font-sm, 13px); }
.drill-table th, .drill-table td, .contract-table th, .contract-table td { border-bottom: 1px solid #f0f0f0; padding: 4px 8px; text-align: left; }
.contract-row > td { background: color-mix(in srgb, var(--accent, #409eff) 3%, transparent); }
button.link { border: none; background: none; color: var(--accent, #409eff); cursor: pointer; padding: 0; font-size: var(--font-sm, 13px); }
.forbidden { color: var(--danger, #f56c6c); font-size: var(--font-md, 14px); }
.error { color: var(--danger, #b91c1c); }
.hint { color: var(--muted, #909399); font-size: var(--font-xs, 12px); }
a { color: var(--accent, #409eff); }
</style>
