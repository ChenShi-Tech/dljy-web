<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import {
  AlertTriangle,
  ArrowRight,
  BookOpen,
  Calculator,
  FileText,
  Landmark,
  Layers,
  Network,
  ShieldCheck,
  Users
} from 'lucide-vue-next'
import { getRegionStatusLabel } from '../data/regions'
import { getCurrentUser, type AuthUser } from '@/services/auth'
import { canAccessPath, isPathAvailableInRegion, roleLabels, subjectTypeLabels } from '@/services/governance'
import { currentRegion } from '@/services/region/regionContext'
import { getRegionBusinessModules } from '@/services/region/regionModules'
import {
  getSubjectRuleFocus,
  useRegionRules,
  type RuleDocument,
  type RuleDocumentStatus,
  type RuleSection
} from '../rules'

type TagType = 'success' | 'warning' | 'info' | 'danger' | 'primary'

const router = useRouter()
const { profile, isFallback } = useRegionRules()
const currentUser = ref<AuthUser>(getCurrentUser())
const activeTab = ref('flow')

const focus = computed(() => getSubjectRuleFocus(profile.value.regionId, currentUser.value))
const roleLabel = computed(() => roleLabels[currentUser.value.roleCode])
const subjectLabel = computed(() => subjectTypeLabels[currentUser.value.subjectType])
const regionStatus = computed(() => getRegionStatusLabel(currentRegion.value.ruleSet.spotRuleStatus))
const officialDocs = computed(() => profile.value.documents.filter((doc) => doc.status === 'official').length)
const sourceDocs = computed(() => profile.value.documents.length)
const visibleRecommendedRoutes = computed(() => {
  const regionId = currentRegion.value.id
  return focus.value.recommendedRoutes.filter((route) => {
    return isPathAvailableInRegion(route.path, regionId) && canAccessPath(route.path, currentUser.value)
  })
})
const regionModuleCards = computed(() => {
  const regionId = currentRegion.value.id
  return getRegionBusinessModules(regionId).map((module) => ({
    ...module,
    visibleRoutes: module.entryRoutes.filter((route) => {
      return isPathAvailableInRegion(route.path, regionId) && canAccessPath(route.path, currentUser.value)
    })
  }))
})

const flowSections = computed<RuleSection[]>(() => [
  profile.value.marketArchitecture,
  ...profile.value.participants,
  ...profile.value.tradingProducts,
  ...profile.value.clearingTimeline
])
const priceSections = computed<RuleSection[]>(() => [
  ...profile.value.pricingModel,
  ...profile.value.settlementModel
])
const riskSections = computed<RuleSection[]>(() => [
  ...profile.value.riskControls,
  ...profile.value.disclosureRules,
  profile.value.developmentStatus
])

function onGovernanceUserChanged(event: Event) {
  currentUser.value = (event as CustomEvent<AuthUser>).detail ?? getCurrentUser()
}

function goRoute(path: string) {
  router.push(path)
}

function openDocument(doc: RuleDocument) {
  window.open(doc.url, '_blank', 'noopener,noreferrer')
}

function docStatusLabel(status: RuleDocumentStatus) {
  const labels: Record<RuleDocumentStatus, string> = {
    official: '正式规则',
    consultation: '征求意见稿',
    trial: '试运行方案',
    'industry-reference': '行业转载待核验'
  }
  return labels[status]
}

function docStatusType(status: RuleDocumentStatus): TagType {
  const types: Record<RuleDocumentStatus, TagType> = {
    official: 'success',
    consultation: 'warning',
    trial: 'primary',
    'industry-reference': 'info'
  }
  return types[status]
}

function moduleStageLabel(stage: 'active' | 'trial' | 'planned') {
  const labels: Record<'active' | 'trial' | 'planned', string> = {
    active: '已启用',
    trial: '样板建设',
    planned: '规划中'
  }
  return labels[stage]
}

function moduleStageType(stage: 'active' | 'trial' | 'planned'): TagType {
  const types: Record<'active' | 'trial' | 'planned', TagType> = {
    active: 'success',
    trial: 'primary',
    planned: 'info'
  }
  return types[stage]
}

onMounted(() => {
  window.addEventListener('governance-user-changed', onGovernanceUserChanged)
})

onUnmounted(() => {
  window.removeEventListener('governance-user-changed', onGovernanceUserChanged)
})
</script>

<template>
  <div class="region-rules">
    <section class="rule-hero">
      <div class="rule-hero-main">
        <div class="hero-kicker">
          <Landmark :size="16" />
          <span>{{ currentRegion.gridLabel }} · {{ currentRegion.regionGroup }}</span>
        </div>
        <h2>{{ currentRegion.name }}交易规则体系</h2>
        <p>{{ profile.marketArchitecture.summary }}</p>
        <div class="hero-tags">
          <el-tag :type="isFallback ? 'info' : 'success'">{{ profile.marketStage }}</el-tag>
          <el-tag type="warning">{{ regionStatus }}</el-tag>
          <el-tag type="info">{{ currentRegion.ruleSet.settlementModel }}</el-tag>
        </div>
      </div>
      <div class="hero-metrics">
        <div>
          <strong>{{ sourceDocs }}</strong>
          <span>规则资料</span>
        </div>
        <div>
          <strong>{{ officialDocs }}</strong>
          <span>正式文件</span>
        </div>
        <div>
          <strong>{{ profile.subjectFocus.length }}</strong>
          <span>主体关注</span>
        </div>
      </div>
    </section>

    <section class="module-panel">
      <div class="module-heading">
        <div>
          <div class="section-kicker">
            <Layers :size="16" />
            <span>地区业务模块</span>
          </div>
          <h3>{{ currentRegion.name }}业务入口</h3>
        </div>
        <el-tag :type="regionModuleCards.length ? 'success' : 'info'">
          {{ regionModuleCards.length ? `${regionModuleCards.length} 个专属模块` : '待定制' }}
        </el-tag>
      </div>

      <div v-if="regionModuleCards.length" class="module-grid">
        <article v-for="module in regionModuleCards" :key="module.id" class="module-card">
          <div class="module-card-head">
            <div>
              <strong>{{ module.title }}</strong>
              <p>{{ module.summary }}</p>
            </div>
            <el-tag :type="moduleStageType(module.stage)" size="small">{{ moduleStageLabel(module.stage) }}</el-tag>
          </div>
          <div class="module-route-list">
            <button
              v-for="route in module.visibleRoutes"
              :key="route.path"
              class="module-route"
              type="button"
              @click="goRoute(route.path)"
            >
              <span>
                <strong>{{ route.title }}</strong>
                <small>{{ route.summary }}</small>
              </span>
              <ArrowRight :size="15" />
            </button>
            <p v-if="!module.visibleRoutes.length" class="route-empty">当前身份暂无该模块入口。</p>
          </div>
        </article>
      </div>

      <div v-else class="module-empty">
        <strong>{{ currentRegion.shortName }}专属业务模块待定制</strong>
        <span>当前仅展示规则框架、主体关注点和通用功能入口；不会复用云南交易逻辑。</span>
      </div>
    </section>

    <section class="focus-panel">
      <div class="focus-heading">
        <div>
          <div class="section-kicker">
            <Users :size="16" />
            <span>{{ roleLabel }} · {{ subjectLabel }}</span>
          </div>
          <h3>{{ focus.title }}</h3>
          <p>{{ focus.summary }}</p>
        </div>
        <el-tag type="primary">{{ currentUser.subjectName }}</el-tag>
      </div>

      <div class="focus-grid">
        <div class="focus-block">
          <div class="block-title">
            <BookOpen :size="16" />
            <span>重点关注</span>
          </div>
          <div class="concern-list">
            <span v-for="item in focus.keyConcerns" :key="item">{{ item }}</span>
          </div>
        </div>

        <div class="focus-block">
          <div class="block-title">
            <AlertTriangle :size="16" />
            <span>风险提示</span>
          </div>
          <ul class="plain-list">
            <li v-for="warning in focus.riskWarnings" :key="warning">{{ warning }}</li>
          </ul>
        </div>

        <div class="focus-block route-block">
          <div class="block-title">
            <ArrowRight :size="16" />
            <span>推荐入口</span>
          </div>
          <button
            v-for="route in visibleRecommendedRoutes"
            :key="route.path"
            class="route-link"
            type="button"
            @click="goRoute(route.path)"
          >
            <span>
              <strong>{{ route.title }}</strong>
              <small>{{ route.reason }}</small>
            </span>
            <ArrowRight :size="16" />
          </button>
          <p v-if="!visibleRecommendedRoutes.length" class="route-empty">当前身份暂无可用推荐入口。</p>
        </div>
      </div>
    </section>

    <section class="rule-tabs">
      <el-tabs v-model="activeTab">
        <el-tab-pane name="flow">
          <template #label>
            <span class="tab-label"><Network :size="15" />交易组织</span>
          </template>
          <div class="section-grid">
            <article v-for="section in flowSections" :key="section.title" class="rule-card">
              <h4>{{ section.title }}</h4>
              <p>{{ section.summary }}</p>
              <ul>
                <li v-for="item in section.items" :key="item">{{ item }}</li>
              </ul>
            </article>
          </div>
        </el-tab-pane>

        <el-tab-pane name="pricing">
          <template #label>
            <span class="tab-label"><Calculator :size="15" />价格结算</span>
          </template>
          <div class="section-grid">
            <article v-for="section in priceSections" :key="section.title" class="rule-card">
              <h4>{{ section.title }}</h4>
              <p>{{ section.summary }}</p>
              <ul>
                <li v-for="item in section.items" :key="item">{{ item }}</li>
              </ul>
            </article>
          </div>
        </el-tab-pane>

        <el-tab-pane name="risk">
          <template #label>
            <span class="tab-label"><ShieldCheck :size="15" />风控披露</span>
          </template>
          <div class="section-grid">
            <article v-for="section in riskSections" :key="section.title" class="rule-card">
              <h4>{{ section.title }}</h4>
              <p>{{ section.summary }}</p>
              <ul>
                <li v-for="item in section.items" :key="item">{{ item }}</li>
              </ul>
            </article>
          </div>
        </el-tab-pane>

        <el-tab-pane name="sources">
          <template #label>
            <span class="tab-label"><FileText :size="15" />资料来源</span>
          </template>
          <div class="source-table-wrap">
            <el-table :data="profile.documents" border>
              <el-table-column label="文件" min-width="280">
                <template #default="{ row }">
                  <button class="doc-title" type="button" @click="openDocument(row)">
                    {{ row.title }}
                  </button>
                  <small>{{ row.issuer }}</small>
                </template>
              </el-table-column>
              <el-table-column label="日期" prop="publishedAt" width="120" />
              <el-table-column label="效力" width="150">
                <template #default="{ row }">
                  <el-tag :type="docStatusType(row.status)" size="small">{{ docStatusLabel(row.status) }}</el-tag>
                </template>
              </el-table-column>
              <el-table-column label="本地资料" min-width="260">
                <template #default="{ row }">
                  <span class="local-path">{{ row.localPath || '未记录本地路径' }}</span>
                </template>
              </el-table-column>
            </el-table>
          </div>
        </el-tab-pane>
      </el-tabs>
    </section>

    <section class="reference-strip">
      <div>
        <strong>当前身份规则依据</strong>
        <span v-for="reference in focus.ruleReferences" :key="reference">{{ reference }}</span>
      </div>
      <el-tag v-if="isFallback" type="info">该地区规则待定制</el-tag>
    </section>
  </div>
</template>

<style scoped>
.region-rules {
  min-height: calc(100vh - 112px);
  padding: 14px 16px 28px;
  background: var(--panel-sub);
  color: var(--text);
}

.rule-hero {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 330px;
  gap: 16px;
  padding: 20px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: linear-gradient(135deg, var(--panel) 0%, var(--primary-tint) 55%, var(--panel-sub) 100%);
}

.rule-hero-main h2 {
  margin: 8px 0 8px;
  font-size: var(--font-28);
  font-weight: 750;
  color: var(--text);
  letter-spacing: 0;
}

.rule-hero-main p,
.focus-heading p,
.rule-card p {
  margin: 0;
  color: var(--text-soft);
  line-height: 1.7;
}

.hero-kicker,
.section-kicker,
.block-title,
.tab-label {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.hero-kicker,
.section-kicker {
  color: var(--primary);
  font-size: var(--font-md);
  font-weight: 650;
}

.hero-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 14px;
}

.hero-metrics {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
  align-self: stretch;
}

.hero-metrics div {
  display: flex;
  min-height: 112px;
  flex-direction: column;
  justify-content: center;
  padding: 14px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--panel);
}

.hero-metrics strong {
  font-size: var(--font-26);
  color: var(--primary);
}

.hero-metrics span {
  margin-top: 4px;
  color: var(--muted);
  font-size: var(--font-sm);
}

.focus-panel,
.module-panel,
.rule-tabs,
.reference-strip {
  margin-top: 14px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--panel);
}

.focus-panel {
  padding: 18px;
}

.module-panel {
  padding: 18px;
}

.module-heading,
.focus-heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.module-heading h3,
.focus-heading h3 {
  margin: 6px 0 8px;
  font-size: var(--font-20);
  color: var(--text);
}

.module-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
  margin-top: 14px;
}

.module-card {
  padding: 14px;
  border: 1px solid var(--line-soft);
  border-radius: 8px;
  background: var(--panel-sub);
}

.module-card-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.module-card-head strong,
.module-empty strong {
  color: var(--text);
}

.module-card-head p {
  margin: 6px 0 0;
  color: var(--text-soft);
  line-height: 1.6;
}

.module-route-list {
  display: grid;
  gap: 8px;
  margin-top: 12px;
}

.module-route {
  display: flex;
  min-height: 58px;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 12px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--panel);
  color: var(--text);
  cursor: pointer;
  text-align: left;
}

.module-route:hover {
  border-color: var(--primary);
  color: var(--primary);
}

.module-route strong,
.module-route small {
  display: block;
}

.module-route small {
  margin-top: 4px;
  color: var(--muted);
  line-height: 1.4;
}

.module-empty {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 14px;
  padding: 14px;
  border: 1px dashed var(--line);
  border-radius: 8px;
  background: var(--panel-sub);
  color: var(--muted);
}

.focus-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) minmax(260px, 0.9fr);
  gap: 14px;
  margin-top: 16px;
}

.focus-block {
  padding: 14px;
  border: 1px solid var(--line-soft);
  border-radius: 8px;
  background: var(--panel-sub);
}

.block-title {
  color: var(--text);
  font-weight: 700;
  margin-bottom: 12px;
}

.concern-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.concern-list span {
  padding: 6px 10px;
  border: 1px solid var(--primary-tint-border);
  border-radius: 6px;
  background: var(--primary-tint);
  color: var(--primary);
  font-size: var(--font-sm);
  line-height: 1.4;
}

.plain-list,
.rule-card ul {
  margin: 0;
  padding-left: 18px;
}

.plain-list li,
.rule-card li {
  margin: 7px 0;
  color: var(--text-soft);
  line-height: 1.55;
}

.route-block {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.route-link {
  display: flex;
  width: 100%;
  min-height: 58px;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 12px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--panel);
  color: var(--text);
  cursor: pointer;
  text-align: left;
}

.route-link:hover {
  border-color: var(--primary);
  color: var(--primary);
}

.route-empty {
  margin: 0;
  color: var(--muted);
  font-size: var(--font-md);
}

.route-link strong,
.route-link small {
  display: block;
}

.route-link small {
  margin-top: 4px;
  color: var(--muted);
  line-height: 1.4;
}

.rule-tabs {
  padding: 6px 16px 18px;
}

.tab-label {
  font-weight: 650;
}

.section-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}

.rule-card {
  min-height: 188px;
  padding: 16px;
  border: 1px solid var(--line-soft);
  border-radius: 8px;
  background: var(--panel);
}

.rule-card h4 {
  margin: 0 0 8px;
  color: var(--text);
  font-size: var(--font-16);
}

.rule-card ul {
  margin-top: 12px;
}

.source-table-wrap {
  overflow: hidden;
  border-radius: 8px;
}

.doc-title {
  display: block;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--primary);
  font: inherit;
  font-weight: 700;
  text-align: left;
  cursor: pointer;
}

.doc-title:hover {
  text-decoration: underline;
}

.doc-title + small {
  display: block;
  margin-top: 4px;
  color: var(--muted);
}

.local-path {
  display: block;
  max-width: 100%;
  overflow: hidden;
  color: var(--muted);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.reference-strip {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 14px 16px;
}

.reference-strip div {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}

.reference-strip strong {
  color: var(--text);
}

.reference-strip span {
  padding: 5px 8px;
  border-radius: 6px;
  background: var(--surface-hover);
  color: var(--muted);
  font-size: var(--font-sm);
}

@media (max-width: 1180px) {
  .rule-hero,
  .module-grid,
  .focus-grid,
  .section-grid {
    grid-template-columns: 1fr;
  }

  .hero-metrics {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}

@media (max-width: 768px) {
  .region-rules {
    padding: 10px;
  }

  .rule-hero,
  .focus-panel {
    padding: 14px;
  }

  .rule-hero-main h2 {
    font-size: var(--font-22);
  }

  .hero-metrics {
    grid-template-columns: 1fr;
  }

  .focus-heading,
  .reference-strip {
    flex-direction: column;
    align-items: flex-start;
  }
}
</style>
