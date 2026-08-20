<script setup lang="ts">
// ⚠ 已合并（本组件不再被路由引用，保留备查便于回滚）：
// 云南交易工作台 /xhjy/yunnan 已并入「现货交易驾驶舱」/dashboard（现货交易分组首位）。
// 身份区域 hero + 分组 tab + 7 个真实数据 panel 的全部实现已迁入 src/views/TradingCockpitView.vue。
// 原 /xhjy/yunnan 及其 11 个 alias 子路径在 src/features/yunnanTrading/routes.ts 中改为
// redirect 到 /dashboard（带 ?tab= 预选），深链/收藏夹/历史记录不 404。
// 回滚方式：恢复 routes.ts 的 component 引用 + navigation.ts 菜单项 + TradingCockpitView.vue 即可。
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { BadgeCheck, CalendarClock, Landmark, ShieldAlert } from 'lucide-vue-next'
import RegionScopedNotice from '@/components/region/RegionScopedNotice.vue'
import YunnanSpotPnLPanel from './panels/YunnanSpotPnLPanel.vue'
import YunnanSpotCockpitPanel from './panels/YunnanSpotCockpitPanel.vue'
import YunnanElasticityPanel from '@/features/regions/yunnan/panels/ElasticityPanel.vue'
import YunnanSpreadPanel from '@/features/regions/yunnan/panels/SpreadPanel.vue'
import YunnanDisclosurePanel from './panels/YunnanDisclosurePanel.vue'
import YunnanPlantOutputPanel from './panels/YunnanPlantOutputPanel.vue'
import YunnanPriceOutputLinkagePanel from './panels/YunnanPriceOutputLinkagePanel.vue'
import { getCurrentUser, type AuthUser } from '@/services/auth'
import { canAccessPath, roleLabels, subjectTypeLabels } from '@/services/governance'
import { currentRegion } from '@/services/region/regionContext'
import { getRuleProfile } from '../../rules'
import {
  getYunnanRuleVerificationSummary,
  yunnanScenarios
} from '@/services/yunnanTrading'

// 工作台 tab 仅保留 7 个真实数据 tab（父 Issue #456 删除规则/角色/经营/策略/申报 copilot 5 个纯文字 tab）。
type TabKey = 'cockpit' | 'spot-pnl' | 'plant-output' | 'price-output-linkage' | 'elasticity' | 'spread' | 'disclosure'

const route = useRoute()
const currentUser = ref<AuthUser>(getCurrentUser())
const yunnanProfile = getRuleProfile('yunnan')
const verification = getYunnanRuleVerificationSummary()

const selectedScenarioId = ref(yunnanScenarios[0].id)
const selectedScenario = computed(() => yunnanScenarios.find((item) => item.id === selectedScenarioId.value) ?? yunnanScenarios[0])

const isYunnanRegion = computed(() => currentRegion.value.id === 'yunnan')
const roleLabel = computed(() => roleLabels[currentUser.value.roleCode])
const subjectLabel = computed(() => subjectTypeLabels[currentUser.value.subjectType])

// tab 级权限分流：每个真实数据 tab 按自身权限路径门控（PLANT/STORAGE 等窄权限角色见 ensureTabAllowed 回退）。
const canViewSpotPnL = computed(() => canAccessPath('/xhjy/yunnan/spot-pnl', currentUser.value))
const canViewElasticity = computed(() => canAccessPath('/xhjy/yunnan/elasticity', currentUser.value))
const canViewSpread = computed(() => canAccessPath('/xhjy/yunnan/spread', currentUser.value))
const canViewCockpit = computed(() => canAccessPath('/xhjy/yunnan/cockpit', currentUser.value))
const canViewDisclosure = computed(() => canAccessPath('/xhjy/yunnan/disclosure', currentUser.value))
const canViewPlantOutput = computed(() => canAccessPath('/xhjy/yunnan/plant-output', currentUser.value))
const canViewPriceOutputLinkage = computed(() => canAccessPath('/xhjy/yunnan/price-output-linkage', currentUser.value))

type TabItem = { key: TabKey; label: string }
type TabGroup = { group: string; items: TabItem[] }

// 两组体系化（决策总览 / 现货分析），每项按自身路径门控过滤；空组不渲染。tab key 不变，深链/门控沿用。
const tabGroups = computed<TabGroup[]>(() => {
  const overview: TabItem[] = []
  if (canViewCockpit.value) overview.push({ key: 'cockpit', label: '现货驾驶舱' })

  const spotAnalysis: TabItem[] = []
  if (canViewElasticity.value) spotAnalysis.push({ key: 'elasticity', label: '价格弹性' })
  if (canViewSpread.value) spotAnalysis.push({ key: 'spread', label: '日前-实时价差' })
  if (canViewSpotPnL.value) spotAnalysis.push({ key: 'spot-pnl', label: '损益归因' })
  if (canViewPlantOutput.value) spotAnalysis.push({ key: 'plant-output', label: '电厂出力' })
  if (canViewPriceOutputLinkage.value) spotAnalysis.push({ key: 'price-output-linkage', label: '电价×出力' })
  // 披露明细按自身权限路径门控（/xhjy/yunnan/disclosure 已在 regionModules 注册；
  // node-price 已拆独立市场洞察页不再是本工作台 tab）
  if (canViewDisclosure.value) spotAnalysis.push({ key: 'disclosure', label: '披露明细' })

  return [
    { group: '决策总览', items: overview },
    { group: '现货分析', items: spotAnalysis }
  ].filter((g) => g.items.length > 0)
})

// 扁平 tab 列表（门控/深链/默认 tab 选择沿用）。
const tabs = computed<TabItem[]>(() => tabGroups.value.flatMap((g) => g.items))

function tabFromPath(path: string): TabKey {
  if (path.endsWith('/cockpit')) return 'cockpit'
  if (path.endsWith('/spot-pnl')) return 'spot-pnl'
  if (path.endsWith('/elasticity')) return 'elasticity'
  if (path.endsWith('/spread')) return 'spread'
  if (path.endsWith('/plant-output')) return 'plant-output'
  if (path.endsWith('/price-output-linkage')) return 'price-output-linkage'
  if (path.endsWith('/disclosure')) return 'disclosure'
  // 旧文字 tab 子路径（rules/role/retail/settlement/quant/declaration）已删，统一落驾驶舱。
  return 'cockpit'
}

const activeTab = ref<TabKey>('cockpit')

function ensureTabAllowed() {
  if (!tabs.value.some((tab) => tab.key === activeTab.value)) {
    // 当前角色无默认 tab 权限时，回退到首个可用 tab（全无则驾驶舱兜底，由模板空态处理）。
    activeTab.value = tabs.value[0]?.key ?? 'cockpit'
  }
}

function onGovernanceUserChanged(event: Event) {
  currentUser.value = (event as CustomEvent<AuthUser>).detail ?? getCurrentUser()
  ensureTabAllowed()
}

function goTab(key: TabKey) {
  if (tabs.value.some((tab) => tab.key === key)) activeTab.value = key
}

// 旧子路径以 alias 解析到同一页面，按落地路径预选 tab。
// 组件实例在 alias 之间会被复用（onMounted 不再触发），故监听 route.path
// 同步 tab，保证从推荐入口/浏览器历史等深链跳转后仍切到目标 tab。
watch(() => route.path, (path) => {
  activeTab.value = tabFromPath(path)
  ensureTabAllowed()
}, { immediate: true })

onMounted(() => {
  window.addEventListener('governance-user-changed', onGovernanceUserChanged)
})

onUnmounted(() => {
  window.removeEventListener('governance-user-changed', onGovernanceUserChanged)
})
</script>

<template>
  <div class="yunnan-workbench">
    <RegionScopedNotice
      v-if="!isYunnanRegion"
      module-title="云南交易工作台"
      expected-region-label="云南"
      :current-region-label="currentRegion.name"
    />

    <template v-else>
      <section class="workbench-hero">
        <div class="hero-main">
          <div class="section-kicker">
            <Landmark :size="16" />
            <span>云南 · 南方电网 · {{ roleLabel }}</span>
          </div>
          <h2>云南交易工作台</h2>
          <p>云南现货交易专区：聚合现货驾驶舱、价格弹性、日前-实时价差、损益归因、电厂出力、电价×出力与披露明细等真实数据，在一个入口完成云南交易复盘与数据分析。</p>
          <div class="hero-tags">
            <el-tag type="success">{{ yunnanProfile.marketStage }}</el-tag>
            <el-tag type="primary">{{ subjectLabel }}</el-tag>
            <el-tag type="info">{{ currentUser.subjectName }}</el-tag>
          </div>
        </div>

        <div class="hero-side">
          <label class="scenario-picker">
            <span><CalendarClock :size="14" /> 规则场景 / 月份</span>
            <el-select v-model="selectedScenarioId">
              <el-option
                v-for="scenario in yunnanScenarios"
                :key="scenario.id"
                :label="`${scenario.month} · ${scenario.name}`"
                :value="scenario.id"
              />
            </el-select>
            <small>{{ selectedScenario.ruleVersion }}</small>
          </label>
          <div class="verify-chips">
            <span class="ok"><BadgeCheck :size="14" /> 已核验 {{ verification.verified }}</span>
            <span class="warn"><ShieldAlert :size="14" /> 待核验 {{ verification.pending }}</span>
            <span class="frozen">不固化 {{ verification.frozen }}</span>
          </div>
        </div>
      </section>

      <nav class="tab-bar">
        <div v-for="group in tabGroups" :key="group.group" class="tab-group">
          <span class="tab-group-label">{{ group.group }}</span>
          <div class="tab-group-items">
            <button
              v-for="tab in group.items"
              :key="tab.key"
              type="button"
              class="tab-button"
              :class="{ active: activeTab === tab.key }"
              @click="goTab(tab.key)"
            >
              {{ tab.label }}
            </button>
          </div>
        </div>
      </nav>

      <YunnanSpotCockpitPanel v-if="activeTab === 'cockpit'" />
      <YunnanElasticityPanel v-else-if="activeTab === 'elasticity'" />
      <YunnanSpreadPanel v-else-if="activeTab === 'spread'" />
      <YunnanSpotPnLPanel v-else-if="activeTab === 'spot-pnl'" />
      <YunnanPlantOutputPanel v-else-if="activeTab === 'plant-output'" />
      <YunnanPriceOutputLinkagePanel v-else-if="activeTab === 'price-output-linkage'" />
      <YunnanDisclosurePanel v-else-if="activeTab === 'disclosure'" />
    </template>
  </div>
</template>

<style scoped>
.yunnan-workbench {
  min-height: calc(100vh - 112px);
  padding: 14px 16px 28px;
  background: var(--bg);
  color: var(--text);
}

.workbench-hero {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 380px;
  gap: 16px;
  padding: 20px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: linear-gradient(135deg, var(--panel) 0%, var(--panel-sub, var(--panel)) 100%);
}

.section-kicker {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--primary);
  font-size: var(--font-md);
  font-weight: 650;
}

.hero-main h2 {
  margin: 7px 0 8px;
  color: var(--text);
  font-size: var(--font-28);
  font-weight: 760;
}

.hero-main p {
  margin: 0;
  color: var(--muted);
  line-height: 1.7;
}

.hero-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 14px;
}

.hero-side {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.scenario-picker {
  display: flex;
  flex-direction: column;
  gap: 7px;
  padding: 12px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--panel);
}

.scenario-picker span {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--text-body);
  font-size: var(--font-md);
  font-weight: 650;
}

.scenario-picker small {
  color: var(--muted);
  line-height: 1.5;
}

.verify-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.verify-chips span {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 6px 10px;
  border-radius: 6px;
  font-size: var(--font-sm);
  font-weight: 600;
}

.verify-chips .ok {
  background: var(--primary-tint);
  color: var(--primary);
}

.verify-chips .warn {
  background: var(--warning-tint);
  color: var(--warning);
}

.verify-chips .frozen {
  background: var(--el-fill-color-light);
  color: var(--muted);
}

.tab-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  gap: 10px 18px;
  margin: 14px 0;
}

.tab-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding-right: 18px;
  border-right: 1px solid var(--line);
}

.tab-group:last-child {
  padding-right: 0;
  border-right: none;
}

.tab-group-label {
  font-size: var(--font-xs);
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--muted);
}

.tab-group-items {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.tab-button {
  padding: 9px 18px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--panel);
  color: var(--text-body);
  font-size: var(--font-lg);
  font-weight: 650;
  cursor: pointer;
}

.tab-button:hover {
  border-color: var(--primary);
  color: var(--primary);
}

.tab-button.active {
  border-color: var(--primary);
  background: var(--primary);
  color: #fff;
}

@media (max-width: 1180px) {
  .workbench-hero {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 720px) {
  .yunnan-workbench {
    padding: 10px;
  }

  .hero-main h2 {
    font-size: var(--font-22);
  }
}
</style>
