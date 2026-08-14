<script setup lang="ts">
import { onMounted, ref } from 'vue'
import {
  getDashboard,
  runDashboardExecution,
  type DataOperation,
  type DashboardExecutionResponse,
  type DecisionBrief,
  type MarketRow,
  type MetricCard,
  type Notice
} from '@/services/dashboard/dashboardData'

const cards = ref<MetricCard[]>([])
const marketRows = ref<MarketRow[]>([])
const notices = ref<Notice[]>([])
const operations = ref<DataOperation[]>([])
const decisionBrief = ref<DecisionBrief | null>(null)
const loading = ref(false)
const actionLoading = ref(false)
const executionResult = ref<DashboardExecutionResponse | null>(null)
const restoredAt = ref('')

onMounted(async () => {
  loading.value = true
  try {
    const dashboard = await getDashboard()
    cards.value = dashboard.cards
    marketRows.value = dashboard.marketRows
    notices.value = dashboard.notices
    operations.value = dashboard.operations
    decisionBrief.value = dashboard.decisionBrief
    restoredAt.value = dashboard.summary.restoredAt
  } finally {
    loading.value = false
  }
})

async function executeAction(actionId: string) {
  actionLoading.value = true
  try {
    executionResult.value = await runDashboardExecution({ actionId })
  } finally {
    actionLoading.value = false
  }
}

async function executeBlocker(blockerId: string) {
  actionLoading.value = true
  try {
    executionResult.value = await runDashboardExecution({ blockerId })
  } finally {
    actionLoading.value = false
  }
}

function tagType(value?: string) {
  if (value === 'high' || value === 'blocked-by-auth-capture' || value === 'blocked-by-private-cache') return 'danger'
  if (value === 'medium' || value === 'pending-runtime-data' || value === 'static-fallback') return 'warning'
  return 'info'
}
</script>

<template>
  <div class="dashboard">
    <section class="metric-grid">
      <article v-for="card in cards" :key="card.label" class="metric-card" v-loading="loading">
        <span>{{ card.label }}</span>
        <strong>{{ card.value }} <small>{{ card.unit }}</small></strong>
        <em :class="card.tone">{{ card.trend }}</em>
      </article>
    </section>

    <section class="content-grid two-columns">
      <div class="panel">
        <div class="panel-title">
          <h2>交易概览</h2>
          <span>来自本地 `/api/market/list`</span>
        </div>
        <el-table :data="marketRows" height="310" v-loading="loading">
          <el-table-column prop="id" label="单据编号" min-width="150" />
          <el-table-column prop="product" label="交易品种" />
          <el-table-column prop="volume" label="电量(MWh)" width="110" />
          <el-table-column prop="price" label="价格" width="90" />
          <el-table-column prop="status" label="状态" width="90">
            <template #default="{ row }">
              <el-tag size="small">{{ row.status }}</el-tag>
            </template>
          </el-table-column>
        </el-table>
      </div>

      <div class="panel">
        <div class="panel-title">
          <h2>消息中心</h2>
          <span>对齐 `/system/notice/panel` 形态</span>
        </div>
        <div class="timeline" v-loading="loading">
          <div v-for="notice in notices" :key="notice.id" class="timeline-item">
            <span>{{ notice.level }}</span>
            <strong>{{ notice.title }}</strong>
            <small>{{ notice.time }}</small>
          </div>
        </div>
      </div>
    </section>

    <section v-if="decisionBrief" class="panel decision-brief" v-loading="loading">
      <div class="panel-title">
        <h2>决策简报</h2>
        <span>{{ decisionBrief.area }} · {{ decisionBrief.horizon }} · {{ decisionBrief.generatedAt }}</span>
      </div>

      <div class="brief-layout">
        <div class="brief-main">
          <div class="brief-heading">
            <el-tag :type="decisionBrief.riskLevel === 'high' ? 'danger' : 'warning'" effect="dark">
              {{ decisionBrief.riskLevel === 'medium' ? '中风险' : decisionBrief.riskLevel }}
            </el-tag>
            <strong>{{ decisionBrief.primaryRecommendation }}</strong>
          </div>
          <p>{{ decisionBrief.summary }}</p>
          <div class="impact-strip">
            <article>
              <span>预计收益影响</span>
              <strong>{{ decisionBrief.expectedImpact.marginYuan.toLocaleString() }}</strong>
              <small>元</small>
            </article>
            <article>
              <span>偏差费用变化</span>
              <strong>{{ decisionBrief.expectedImpact.deviationFeeYuan.toLocaleString() }}</strong>
              <small>元</small>
            </article>
            <article>
              <span>风险分变化</span>
              <strong>{{ decisionBrief.expectedImpact.riskScoreDelta }}</strong>
              <small>分</small>
            </article>
          </div>
        </div>

        <div class="brief-side">
          <span>下次复核</span>
          <strong>{{ decisionBrief.nextReviewAt }}</strong>
          <small>静态简报，后续由预测模型和私有缓存刷新</small>
        </div>
      </div>

      <div class="brief-section">
        <h3>建议动作</h3>
        <div class="action-grid">
          <article v-for="action in decisionBrief.recommendedActions" :key="action.id" class="action-card">
            <div>
              <el-tag size="small" :type="action.priority === 'high' ? 'danger' : 'warning'">
                {{ action.priority }}
              </el-tag>
              <span>{{ action.owner }}</span>
            </div>
            <strong>{{ action.action }}</strong>
            <small>{{ action.window }} · {{ action.trigger }}</small>
            <p>{{ action.nextStep }}</p>
            <el-button link type="primary" :disabled="actionLoading" @click="executeAction(action.id)">展开联动</el-button>
          </article>
        </div>
      </div>

      <div class="brief-section">
        <h3>证据链</h3>
        <div class="evidence-list">
          <article v-for="item in decisionBrief.evidence" :key="item.id">
            <strong>{{ item.label }}</strong>
            <span>{{ item.metric }}</span>
            <small>{{ item.family }} · {{ item.localApi }} · 置信度 {{ item.confidence }}%</small>
          </article>
        </div>
      </div>

      <div class="brief-section">
        <h3>阻断项</h3>
        <div class="blocker-list">
          <article v-for="blocker in decisionBrief.blockers" :key="blocker.id">
            <strong>{{ blocker.label }}</strong>
            <span>{{ blocker.status }}</span>
            <p>{{ blocker.detail }}</p>
            <el-button link type="primary" :disabled="actionLoading" @click="executeBlocker(blocker.id)">查看方案</el-button>
          </article>
        </div>
      </div>
    </section>

    <section v-if="executionResult" class="panel" v-loading="actionLoading">
      <div class="panel-title">
        <h2>首页简报执行结果</h2>
        <span>{{ executionResult.executionSummary.status }}</span>
      </div>

      <div class="review-summary-grid">
        <article>
          <span>简报编号</span>
          <strong>{{ executionResult.briefId }}</strong>
        </article>
        <article>
          <span>区域 / 窗口</span>
          <strong>{{ executionResult.area }} · {{ executionResult.horizon }}</strong>
        </article>
        <article>
          <span>下游路由</span>
          <strong>{{ executionResult.nextRoutes.join(' / ') }}</strong>
        </article>
        <article>
          <span>当前对象</span>
          <strong>{{ executionResult.action?.id ?? executionResult.blocker?.id ?? '-' }}</strong>
        </article>
      </div>

      <div class="restore-notes">
        <p>{{ executionResult.executionSummary.message }}</p>
        <p>{{ executionResult.gitPolicy }}</p>
      </div>

      <el-table :data="executionResult.validationChecks" border>
        <el-table-column prop="label" label="校验项" min-width="180" />
        <el-table-column prop="result" label="结果" width="100">
          <template #default="{ row }">
            <el-tag size="small" :type="row.result === 'pass' ? 'success' : row.result === 'warn' ? 'warning' : 'danger'">
              {{ row.result }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="detail" label="说明" min-width="300" show-overflow-tooltip />
      </el-table>

      <template v-if="executionResult.action && executionResult.decisionSupportExecution">
        <div class="panel-title compact-panel-title">
          <h2>动作联动</h2>
          <span>{{ executionResult.action.id }} · {{ executionResult.decisionSupportExecution.statusSummary.executionStatus }}</span>
        </div>

        <div class="review-summary-grid">
          <article>
            <span>建议动作</span>
            <strong>{{ executionResult.action.action }}</strong>
          </article>
          <article>
            <span>人工闸口</span>
            <strong>{{ executionResult.decisionSupportExecution.statusSummary.manualGate }}</strong>
          </article>
          <article>
            <span>联动执行</span>
            <strong>{{ executionResult.decisionSupportExecution.linkedExecutions.length }}</strong>
          </article>
          <article>
            <span>执行计划</span>
            <strong>{{ executionResult.decisionSupportExecution.executionPlans.length }}</strong>
          </article>
        </div>

        <div class="review-summary-grid">
          <article>
            <span>关联证据</span>
            <div class="tag-list">
              <el-tag v-for="item in executionResult.decisionSupportExecution.evidence" :key="item.id" size="small">
                {{ item.id }} · {{ item.label }}
              </el-tag>
            </div>
          </article>
          <article>
            <span>数据就绪度</span>
            <div class="tag-list">
              <el-tag
                v-for="item in executionResult.decisionSupportExecution.dataReadiness"
                :key="item.family"
                size="small"
                :type="tagType(item.runtimeStatus)"
              >
                {{ item.family }} · {{ item.runtimeStatus }}
              </el-tag>
            </div>
          </article>
        </div>

        <el-table :data="executionResult.decisionSupportExecution.linkedExecutions" border>
          <el-table-column prop="id" label="执行编号" width="100" />
          <el-table-column prop="title" label="联动执行" min-width="180" />
          <el-table-column prop="status" label="状态" width="150">
            <template #default="{ row }">
              <el-tag size="small" :type="tagType(row.status)">{{ row.status }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column prop="localRoute" label="下游页面" min-width="180" show-overflow-tooltip />
          <el-table-column prop="summary" label="摘要" min-width="260" show-overflow-tooltip />
        </el-table>
      </template>

      <template v-else-if="executionResult.blocker && executionResult.blockerPlan">
        <div class="panel-title compact-panel-title">
          <h2>阻断处理方案</h2>
          <span>{{ executionResult.blocker.label }} · {{ executionResult.blockerPlan.owner }}</span>
        </div>

        <div class="review-summary-grid">
          <article>
            <span>阻断状态</span>
            <strong>{{ executionResult.blockerPlan.status }}</strong>
          </article>
          <article>
            <span>责任方</span>
            <strong>{{ executionResult.blockerPlan.owner }}</strong>
          </article>
          <article>
            <span>目标路由</span>
            <strong>{{ executionResult.blockerPlan.nextRoutes.join(' / ') }}</strong>
          </article>
          <article>
            <span>阻断编号</span>
            <strong>{{ executionResult.blocker.id }}</strong>
          </article>
        </div>

        <div class="restore-notes">
          <p>{{ executionResult.blocker.detail }}</p>
        </div>

        <el-table :data="executionResult.blockerPlan.nextSteps.map((step, index) => ({ id: index + 1, step }))" border>
          <el-table-column prop="id" label="步骤" width="80" />
          <el-table-column prop="step" label="处理动作" min-width="420" show-overflow-tooltip />
        </el-table>
      </template>
    </section>

    <section class="panel">
      <div class="panel-title">
        <h2>数据导入/导出入口</h2>
        <span>发现的线上业务操作</span>
      </div>
      <el-table :data="operations" border>
        <el-table-column prop="label" label="操作" min-width="170" />
        <el-table-column prop="kind" label="类型" width="100" />
        <el-table-column prop="family" label="业务族" min-width="150" />
        <el-table-column prop="path" label="线上接口" min-width="210" />
        <el-table-column label="文件类型" width="130">
          <template #default="{ row }">
            {{ row.fileTypes.join(', ') }}
          </template>
        </el-table-column>
      </el-table>
      <div class="restore-notes">
        <p>本地静态 API 已承载首页、交易、客户、合同、结算、分析、预测与系统管理数据，当前快照日期：{{ restoredAt }}。</p>
      </div>
    </section>
  </div>
</template>
