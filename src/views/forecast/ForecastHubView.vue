<script setup lang="ts">
// 预测中心整合页（P3：8 页 → 1 页多 tab）。
// - tab 内容与独立路由页共用同一组件与 cfg（src/data/forecastHubTabs.ts 单一来源）
// - tab 按 canAccessPath(原路由) 过滤：不扩大任何角色原有可见范围
// - 懒挂载：tab 首次激活才挂组件（9 套数据不同时加载）；已访问的保持挂载避免重复拉数
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import ForecastMultiTypeCurve from './ForecastMultiTypeCurve.vue'
import ForecastDailyCurve from './ForecastDailyCurve.vue'
import RollingPricePredictionView from '../RollingPricePredictionView.vue'
import CompanyWeatherPredictionView from '../CompanyWeatherPredictionView.vue'
import RenewableABCurve from './RenewableABCurve.vue'
import YnDisclosureCurve from '@/components/forecast/YnDisclosureCurve.vue'
import CapabilityDegradedCard from '@/components/CapabilityDegradedCard.vue'
import { FORECAST_HUB_TABS } from '@/data/forecastHubTabs'
import { canAccessPath } from '@/services/governance'
import { getCurrentUser } from '@/services/auth'
import { currentRegion } from '@/services/region/regionContext'
import {
  getRegionSubCapability,
  getRegionCapabilityForPath,
  type RegionCapabilityDataSupport,
  type RegionModuleCapabilityStatus,
} from '@/services/region/regionModules'
import TrustBadge from '@/components/common/TrustBadge.vue'
import type { DataSourceBasis } from '@/services/data/types'

const route = useRoute()
const router = useRouter()
const user = getCurrentUser()
const roleTabs = computed(() => FORECAST_HUB_TABS.filter((tab) => canAccessPath(tab.sourceRoute, user)))

type TabCapabilityState = {
  status: RegionModuleCapabilityStatus
  note: string
  supports: RegionCapabilityDataSupport[]
}

const tabCapabilityByKey = computed<Record<string, TabCapabilityState>>(() => {
  const regionId = currentRegion.value.id
  return Object.fromEntries(roleTabs.value.map((tab) => {
    const capabilityId = tab.capabilityId ?? `forecast.tab.${tab.key}`
    const capability = getRegionSubCapability('forecast', capabilityId, regionId)
    return [tab.key, {
      status: capability?.status ?? 'available',
      note: capability?.capability.note ?? '',
      supports: capability?.capability.dataSupportByRegion?.[regionId] ?? []
    }]
  }))
})

const tabs = computed(() =>
  roleTabs.value.filter((tab) => tabCapabilityByKey.value[tab.key]?.status !== 'hidden'))

function tabCapability(tabKey: string): TabCapabilityState {
  return tabCapabilityByKey.value[tabKey] ?? { status: 'available', note: '', supports: [] }
}

function isTabDegraded(tabKey: string): boolean {
  // not-configured=该地区未登记该子能力（fail-closed，ADR 裁决四）：与 degraded 同样只显示说明，
  // 保持「暂未开通」可见诚实态而非整体隐藏（隐藏会让试点地区 hub 变空白页）。
  const status = tabCapability(tabKey).status
  return status === 'degraded' || status === 'not-configured'
}

// 旧价格回放/厂站负荷与新模型标的不同，保留旧门控；入口沿用工作台自身权限与地区能力。
const canOpenOnlineWorkbench = computed(() => currentRegion.value.id === 'yunnan'
  && canAccessPath('/ycsj/workbench', user)
  && getRegionCapabilityForPath('/ycsj/workbench', currentRegion.value.id)?.status === 'available')

function onlineTargets(tabKey: string) {
  if (!canOpenOnlineWorkbench.value) return []
  if (tabKey === 'jgyc') return [
    { target: 'price_user_da_settlement', label: '用户侧日前结算价预测' },
    { target: 'price_user_rt_settlement', label: '用户侧实时结算价预测' },
  ]
  if (tabKey === 'gsfhyc') return [{ target: 'load', label: '云南区域负荷预测（非厂站）' }]
  return []
}

function openOnlineWorkbench(tabKey: string, target: string) {
  if (!onlineTargets(tabKey).some((item) => item.target === target)) return
  void router.replace({ path: '/ycsj/center', query: { ...route.query, mod: 'bench', target } })
}

// 决策口径（trustGate）：本 hub 为预测回放（路由 meta.kind='forecast'），预测值非结算事实，
// 决策口径恒为 advisory_only，以 illustrative basis 显式标注「仅决策支持·非结算依据」。
const decisionBasis = computed<DataSourceBasis>(() => (route.meta?.kind === 'forecast' ? 'illustrative' : 'captured'))

// 数据源与口径总览：把可见预测服务按「绑定维度」分组，让用户一眼看清都有什么、各自绑定什么。
// 厂站预测绑定 {地区·公司·厂站}(可切换厂站，当前模拟数据)；公共预测绑定地区(各省市场数据不同)。
const activeDataTabs = computed(() => tabs.value.filter((t) => tabCapability(t.key).status === 'available'))
const stationTabs = computed(() => activeDataTabs.value.filter((t) => t.cfg?.stationScoped))
const publicTabs = computed(() => activeDataTabs.value.filter((t) => !t.cfg?.stationScoped))
const hasDisclosureTab = computed(() => activeDataTabs.value.some((t) => t.kind === 'yn-disclosure'))

// 新能源出力预测合并 tab 的 A/B 源预选（随 ?tab=zxztqa|zgnrx 深链）。
const renewableSource = ref<'zxztqa' | 'zgnrx'>('zxztqa')

// ?tab= 深链：tabs 已按 canAccessPath 过滤（无权限的 tab 不可激活）。
// 命中某 tab key 则激活；A/B 旧深链(tab=zxztqa|zgnrx) 映射到合并 tab(renewable-ab) 并预选对应模型；
// 不匹配 / 无权限则回退首个可见 tab。
function resolveInitialTab(): string {
  const q = typeof route.query.tab === 'string' ? route.query.tab : ''
  if (!q) return tabs.value[0]?.key ?? ''
  if (q === 'zxztqa' || q === 'zgnrx') {
    const merged = tabs.value.find((t) => t.key === 'renewable-ab')
    if (merged) { renewableSource.value = q; return merged.key }
    return tabs.value[0]?.key ?? ''
  }
  const hit = tabs.value.find((t) => t.key === q)
  return hit ? hit.key : (tabs.value[0]?.key ?? '')
}

const active = ref('')
const visited = ref(new Set<string>())

function onTabChange(key: string | number) {
  visited.value.add(String(key))
}

watch([tabs, () => route.query.tab, () => currentRegion.value.id], () => {
  const next = resolveInitialTab()
  active.value = next
  visited.value = new Set(next ? [next] : [])
}, { immediate: true })
</script>

<template>
  <div class="page-stack">
    <section class="panel">
      <div class="panel-title">
        <h2>预测数据回放 <TrustBadge :basis="decisionBasis" prefix="决策口径" /></h2>
        <span>8 个预测视图整合为单页多 tab（原独立页面已收口为深链跳转，?tab= 可直达）；tab 按角色权限与地区能力过滤</span>
      </div>
      <div v-if="tabs.length" class="source-legend">
        <div v-if="stationTabs.length" class="legend-row">
          <el-tag size="small" type="success" effect="plain" round>厂站预测</el-tag>
          <span class="legend-desc">绑定 <strong>地区 · 公司 · 厂站</strong>，可在页内切换本公司厂站（遵循账号权限）；当前为按厂站画像生成的模拟数据：</span>
          <span class="legend-items">{{ stationTabs.map((t) => t.title).join('、') }}</span>
        </div>
        <div v-if="hasDisclosureTab" class="legend-row">
          <el-tag size="small" type="warning" effect="plain" round>官方披露</el-tag>
          <span class="legend-desc">「云南披露对照」为<strong>南网官方 D-1 预测 vs 实际</strong>（真实采集 captured，非本系统模型输出）：</span>
          <span class="legend-items">度量官方预测准确度，数值仍非结算依据</span>
        </div>
        <div v-if="publicTabs.length" class="legend-row">
          <el-tag size="small" type="info" effect="plain" round>公共预测</el-tag>
          <span class="legend-desc">绑定<strong>当前地区</strong>，各省市场/气象数据不同（随顶栏地区切换）：</span>
          <span class="legend-items">{{ publicTabs.map((t) => t.title).join('、') }}</span>
        </div>
      </div>
      <el-empty v-if="!tabs.length" description="当前角色或地区没有可见的预测视图" />
      <el-tabs v-else v-model="active" @tab-change="onTabChange">
        <el-tab-pane v-for="tab in tabs" :key="tab.key" :label="tab.title" :name="tab.key">
          <template v-if="visited.has(tab.key) || active === tab.key">
            <div v-if="isTabDegraded(tab.key)">
              <CapabilityDegradedCard
                :title="`${tab.title}暂不可用`"
                :region-name="currentRegion.name"
                :note="tabCapability(tab.key).note"
                :supports="tabCapability(tab.key).supports"
              />
              <div v-if="onlineTargets(tab.key).length" class="online-entry">
                <p>上方说明针对旧回放或厂站数据。下方进入独立的模型预测目标，保留当前日期；模型是否可计算仍以真实输入与服务返回为准。</p>
                <el-button v-for="item in onlineTargets(tab.key)" :key="item.target" type="primary"
                  @click="openOnlineWorkbench(tab.key, item.target)">{{ item.label }}</el-button>
              </div>
            </div>
            <RenewableABCurve v-else-if="tab.kind === 'renewable-ab'" :source="renewableSource" />
            <YnDisclosureCurve v-else-if="tab.kind === 'yn-disclosure'" />
            <ForecastMultiTypeCurve
              v-else-if="tab.kind === 'multi'"
              :cfg="tab.cfg"
            />
            <ForecastDailyCurve
              v-else-if="tab.kind === 'daily'"
              :cfg="tab.cfg"
            />
            <RollingPricePredictionView v-else-if="tab.kind === 'rolling'" />
            <CompanyWeatherPredictionView v-else />
          </template>
        </el-tab-pane>
      </el-tabs>
    </section>
  </div>
</template>

<style scoped>
.online-entry { margin-top: 12px; font-size: var(--font-sm); color: var(--el-text-color-regular); }
:deep(.el-tabs__content) {
  overflow: visible;
}
.source-legend {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 8px 0 4px;
  padding: 10px 12px;
  border: 1px solid var(--line-faint);
  border-radius: 6px;
  background: var(--panel-sub);
}
.legend-row {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 6px;
  font-size: var(--font-sm);
  color: var(--el-text-color-regular);
  line-height: 1.5;
}
.legend-row strong { color: var(--text); font-weight: 700; }
.legend-items { color: var(--el-text-color-secondary); }
</style>
