<script setup lang="ts">
// 预测数据 profile 选择条：把页面数据源绑定到 {登录地区 · 账号所属公司 · 公司下属厂站}。
// 地区、公司沿用全局上下文(顶栏切换)，本条只读展示；厂站可在「当前公司·当前地区」范围内切换。
// 数据为按厂站画像合成的模拟数据，明确标注「模拟数据」。
import { computed, onMounted } from 'vue'
import { MapPin, Building2, Factory, FlaskConical } from 'lucide-vue-next'
import {
  forecastStations,
  forecastStationsLoading,
  forecastStationsError,
  currentForecastStationId,
  currentForecastStation,
  forecastProfile,
  setForecastStationId,
  loadForecastStations
} from '@/services/forecast/forecastContext'

// 新能源出力口径(zxztqa/zgnrx)只对风电/光伏厂站有出力，其余类型曲线为 0，给出提示。
const props = defineProps<{ kind: 'zxztqa' | 'zgnrx' | 'gsfhyc' }>()

const isNewEnergy = computed(() => props.kind === 'zxztqa' || props.kind === 'zgnrx')
const stationType = computed(() => currentForecastStation.value?.type ?? '')
const noRenewable = computed(() => isNewEnergy.value && !!currentForecastStation.value && !['光伏', '风电'].includes(stationType.value))

const stationModel = computed<number | null>({
  get: () => currentForecastStationId.value,
  set: (id) => setForecastStationId(id)
})

const regionLabel = computed(() => forecastProfile.value.region?.shortName ?? '—')
const companyLabel = computed(() => forecastProfile.value.company?.name ?? '—')

onMounted(() => { void loadForecastStations() })
</script>

<template>
  <div class="fp-bar">
    <div class="fp-line">
      <span class="fp-seg"><MapPin :size="15" class="ic" /> 地区 <strong>{{ regionLabel }}</strong></span>
      <span class="fp-sep">·</span>
      <span class="fp-seg"><Building2 :size="15" class="ic" /> 公司 <strong>{{ companyLabel }}</strong></span>
      <span class="fp-sep">·</span>
      <span class="fp-seg">
        <Factory :size="15" class="ic" /> 厂站
        <el-select
          v-model="stationModel"
          size="small"
          class="fp-select"
          :loading="forecastStationsLoading"
          :no-data-text="forecastStationsError || '当前公司在该地区暂无厂站'"
          placeholder="选择厂站"
          filterable
        >
          <el-option
            v-for="s in forecastStations"
            :key="s.id"
            :label="`${s.name}（${s.type}${s.capacity ? ' · ' + s.capacity + 'MW' : ''}）`"
            :value="s.id"
          />
        </el-select>
      </span>
      <span class="fp-spacer" />
      <el-tag size="small" type="warning" effect="plain" round><FlaskConical :size="12" class="tag-ic" /> 模拟数据</el-tag>
    </div>
    <div v-if="noRenewable" class="fp-hint">
      当前厂站类型为「{{ stationType }}」，无风电/光伏装机，新能源出力按 0 显示；如需查看出力曲线请选择风电或光伏厂站。
    </div>
  </div>
</template>

<style scoped>
.fp-bar {
  margin-bottom: 12px;
  padding: 8px 14px;
  border: 1px solid var(--line-faint);
  border-radius: 6px;
  background: var(--panel-sub);
}
.fp-line {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  font-size: var(--font-md);
  color: var(--el-text-color-regular);
}
.fp-seg { display: inline-flex; align-items: center; gap: 4px; }
.fp-seg .ic { color: var(--el-color-primary); flex: 0 0 auto; }
.fp-seg strong { color: var(--text); font-weight: 700; }
.fp-sep { color: var(--el-text-color-secondary); }
.fp-select { width: 240px; margin-left: 4px; }
.fp-spacer { flex: 1; }
.tag-ic { margin-right: 2px; vertical-align: -1px; }
.fp-hint {
  margin-top: 6px;
  font-size: var(--font-sm);
  color: var(--warning);
}
@media (max-width: 768px) {
  .fp-line { align-items: stretch; }
  .fp-select { width: 100%; }
  .fp-spacer { display: none; }
}
</style>
