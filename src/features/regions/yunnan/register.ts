// 云南扩展包装配入口（Epic #1431 S3 第二段）
// 把本省面板注册到内核命名插槽。内核不认识本文件，只认插槽 id，增删本省面板
// 不需要改内核一行代码（`verify:region-isolation` 守卫强制内核不得直引扩展包）。
//
// 面板用 defineAsyncComponent 懒加载：各省面板不进主包，切到该 tab 才拉取。

import { defineAsyncComponent } from 'vue'
import { registerRegionSlot } from '@/services/region/regionSlots'
import { YUNNAN_REGION_ID } from './profile'
import { registerYunnanInsightWorkspace } from './insight/workspace'

export function registerYunnanRegion(): void {
  registerYunnanInsightWorkspace()
  registerRegionSlot({
    slotId: 'cockpit.elasticity',
    regionId: YUNNAN_REGION_ID,
    capabilityPath: '/xhjy/yunnan/elasticity',
    component: defineAsyncComponent(() => import('./panels/ElasticityPanel.vue'))
  })
  registerRegionSlot({
    slotId: 'cockpit.spread',
    regionId: YUNNAN_REGION_ID,
    capabilityPath: '/xhjy/yunnan/spread',
    component: defineAsyncComponent(() => import('./panels/SpreadPanel.vue'))
  })
  registerRegionSlot({
    slotId: 'cockpit.spotPnl',
    regionId: YUNNAN_REGION_ID,
    capabilityPath: '/xhjy/yunnan/spot-pnl',
    component: defineAsyncComponent(() => import('./panels/SpotPnLPanel.vue'))
  })
  registerRegionSlot({
    slotId: 'cockpit.plantOutput',
    regionId: YUNNAN_REGION_ID,
    capabilityPath: '/xhjy/yunnan/plant-output',
    component: defineAsyncComponent(() => import('./panels/PlantOutputPanel.vue'))
  })
  registerRegionSlot({
    slotId: 'cockpit.priceOutputLinkage',
    regionId: YUNNAN_REGION_ID,
    capabilityPath: '/xhjy/yunnan/price-output-linkage',
    component: defineAsyncComponent(() => import('./panels/PriceOutputLinkagePanel.vue'))
  })
  registerRegionSlot({
    slotId: 'cockpit.disclosure',
    regionId: YUNNAN_REGION_ID,
    capabilityPath: '/xhjy/yunnan/disclosure',
    component: defineAsyncComponent(() => import('./panels/DisclosurePanel.vue'))
  })
}
