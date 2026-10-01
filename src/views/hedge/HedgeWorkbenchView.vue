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
            type="button"
            :aria-pressed="activeTab === item.key"
            @click="activeTab = item.key"
          >{{ item.label }}</button>
        </nav>
        <div class="query-controls">
        <label>粒度
          <select v-model="granularity" data-test="granularity">
            <option value="HOUR">小时</option>
            <option value="DAY">日</option>
          </select>
        </label>
        <label>认知时点
          <input v-model="asOfInput" data-test="asof-input" placeholder="留空 = 当前视图" />
        </label>
        </div>
      </header>

      <KeepAlive>
        <component :is="activeTabComponent" />
      </KeepAlive>
    </template>
  </div>
</template>

<style scoped>
.hedge-workbench { display: grid; gap: 16px; min-width: 0; padding: 16px; color: var(--text); }
.page-head { display: grid; gap: 16px; padding: 20px; background: var(--panel); border: 1px solid var(--line); border-radius: var(--radius); }
.page-head h2 { margin: 0; font-size: 20px; line-height: 1.4; }
.tabs { display: flex; flex-wrap: wrap; gap: 4px; width: fit-content; max-width: 100%; padding: 4px; border: 1px solid var(--line); border-radius: var(--radius); background: var(--panel-sub); }
.hedge-workbench :deep(button) { min-height: 36px; padding: 6px 14px; border: 1px solid var(--line); border-radius: var(--radius-sm); background: var(--panel); color: var(--text); font: inherit; font-size: var(--font-sm, 14px); cursor: pointer; }
.hedge-workbench :deep(button:hover:not(:disabled)) { border-color: var(--primary); background: var(--surface-hover); }
.hedge-workbench :deep(button:disabled) { opacity: .55; cursor: not-allowed; }
.tabs button { border-color: transparent; background: transparent; white-space: nowrap; }
.tabs button.active { border-color: var(--primary-tint-border); background: var(--primary-tint); color: var(--primary); font-weight: 600; }
.query-controls { display: flex; flex-wrap: wrap; align-items: end; gap: 12px 20px; }
.query-controls label { display: grid; gap: 6px; font-size: var(--font-sm, 14px); color: var(--muted); }
.hedge-workbench :deep(input:not([type='radio']):not([type='checkbox'])), .hedge-workbench :deep(select) { min-height: 36px; box-sizing: border-box; max-width: 100%; padding: 6px 10px; border: 1px solid var(--line); border-radius: var(--radius-sm); background: var(--panel); color: var(--text); font: inherit; font-size: var(--font-sm, 14px); }
.query-controls input { width: 280px; }
.hedge-workbench :deep(button:focus-visible), .hedge-workbench :deep(input:focus-visible), .hedge-workbench :deep(select:focus-visible) { outline: 2px solid var(--primary); outline-offset: 2px; }
.region-closed { padding: 48px; text-align: center; font-size: var(--font-lg, 18px); }
.asof-banner { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; padding: 12px 16px; background: var(--warning-tint); border: 1px solid var(--warning); border-radius: var(--radius); }
@media (max-width: 700px) {
  .hedge-workbench { padding: 8px; gap: 12px; }
  .page-head { padding: 14px; }
  .tabs { width: 100%; box-sizing: border-box; }
  .tabs button { flex: 1 0 auto; }
  .query-controls { align-items: stretch; }
  .query-controls label { flex: 1 1 160px; }
  .query-controls input { width: 100%; }
}
</style>
