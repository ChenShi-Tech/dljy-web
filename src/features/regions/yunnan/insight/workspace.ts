// 云南市场洞察工作区登记（dljy#2995 阶段 A）
// ----------------------------------------------------------------------------
// ⚠ 已封存（2026-09-28，dljy#3387）：用户试看后判定不如旧版，本工作区不上线，开关保持关闭；
// 存档 tag archive/insight-workspace-v1。删除本目录须另行征得用户同意，新代码不得 import 本目录。
// 详见 docs/market-insight.md「新版地区工作区已封存」。
//
// 六页骨架齐备；overview（dljy#3009）、prices（dljy#3007 四页签 + 多日立体/热力/降级）、
// supply（dljy#3008）、grid-boundaries（dljy#3024 三页签）、plants（dljy#3083 五页签：
// 组合总览/价格出力/预测执行/申报出清实际/结算表现）与 research（dljy#3080 研究工作台）
// 全部交付进导航。
//
// enabled 读 VITE_YUNNAN_INSIGHT_WORKSPACE（默认关闭）——这是 UI 装配开关不是授权开关
//（授权走 governance.canAccessPath 权限别名，与本开关无关），关闭时云南导航与现状
// 完全一致，规范地址 (/insight/<pageId>) 由宿主按 not-registered 显示「暂未开通」。

import { registerInsightWorkspace } from '@/services/region/insightWorkspace'
import { YUNNAN_REGION_ID } from '../profile'

export function registerYunnanInsightWorkspace(): void {
  registerInsightWorkspace({
    workspaceId: 'yunnan.insight',
    regionId: YUNNAN_REGION_ID,
    version: 1,
    defaultPageId: 'overview',
    enabled: () => import.meta.env.VITE_YUNNAN_INSIGHT_WORKSPACE === '1',
    replacesNavigation: true,
    pages: [
      { pageId: 'overview', title: '市场总览', order: 1, load: () => import('./pages/YunnanOverviewPage.vue'), delivered: true },
      { pageId: 'prices', title: '价格与价差', order: 2, load: () => import('./pages/YunnanPricesPage.vue'), delivered: true },
      { pageId: 'supply', title: '供需与水电', order: 3, load: () => import('./pages/YunnanSupplyPage.vue'), delivered: true },
      { pageId: 'grid-boundaries', title: '跨省与电网边界', order: 4, load: () => import('./pages/YunnanGridBoundariesPage.vue'), delivered: true },
      { pageId: 'plants', title: '场站市场表现', order: 5, load: () => import('./pages/YunnanPlantsPage.vue'), delivered: true },
      { pageId: 'research', title: '研究工作台', order: 6, load: () => import('./pages/YunnanResearchPage.vue'), delivered: true }
    ]
  })
}
