// 云南市场洞察工作区登记（dljy#2995 阶段 A）
// ----------------------------------------------------------------------------
// 六页全部登记、全部 delivered:false——本阶段只搭骨架：路由、宿主、导航装配、
// 兼容映射齐备，业务页后续逐页交付（交付一页把该页 delivered 置 true 并换掉 load 指向）。
// 全部未交付时导航不替换（listInsightNavigation 返回 null），侧边栏与现状完全一致。
//
// enabled 读 VITE_YUNNAN_INSIGHT_WORKSPACE（默认关闭）——这是 UI 装配开关不是授权开关
//（授权走 governance.canAccessPath 权限别名，与本开关无关），关闭时云南导航与现状
// 完全一致，规范地址 (/insight/<pageId>) 由宿主按 not-registered 显示「暂未开通」。

import { registerInsightWorkspace } from '@/services/region/insightWorkspace'
import { YUNNAN_REGION_ID } from '../profile'

// 占位组件懒加载：与正式页同为按需 chunk，交付时替换为正式页组件即可
const loadPending = () => import('./InsightPagePending.vue')

export function registerYunnanInsightWorkspace(): void {
  registerInsightWorkspace({
    workspaceId: 'yunnan.insight',
    regionId: YUNNAN_REGION_ID,
    version: 1,
    defaultPageId: 'overview',
    enabled: () => import.meta.env.VITE_YUNNAN_INSIGHT_WORKSPACE === '1',
    replacesNavigation: true,
    pages: [
      { pageId: 'overview', title: '市场总览', order: 1, load: loadPending, delivered: false },
      { pageId: 'prices', title: '价格与价差', order: 2, load: loadPending, delivered: false },
      { pageId: 'supply', title: '供需与水电', order: 3, load: loadPending, delivered: false },
      { pageId: 'grid-boundaries', title: '跨省与电网边界', order: 4, load: loadPending, delivered: false },
      { pageId: 'plants', title: '场站市场表现', order: 5, load: loadPending, delivered: false },
      { pageId: 'research', title: '研究工作台', order: 6, load: loadPending, delivered: false }
    ]
  })
}
