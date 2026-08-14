<script setup lang="ts">
// 现货价格与统调负荷关系 (zrxgx2 / zcqxhdl fhlist24) —— 薄壳，逻辑在共享工作台 RelationExplorer。
// X=统调负荷(自适应)；参考竖线只有一条「统调负荷」(橙)。
// 数据经 market_insight relation_scatter 契约适配：山西包装 sdpt_zcqxhdl/fhlist24，云南包装 yn_system_forecast。
// 数据源(内部参考,勿对外展示)：真实数据：POST /sdpt/zcqxhdl/fhlist24 ｜ 运行日 · 前 N 天 · 24 小时（X=统调负荷自适应 / Y=电价0-1500）。
// ⚠️ 模板必须保持单根：根元素旁多一个注释节点都会让本组件变 fragment 根，
// AppLayout 的 <Transition mode="out-in"> 无法动画 fragment → 离开过渡卡死 → 之后切任何页面全空白。
import RelationExplorer from './relation/RelationExplorer.vue'
import type { RelationReferenceLine } from './relation/relationTypes'

const referenceLines: RelationReferenceLine[] = [
  { array: 'xnyzd', arrayIndex: 0, color: '#ED7D31', width: 2.5, legendLabel: '统调负荷' }
]
</script>

<template>
  <RelationExplorer
    kind="load"
    route-path="/sjfx/zrxgx2"
    x-label="统调负荷"
    x-unit="MW"
    :reference-lines="referenceLines"
    prompt-label="现货价格与统调负荷关系"
    prompt-page="zrxgx2"
  />
</template>
