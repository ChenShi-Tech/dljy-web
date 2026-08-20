<script setup lang="ts">
// 现货价格与新能源关系 (zrxgx / zcqxhdl list24)，薄壳，逻辑在共享工作台 RelationExplorer。
// X=新能源出力(0–14000 固定)；参考竖线：新能源总低价(橙)/光伏均值(绿)/光伏 D+1..5(细)，按地区能力门控。
// 数据经 market_insight relation_scatter 契约适配：山西包装 sdpt_zcqxhdl/list24，云南包装 yn_system_forecast。
// 数据源(内部参考,勿对外展示)：真实数据：POST /sdpt/zcqxhdl/list24 ｜ 运行日 · 前 N 天 · 24 小时。
// ⚠️ 模板必须保持单根：根元素旁多一个注释节点都会让本组件变 fragment 根，
// AppLayout 的 <Transition mode="out-in"> 无法动画 fragment → 离开过渡卡死 → 之后切任何页面全空白。
import RelationExplorer from './relation/RelationExplorer.vue'
import type { RelationReferenceLine } from './relation/relationTypes'

const referenceLines: RelationReferenceLine[] = [
  { array: 'xnyzd', arrayIndex: 0, color: '#ED7D31', width: 2.5, legendLabel: '新能源总低价', dimensionId: 'zrxgx.xnyzd' },
  { array: 'xnyg', arrayIndex: 0, color: '#70AD1F', width: 2.5, legendLabel: '光伏均值', dimensionId: 'zrxgx.xnyg' },
  { array: 'xnygd', arrayIndex: 0, color: '#934294', width: 1, dimensionId: 'zrxgx.xnygd' },
  { array: 'xnygd', arrayIndex: 1, color: '#A349A4', width: 1, dimensionId: 'zrxgx.xnygd' },
  { array: 'xnygd', arrayIndex: 2, color: '#3399FF', width: 1, dimensionId: 'zrxgx.xnygd' },
  { array: 'xnygd', arrayIndex: 3, color: '#487c05', width: 1, dimensionId: 'zrxgx.xnygd' },
  { array: 'xnygd', arrayIndex: 4, color: '#4472C4', width: 1, dimensionId: 'zrxgx.xnygd' }
]
</script>

<template>
  <RelationExplorer
    kind="renewable"
    route-path="/sjfx/zrxgx"
    x-label="新能源出力"
    x-unit="MW"
    :x-fixed-max="14000"
    :reference-lines="referenceLines"
    prompt-label="现货价格与新能源关系"
    prompt-page="zrxgx"
  />
</template>
