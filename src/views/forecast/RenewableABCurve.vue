<script setup lang="ts">
// 新能源出力预测 A/B 合并视图（SP-4a 预测数据回放轨收口）。
// 把原「模型A(zxztqa)」「模型B(zgnrx)」两个独立 tab 合并为一个 tab，
// 内部用单选切换数据源对比；A/B 是两套来源与方法，可交叉验证。
// 复用 ForecastMultiTypeCurve：其 cfg 在 setup 时一次性捕获（非响应式），
// 故用 :key 随源切换强制重挂以换 cfg、重新拉数。
import { ref, computed, watch } from 'vue'
import ForecastMultiTypeCurve from './ForecastMultiTypeCurve.vue'
import { FORECAST_CFGS } from '../../data/forecastHubTabs'

type RenewableSource = 'zxztqa' | 'zgnrx'
const props = defineProps<{ source?: RenewableSource }>()
const active = ref<RenewableSource>(props.source === 'zgnrx' ? 'zgnrx' : 'zxztqa')
// 父级深链预选变化时同步（hub ?tab=zxztqa / ?tab=zgnrx 映射到本 tab 并预选 A/B）
watch(() => props.source, (s) => { if (s === 'zxztqa' || s === 'zgnrx') active.value = s })
const activeCfg = computed(() => (active.value === 'zgnrx' ? FORECAST_CFGS.zgnrx : FORECAST_CFGS.zxztqa))
</script>

<template>
  <div class="renewable-ab">
    <div class="ab-switch">
      <span class="ab-label">出力预测模型</span>
      <el-radio-group v-model="active" size="small">
        <el-radio-button value="zxztqa">模型A</el-radio-button>
        <el-radio-button value="zgnrx">模型B</el-radio-button>
      </el-radio-group>
      <span class="ab-hint">模型 A / B 为两套来源与方法，可交叉验证（绑定 地区·公司·厂站）</span>
    </div>
    <ForecastMultiTypeCurve :key="active" :cfg="activeCfg" />
  </div>
</template>

<style scoped>
.renewable-ab { display: flex; flex-direction: column; }
.ab-switch {
  display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
  padding: 10px 16px 0;
}
.ab-label { font-size: 13px; font-weight: 600; color: var(--el-text-color-regular); }
.ab-hint { font-size: 12px; color: var(--el-text-color-secondary); }
@media (max-width: 768px) {
  .ab-switch { padding: 10px 12px 0; }
}
</style>
