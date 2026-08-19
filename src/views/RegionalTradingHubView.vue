<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import {
  ArrowRight,
  BookOpen,
  Calculator,
  Construction,
  Landmark,
  Layers,
  LineChart,
  Network,
  ShieldCheck
} from 'lucide-vue-next'
import { getRegionById, getRegionCoverageSummary, getRegionStatusLabel, provinceRegionProfiles, type RegionProfile } from '../data/regions'
import { getCurrentUser, type AuthUser } from '@/services/auth'
import { canAccessPath, isPathAvailableInRegion, roleLabels } from '@/services/governance'
import { currentRegion, setCurrentRegionId } from '@/services/region/regionContext'
import { getRegionBusinessModules } from '@/services/region/regionModules'
import { getRuleProfile, getSubjectRuleFocus, type RuleSection } from '../rules'
import { getRegionSpotProfile } from '../data/regionSpotProfiles'
import { onRegionChange } from '../composables/useRegionReload'
import RegionDataBanner from '@/components/region/RegionDataBanner.vue'
import MarketMechanismStrip from '../components/region/MarketMechanismStrip.vue'
import PriceBehaviorPanel from '../components/region/PriceBehaviorPanel.vue'
import GenerationMixPanel from '../components/region/GenerationMixPanel.vue'

type TemplateCard = {
  title: string
  summary: string
  items: string[]
}

const router = useRouter()
const currentUser = ref<AuthUser>(getCurrentUser())

const priorityRegionIds = [
  'yunnan',
  'shanxi',
  'shaanxi',
  'xinjiang',
  'guangdong',
  'guizhou',
  'guangxi',
  'hainan',
  'shandong',
  'inner-mongolia'
]
const regionalizedBacklog: TemplateCard[] = [
  {
    title: '现货交易',
    summary: '日前申报、实时偏差和交易策略建议要按地区出清规则拆分。',
    items: ['申报时序', '96点/24点粒度', '节点价或统一价口径']
  },
  {
    title: '售电经营',
    summary: '零售套餐、客户负荷、分时电价和偏差传导必须按地区规则适配。',
    items: ['套餐模型', '客户曲线', '偏差费用', '毛利测算']
  },
  {
    title: '结算风控',
    summary: '中长期、日前、实时、分摊返还、不平衡资金和熔断机制要逐省沉淀。',
    items: ['结算科目', '风险限额', '规则效力', '异常处置']
  },
  {
    title: '预测数据',
    summary: '负荷、新能源、电价和气象特征需要按地区数据源和市场标签拆分。',
    items: ['价格标签', '区域负荷', '新能源出力', '气象特征']
  }
]

// 南网/国网通用底座降为页内切换（原来是独立路由）。
const baseTab = ref<'current' | 'southern-grid' | 'state-grid'>('current')
const mode = computed(() => baseTab.value)
const spot = computed(() => getRegionSpotProfile(currentRegion.value.id))
const displayRegion = computed<RegionProfile>(() => {
  if (mode.value === 'southern-grid') return getRegionById('generic-csg')
  if (mode.value === 'state-grid') return getRegionById('generic-sgcc')
  return currentRegion.value
})
const profile = computed(() => getRuleProfile(displayRegion.value.id))
const focus = computed(() => getSubjectRuleFocus(displayRegion.value.id, currentUser.value))
const businessModules = computed(() => mode.value === 'current' ? getRegionBusinessModules(currentRegion.value.id) : [])
const visibleModuleCards = computed(() => {
  const regionId = currentRegion.value.id
  return businessModules.value.map((module) => ({
    ...module,
    visibleRoutes: module.entryRoutes.filter((entry) => {
      return isPathAvailableInRegion(entry.path, regionId) && canAccessPath(entry.path, currentUser.value)
    })
  }))
})
const isCurrentProvinceWithoutModule = computed(() => {
  return mode.value === 'current' && displayRegion.value.kind === 'province' && !businessModules.value.length
})
const pageTitle = computed(() => {
  if (mode.value === 'southern-grid') return '南网通用交易'
  if (mode.value === 'state-grid') return '国网通用交易'
  return `${displayRegion.value.shortName}交易`
})
const pageSummary = computed(() => {
  if (mode.value === 'southern-grid') {
    return '南方区域通用交易底座，承接南网经营区的联合出清、省内结算和跨省衔接。'
  }
  if (mode.value === 'state-grid') {
    return '国网经营区通用交易底座，用于承接后续国网省份的中长期、现货、结算和售电差异化配置。'
  }
  if (businessModules.value.length) {
    return `${displayRegion.value.name}已接入专属交易模块，侧边栏和入口按当前地区及当前身份过滤。`
  }
  return `${displayRegion.value.name}专属交易模块建设中，当前只展示规则框架、通用交易底座和后续地区化改造清单。`
})
const statusLabel = computed(() => getRegionStatusLabel(displayRegion.value.ruleSet.spotRuleStatus))
const templateSections = computed<RuleSection[]>(() => [
  profile.value.marketArchitecture,
  ...profile.value.tradingProducts,
  ...profile.value.pricingModel,
  ...profile.value.settlementModel
])
const genericReferenceId = computed(() => {
  return displayRegion.value.gridOperator === 'china-southern-grid' ? 'generic-csg' : 'generic-sgcc'
})
const genericReferenceLabel = computed(() => genericReferenceId.value === 'generic-csg' ? '南网通用版' : '国网通用版')
const roleLabel = computed(() => roleLabels[currentUser.value.roleCode])
const coverageSummary = computed(() => getRegionCoverageSummary())
const priorityRegionRows = computed(() => priorityRegionIds
  .map((id) => provinceRegionProfiles.find((region) => region.id === id))
  .filter((region): region is RegionProfile => Boolean(region))
)

function onGovernanceUserChanged(event: Event) {
  currentUser.value = (event as CustomEvent<AuthUser>).detail ?? getCurrentUser()
}

function goRoute(path: string) {
  router.push(path)
}

function switchToGeneric(regionId: 'generic-csg' | 'generic-sgcc') {
  baseTab.value = regionId === 'generic-csg' ? 'southern-grid' : 'state-grid'
}

function switchToRegion(regionId: string) {
  setCurrentRegionId(regionId)
  baseTab.value = 'current'
}

// 切换地区时回到“当前地区”视图。
onRegionChange(() => {
  baseTab.value = 'current'
})

onMounted(() => {
  window.addEventListener('governance-user-changed', onGovernanceUserChanged)
})

onUnmounted(() => {
  window.removeEventListener('governance-user-changed', onGovernanceUserChanged)
})
</script>

<template>
  <div class="regional-trading">
    <RegionDataBanner />
    <section class="trading-hero">
      <div>
        <div class="section-kicker">
          <Landmark :size="16" />
          <span>{{ displayRegion.gridLabel }} · {{ displayRegion.regionGroup }}</span>
        </div>
        <h2>{{ pageTitle }}</h2>
        <p>{{ pageSummary }}</p>
        <div class="hero-tags">
          <el-tag :type="displayRegion.kind === 'template' ? 'primary' : 'success'">
            {{ displayRegion.kind === 'template' ? '通用交易版' : '当前地区' }}
          </el-tag>
          <el-tag type="warning">{{ statusLabel }}</el-tag>
          <el-tag type="info">{{ roleLabel }}</el-tag>
        </div>
      </div>
      <div class="generic-switch">
        <button type="button" :class="{ active: mode === 'current' }" @click="baseTab = 'current'">
          <LineChart :size="18" />
          <span>
            <strong>{{ currentRegion.shortName }}现货档案</strong>
            <small>当前地区量化特征与策略</small>
          </span>
          <ArrowRight :size="16" />
        </button>
        <button type="button" :class="{ active: mode === 'southern-grid' }" @click="baseTab = 'southern-grid'">
          <Network :size="18" />
          <span>
            <strong>南网通用交易</strong>
            <small>区域联合出清 + 省内结算</small>
          </span>
          <ArrowRight :size="16" />
        </button>
        <button type="button" :class="{ active: mode === 'state-grid' }" @click="baseTab = 'state-grid'">
          <Landmark :size="18" />
          <span>
            <strong>国网通用交易</strong>
            <small>省级现货 + 国网经营区模板</small>
          </span>
          <ArrowRight :size="16" />
        </button>
      </div>
    </section>

    <section v-if="mode === 'current'" class="spot-overview">
      <MarketMechanismStrip :profile="spot" />
      <div class="spot-grid">
        <PriceBehaviorPanel :profile="spot" />
        <GenerationMixPanel :profile="spot" />
      </div>
    </section>

    <section v-if="visibleModuleCards.length" class="panel">
      <div class="panel-head">
        <div>
          <div class="section-kicker">
            <Layers :size="16" />
            <span>当前地区专属模块</span>
          </div>
          <h3>{{ displayRegion.shortName }}业务入口</h3>
        </div>
        <el-tag type="success">{{ visibleModuleCards.length }} 个模块</el-tag>
      </div>
      <div class="module-grid">
        <article v-for="module in visibleModuleCards" :key="module.id" class="module-card">
          <strong>{{ module.title }}</strong>
          <p>{{ module.summary }}</p>
          <div class="route-list">
            <button
              v-for="entry in module.visibleRoutes"
              :key="entry.path"
              type="button"
              class="route-button"
              @click="goRoute(entry.path)"
            >
              <span>
                <strong>{{ entry.title }}</strong>
                <small>{{ entry.summary }}</small>
              </span>
              <ArrowRight :size="16" />
            </button>
            <p v-if="!module.visibleRoutes.length" class="empty-note">当前身份暂无该模块入口。</p>
          </div>
        </article>
      </div>
    </section>

    <section v-if="isCurrentProvinceWithoutModule" class="panel construction-panel">
      <div class="panel-head">
        <div>
          <div class="section-kicker">
            <Construction :size="16" />
            <span>建设中</span>
          </div>
          <h3>{{ displayRegion.name }}专属交易模块待定制</h3>
        </div>
        <el-tag type="info">不会复用云南逻辑</el-tag>
      </div>
      <p>
        当前地区先保留规则框架和通用交易入口。后续开发时，应按 {{ displayRegion.shortName }} 正式规则单独配置报价、出清、结算、风险和资料效力，不套用云南售电或结算模型。
      </p>
      <div class="construction-actions">
        <button type="button" @click="switchToGeneric(genericReferenceId)">
          查看{{ genericReferenceLabel }}
          <ArrowRight :size="16" />
        </button>
        <button type="button" @click="goRoute('/sdzl/region-rules')">
          查看地区规则框架
          <ArrowRight :size="16" />
        </button>
      </div>
    </section>

    <section class="panel coverage-panel">
      <div class="panel-head">
        <div>
          <div class="section-kicker">
            <Network :size="16" />
            <span>全国地区覆盖概览</span>
          </div>
          <h3>省区已注册，专属模块逐步定制</h3>
        </div>
        <el-tag type="primary">{{ coverageSummary.coveredRequiredCount }}/{{ coverageSummary.requiredCount }} 省级区划</el-tag>
      </div>
      <div class="coverage-metrics">
        <div>
          <strong>{{ coverageSummary.provinceCount }}</strong>
          <span>省级地区</span>
        </div>
        <div>
          <strong>{{ coverageSummary.customizedCount }}</strong>
          <span>已有规则状态</span>
        </div>
        <div>
          <strong>{{ coverageSummary.southernGridCount }}</strong>
          <span>南网省区</span>
        </div>
        <div>
          <strong>{{ coverageSummary.pendingCount }}</strong>
          <span>待定制</span>
        </div>
      </div>
      <div class="priority-region-grid">
        <button
          v-for="region in priorityRegionRows"
          :key="region.id"
          :class="['priority-region', { active: region.id === currentRegion.id }]"
          type="button"
          @click="switchToRegion(region.id)"
        >
          <span>
            <strong>{{ region.shortName }}</strong>
            <small>{{ region.gridLabel }} · {{ region.regionGroup }}</small>
          </span>
          <el-tag
            size="small"
            :type="region.ruleSet.spotRuleStatus === 'active' ? 'success' : region.ruleSet.spotRuleStatus === 'trial' ? 'warning' : 'info'"
          >
            {{ getRegionStatusLabel(region.ruleSet.spotRuleStatus) }}
          </el-tag>
        </button>
      </div>
    </section>

    <section class="split-grid">
      <article class="panel">
        <div class="panel-head">
          <div>
            <div class="section-kicker">
              <BookOpen :size="16" />
              <span>规则交易底座</span>
            </div>
            <h3>{{ profile.marketArchitecture.title }}</h3>
          </div>
        </div>
        <div class="section-list">
          <article v-for="section in templateSections" :key="section.title">
            <strong>{{ section.title }}</strong>
            <p>{{ section.summary }}</p>
            <div>
              <span v-for="item in section.items.slice(0, 4)" :key="item">{{ item }}</span>
            </div>
          </article>
        </div>
      </article>

      <article class="panel">
        <div class="panel-head">
          <div>
            <div class="section-kicker">
              <ShieldCheck :size="16" />
              <span>当前身份关注</span>
            </div>
            <h3>{{ focus.title }}</h3>
          </div>
        </div>
        <p class="focus-summary">{{ focus.summary }}</p>
        <div class="concern-list">
          <span v-for="item in focus.keyConcerns" :key="item">{{ item }}</span>
        </div>
      </article>
    </section>

    <section class="panel">
      <div class="panel-head">
        <div>
          <div class="section-kicker">
            <Calculator :size="16" />
            <span>地区化推进清单</span>
          </div>
          <h3>有地区差异的模块逐步按地区拆分</h3>
        </div>
        <el-tag type="primary">长期约束</el-tag>
      </div>
      <div class="backlog-grid">
        <article v-for="item in regionalizedBacklog" :key="item.title" class="backlog-card">
          <div>
            <LineChart :size="17" />
            <strong>{{ item.title }}</strong>
          </div>
          <p>{{ item.summary }}</p>
          <span v-for="tag in item.items" :key="tag">{{ tag }}</span>
        </article>
      </div>
    </section>
  </div>
</template>

<style scoped>
.regional-trading {
  min-height: calc(100vh - 112px);
  padding: 14px 16px 28px;
  background: var(--el-fill-color-light);
  color: var(--text);
}

.trading-hero {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 390px;
  gap: 16px;
  padding: 20px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: linear-gradient(135deg, var(--panel) 0%, var(--panel-sub) 56%, var(--panel-sub) 100%);
}

.section-kicker {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--primary);
  font-size: var(--font-md);
  font-weight: 650;
}

.trading-hero h2,
.panel h3 {
  margin: 7px 0 8px;
  color: var(--text);
  letter-spacing: 0;
}

.trading-hero h2 {
  font-size: var(--font-28);
  font-weight: 760;
}

.trading-hero p,
.module-card p,
.construction-panel p,
.section-list p,
.focus-summary,
.backlog-card p {
  margin: 0;
  color: var(--text-soft);
  line-height: 1.7;
}

.hero-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 14px;
}

.generic-switch {
  display: grid;
  gap: 10px;
}

.generic-switch button.active {
  border-color: var(--primary);
  background: var(--primary-tint);
  color: var(--primary);
}

.spot-overview {
  margin-top: 14px;
  display: grid;
  gap: 14px;
}

.spot-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14px;
}

@media (max-width: 1180px) {
  .spot-grid {
    grid-template-columns: 1fr;
  }
}

.generic-switch button,
.route-button,
.construction-actions button {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--panel);
  color: var(--text);
  cursor: pointer;
  text-align: left;
}

.generic-switch button {
  min-height: 86px;
  padding: 14px;
}

.generic-switch button:hover,
.route-button:hover,
.construction-actions button:hover {
  border-color: var(--primary);
  color: var(--primary);
}

.generic-switch strong,
.generic-switch small,
.route-button strong,
.route-button small {
  display: block;
}

.generic-switch small,
.route-button small {
  margin-top: 4px;
  color: var(--muted);
  line-height: 1.4;
}

.panel {
  margin-top: 14px;
  padding: 16px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--panel);
}

.panel-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 14px;
}

.module-grid,
.split-grid,
.backlog-grid {
  display: grid;
  gap: 14px;
  margin-top: 14px;
}

.module-grid,
.split-grid {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.backlog-grid {
  grid-template-columns: repeat(4, minmax(0, 1fr));
}

.coverage-metrics {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
  margin-top: 14px;
}

.coverage-metrics div {
  padding: 12px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--el-fill-color-lighter);
}

.coverage-metrics strong,
.coverage-metrics span {
  display: block;
}

.coverage-metrics strong {
  color: var(--primary);
  font-size: var(--font-24);
}

.coverage-metrics span {
  margin-top: 4px;
  color: var(--muted);
  font-size: var(--font-sm);
}

.priority-region-grid {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 8px;
  margin-top: 12px;
}

.priority-region {
  display: flex;
  min-height: 68px;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 10px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--panel);
  color: var(--text);
  cursor: pointer;
  text-align: left;
}

.priority-region.active {
  border-color: var(--primary);
  background: var(--primary-tint);
}

.priority-region strong,
.priority-region small {
  display: block;
}

.priority-region small {
  margin-top: 4px;
  color: var(--muted);
  line-height: 1.4;
}

.module-card,
.section-list article,
.backlog-card {
  padding: 14px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--el-fill-color-lighter);
}

.module-card > strong,
.section-list strong,
.backlog-card strong {
  color: var(--text);
}

.route-list {
  display: grid;
  gap: 8px;
  margin-top: 12px;
}

.route-button {
  width: 100%;
  min-height: 58px;
  padding: 10px 12px;
}

.empty-note {
  margin: 0;
  color: var(--muted);
  line-height: 1.6;
}

.construction-panel {
  background: var(--el-fill-color-lighter);
}

.construction-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 14px;
}

.construction-actions button {
  min-height: 40px;
  padding: 8px 12px;
}

.section-list {
  display: grid;
  gap: 10px;
  margin-top: 14px;
}

.section-list article div,
.concern-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 10px;
}

.section-list span,
.concern-list span,
.backlog-card span {
  padding: 5px 8px;
  border-radius: 6px;
  background: var(--panel-sub);
  color: var(--text-soft);
  font-size: var(--font-sm);
  line-height: 1.4;
}

.backlog-card div {
  display: flex;
  align-items: center;
  gap: 7px;
  color: var(--primary);
}

.backlog-card p {
  margin: 8px 0 10px;
}

.backlog-card span {
  display: inline-block;
  margin: 0 6px 6px 0;
}

@media (max-width: 1180px) {
  .trading-hero,
  .module-grid,
  .split-grid,
  .backlog-grid,
  .coverage-metrics,
  .priority-region-grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 720px) {
  .regional-trading {
    padding: 10px;
  }

  .trading-hero,
  .panel {
    padding: 14px;
  }

  .trading-hero h2 {
    font-size: var(--font-22);
  }

  .panel-head {
    flex-direction: column;
    align-items: flex-start;
  }
}

@media (max-width: 768px) {
  .trading-hero { grid-template-columns: 1fr; }
  .split-grid { grid-template-columns: 1fr; }
  .backlog-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .coverage-metrics { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
</style>
