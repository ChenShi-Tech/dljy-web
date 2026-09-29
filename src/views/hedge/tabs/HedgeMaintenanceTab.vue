<script setup lang="ts">
// 套保工作台「维护」页签（openspec build-midlong-spot-hedging 任务 8.6，HW-10；ChenShi-Tech/dljy#3420 页签化、#3423 四个入口补齐）。
//
// 四个维护入口：区间方案（HB）、月度发电基准（HG-07）、场站机制参数（HC-03）、核定上限（HB-07），各自是 maintenance/ 下的区块组件，
// 自己负责加载、草稿与写入。本页签只做三件事：子入口切换（v-show，切换不丢草稿）、写权限（接口声明不可写或首个 403 即整页只读，
// 并注明所需权限）、给区块 provide 共享的维护上下文。
// 维护表单有未保存草稿：切走再切回不重取（reloadOnActivate: false，#218 审查 R1-01）；切公司/地区照常清空并按新范围重取。
// 任一写入成功都会 notifyDataChanged，让依赖计算结果的页签（今明两日）下次读取即反映。
import { ref } from 'vue'
import CalloutBox from '@/components/common/CalloutBox.vue'
import { fetchMaintenanceWriteAccess } from '@/services/hedge/hedgeMaintenanceApi'
import { MAINTENANCE_WRITE_ROLE_NOTE } from '@/services/hedge/hedgeMaintenanceModel'
import { injectHedgeWorkbench, useHedgeTabLifecycle } from '../useHedgeWorkbench'
import { provideMaintenanceContext } from './maintenance/maintenanceContext'
import BandSchemeSection from './maintenance/BandSchemeSection.vue'
import BaselineSection from './maintenance/BaselineSection.vue'
import MechanismSection from './maintenance/MechanismSection.vue'
import CapsSection from './maintenance/CapsSection.vue'

type SectionKey = 'band' | 'baseline' | 'mechanism' | 'caps'

const SECTIONS: ReadonlyArray<{ key: SectionKey; label: string }> = [
  { key: 'band', label: '区间方案' },
  { key: 'baseline', label: '月度发电基准' },
  { key: 'mechanism', label: '场站机制参数' },
  { key: 'caps', label: '核定上限' },
]

const workbench = injectHedgeWorkbench()
const maintenance = provideMaintenanceContext(workbench)
const { writable, readOnlyReason } = maintenance
const activeSection = ref<SectionKey>('band')

/** 写权限声明：取不到（接口失败、中长期模块暂停）按未知处理，写入时以 403 为准。 */
async function loadWriteAccess() {
  const current = maintenance.contextRequest()
  try {
    const access = await fetchMaintenanceWriteAccess()
    if (current()) maintenance.declareWriteAccess(access)
  } catch {
    if (current()) maintenance.declareWriteAccess(null)
  }
}

useHedgeTabLifecycle(workbench, {
  load: loadWriteAccess,
  reloadOnActivate: false,
  reset: () => maintenance.declareWriteAccess(null),
})
</script>

<template>
  <section class="maintenance" data-test="maintenance">
    <CalloutBox v-if="!writable" tone="warn" title="只读" class="readonly-note" data-test="readonly-note">
      {{ readOnlyReason }}。{{ MAINTENANCE_WRITE_ROLE_NOTE }}；当前可以查看，写操作已禁用。
    </CalloutBox>
    <nav class="maint-nav" data-test="maint-nav">
      <button
        v-for="item in SECTIONS"
        :key="item.key"
        :class="{ active: activeSection === item.key }"
        :data-test="`maint-nav-${item.key}`"
        @click="activeSection = item.key"
      >{{ item.label }}</button>
    </nav>
    <BandSchemeSection v-show="activeSection === 'band'" />
    <BaselineSection v-show="activeSection === 'baseline'" />
    <MechanismSection v-show="activeSection === 'mechanism'" />
    <CapsSection v-show="activeSection === 'caps'" />
  </section>
</template>

<style scoped>
.maintenance { display: flex; flex-direction: column; gap: 12px; }
.maint-nav { display: flex; gap: 4px; border-bottom: 1px solid var(--line); }
.maint-nav button { border: none; background: none; padding: 6px 12px; font-size: var(--font-md); color: var(--muted); cursor: pointer; border-bottom: 2px solid transparent; }
.maint-nav button.active { color: var(--text); border-bottom-color: var(--accent); font-weight: 600; }
</style>
