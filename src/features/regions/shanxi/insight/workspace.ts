// 山西市场洞察工作区兼容登记（dljy#2995 阶段 A，OpenSpec D1：山西建兼容描述、不重做业务设计）
// ----------------------------------------------------------------------------
// 目的：让规范地址 /insight/overview、/insight/prices 在山西落到现有两个页面
// （驾驶舱与价格分析），跨地区切换与旧链接身份识别有统一落点；**不新增任何业务功能**。
// 其余四页不登记——访问时 resolve 为 page-not-supported，宿主回默认入口并提示。
//
// enabled 恒 true：山西是基线地区，兼容登记无条件生效（与云南的灰度开关不同）。
// 不设 replacesNavigation：导航保持现状（仍显示 /insight/cockpit、/sjfx/* 等旧入口），
// 侧边栏一概不变，规范地址只是可直达的等价入口。

import { registerInsightWorkspace } from '@/services/region/insightWorkspace'
import { SHANXI_REGION_ID } from '../profile'

export function registerShanxiInsightWorkspace(): void {
  registerInsightWorkspace({
    workspaceId: 'shanxi.insight',
    regionId: SHANXI_REGION_ID,
    version: 1,
    defaultPageId: 'overview',
    enabled: () => true,
    pages: [
      // 复用现有页面组件，行为与旧入口完全一致（同一组件懒加载）
      { pageId: 'overview', title: '市场洞察驾驶舱', order: 1, load: () => import('@/views/MarketInsightCockpitView.vue'), delivered: true },
      { pageId: 'prices', title: '价格分析', order: 2, load: () => import('@/views/PriceAnalysisView.vue'), delivered: true }
    ]
  })
}
