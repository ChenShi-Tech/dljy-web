<script setup lang="ts">
// 中长期与现货套保工作台外壳（openspec build-midlong-spot-hedging 任务 8.1—8.5、8.7，HW-01..10；
// ChenShi-Tech/dljy#3420 拆分为外壳 + tabs/ 页签组件）。
//
// 外壳只管四件事：地区门禁（只开放云南，D15/HW-07：其他地区统一显示「该地区未开放」、不挂任何页签、不发任何请求）、
// 页头（认知时点横幅 HW-05、粒度与认知时点控制；公司取全局公司上下文）、页签导航、按当前页签渲染对应组件。
// 共享状态（作用域键、按作用域的请求会话、认知时点、是否可写）由 useHedgeWorkbench() 创建并 provide 给页签，
// 切换公司/地区/时点丢弃迟到响应（HW-06，查询代次）。各页签自己负责加载与状态；KeepAlive 保活已打开的页签，
// 切走再切回不丢试算输入与维护编辑。维护（HW-10）是第五个页签。
import { computed } from 'vue'
import type { Component } from 'vue'
import { currentRegion } from '@/services/region/regionContext'
import { useHedgeWorkbench } from './useHedgeWorkbench'
import type { HedgeTabKey } from './useHedgeWorkbench'
import HedgeTodayTab from './tabs/HedgeTodayTab.vue'
import HedgeMonthsTab from './tabs/HedgeMonthsTab.vue'
import HedgeSettlementTab from './tabs/HedgeSettlementTab.vue'
import HedgeSimulateTab from './tabs/HedgeSimulateTab.vue'
import HedgeMaintenanceTab from './tabs/HedgeMaintenanceTab.vue'

const { regionOpen, activeTab, granularity, asOfInput, showAsOfBanner, clearAsOf } = useHedgeWorkbench()

const TABS: ReadonlyArray<{ key: HedgeTabKey; label: string; component: Component }> = [
  { key: 'today2', label: '今明两日', component: HedgeTodayTab },
  { key: 'month', label: '当月/后续', component: HedgeMonthsTab },
  { key: 'settlement', label: '结算复核', component: HedgeSettlementTab },
  { key: 'simulate', label: '补仓试算', component: HedgeSimulateTab },
  { key: 'maintenance', label: '维护', component: HedgeMaintenanceTab },
]

const activeTabComponent = computed(() => TABS.find((item) => item.key === activeTab.value)?.component ?? HedgeTodayTab)
</script>

<template>
  <div class="hedge-workbench">
    <div v-if="!regionOpen" class="region-closed" data-test="region-closed">
      该地区未开放
      <p>中长期与现货套保当前仅对云南开放；当前地区 {{ currentRegion.id || '(未选择)' }} 不发任何数据请求。</p>
    </div>
    <template v-else>
      <div v-if="showAsOfBanner" class="asof-banner" data-test="asof-banner">
        历史视角：认知时点 {{ asOfInput }}
        <button data-test="asof-clear" @click="clearAsOf">回到当前视图</button>
      </div>
      <header class="page-head">
        <h2>中长期与现货套保</h2>
        <nav class="tabs" data-test="tabs">
          <button
            v-for="item in TABS"
            :key="item.key"
            :class="{ active: activeTab === item.key }"
            :data-test="`tab-${item.key}`"
            @click="activeTab = item.key"
          >{{ item.label }}</button>
        </nav>
        <label>粒度
          <select v-model="granularity" data-test="granularity">
            <option value="HOUR">小时</option>
            <option value="DAY">日</option>
          </select>
        </label>
        <label>认知时点
          <input v-model="asOfInput" data-test="asof-input" placeholder="留空 = 当前视图" />
        </label>
      </header>

      <KeepAlive>
        <component :is="activeTabComponent" />
      </KeepAlive>
    </template>
  </div>
</template>

<style scoped>
.hedge-workbench { padding: 16px; }
.region-closed { padding: 48px; text-align: center; font-size: var(--font-lg, 18px); }
.asof-banner { background: #fff7e6; padding: 8px 12px; border: 1px solid #f0c36d; margin-bottom: 8px; }
</style>
