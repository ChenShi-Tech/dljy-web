<script setup lang="ts">
// 三维地形控制面板。原先只在「电厂地理空间」内联实现，驾驶舱/市场态势/气象
// 三页把地形源写死为 arcgis-terrain，用户没有任何入口切换或确认地形是否真的加载。
// 抽成共用组件后各空间页共用同一份控件与同一套降级提示。
import { computed, ref } from 'vue'
import { Mountain, Binoculars, KeyRound } from 'lucide-vue-next'

import type { GridGeoTerrainProvider, GridGeoTerrainStatus, GridGeoViewMode } from './types'
import { VERTICAL_EXAGGERATION_RANGE } from './useViewPreference'
import { resolveIonToken, resolveIonTokenSource, writeIonToken } from '@/config/mapTokens'

const provider = defineModel<GridGeoTerrainProvider>('provider', { required: true })
const hillshade = defineModel<boolean>('hillshade', { required: true })
const exaggeration = defineModel<number>('exaggeration', { required: true })

const props = defineProps<{
  status: GridGeoTerrainStatus
  /** 宿主当前视图模式：2D 走平面图，地形参数不参与渲染，面板需说明而非假装生效。 */
  viewMode: GridGeoViewMode
  /** 晕渲图层是否真的加载成功；未传视为未知（尚未尝试）。 */
  hillshadeAvailable?: boolean | null
}>()

const emit = defineEmits<{ 'request-3d': []; 'request-terrain-tour': [] }>()

/**
 * Cesium World Terrain 走 ion 服务，没有 token 时选中必然回退。
 *
 * token 现在是**运行时**凭据（localStorage 优先、构建期 env 兜底），所以这里读的是
 * 解析结果而不是 `import.meta.env`——否则现场填完 token 面板不会跟着变。
 */
const ionToken = ref(resolveIonToken())
const ionTokenSource = ref(resolveIonTokenSource())
const ionTokenConfigured = computed(() => ionToken.value.trim().length > 0)

const tokenEditorOpen = ref(false)
const tokenDraft = ref('')

function openTokenEditor() {
  tokenDraft.value = ionTokenSource.value === 'runtime' ? ionToken.value : ''
  tokenEditorOpen.value = true
}

function saveToken() {
  ionToken.value = writeIonToken(tokenDraft.value)
  ionTokenSource.value = resolveIonTokenSource()
  tokenEditorOpen.value = false
  // 填上 token 后停在「免 token 档」没有意义——那一档拿不到山体明暗，
  // 用户来填 token 就是为了看真地形，直接替他切过去。
  if (ionTokenConfigured.value && provider.value === 'arcgis-terrain') provider.value = 'cesium-world-terrain'
}

function clearToken() {
  ionToken.value = writeIonToken('')
  ionTokenSource.value = resolveIonTokenSource()
  tokenDraft.value = ''
  if (!ionTokenConfigured.value && provider.value === 'cesium-world-terrain') provider.value = 'arcgis-terrain'
}

const flatMode = computed(() => props.viewMode === '2d')

/**
 * 勾着但实际没加载上。换到可达子域后这是小概率路径，但外网抖动/企业代理仍会拦，
 * 不点破的话复选框看起来是生效的。
 */
const hillshadeBroken = computed(() => !flatMode.value && hillshade.value && props.hillshadeAvailable === false)

/**
 * ArcGIS Terrain 3D 只有高程、没有顶点法线（Cesium 里 `hasVertexNormals` 恒为 false），
 * 光照算不出山体明暗——地形几何是真的，山坡阴影是没有的。面板必须说破这一点：
 * 否则用户切到这一档、看见状态「在线」却看不出任何立体感，只会以为功能坏了。
 */
const arcgisLimitation = computed(() =>
  !flatMode.value && provider.value === 'arcgis-terrain' && props.status.status !== 'error')

const statusText = computed(() => {
  if (flatMode.value) return '未启用'
  if (props.status.status === 'loading') return '加载中'
  if (props.status.status === 'ready') return '在线'
  return '已降级'
})

const statusHint = computed(() => {
  if (flatMode.value) return '当前是平面地图，地形参数不参与渲染。切到 2.5D 或 3D 后生效。'
  if (props.status.status === 'fallback') return `${props.status.fallbackFrom ? '外部地形异常，' : ''}已回退到「${props.status.label}」。`
  if (props.status.status === 'error') return props.status.error || '地形加载失败，已回退到椭球体。'
  return ''
})
</script>

<template>
  <div class="terrain-control" :class="{ flat: flatMode }">
    <div class="terrain-head">
      <span><Mountain :size="14" aria-hidden="true" /> 地形环境</span>
      <small :class="flatMode ? 'inactive' : status.status">{{ statusText }}</small>
    </div>

    <select v-model="provider" aria-label="地形供应商" :disabled="flatMode">
      <option value="arcgis-terrain">ArcGIS Terrain 3D · 免 token</option>
      <option value="cesium-world-terrain" :disabled="!ionTokenConfigured">
        Cesium World Terrain · {{ ionTokenConfigured ? '含山体阴影' : '未配置 token' }}
      </option>
      <option value="ellipsoid">椭球地形 · 离线回退</option>
    </select>

    <p v-if="arcgisLimitation" class="terrain-note">
      该源只提供高程、不含山体阴影，起伏靠下方晕渲图层勾勒。要看真实山体明暗需配 Cesium ion token。
    </p>

    <label class="hillshade-toggle" :class="{ unavailable: hillshadeBroken }">
      <input v-model="hillshade" type="checkbox" :disabled="flatMode" />
      <span>叠加多向地形晕渲{{ hillshadeBroken ? '（当前网络不可用）' : '' }}</span>
    </label>

    <label class="exaggeration">
      <span>山地夸张 <b>{{ exaggeration.toFixed(2) }}×</b></span>
      <input
        v-model.number="exaggeration"
        type="range"
        :min="VERTICAL_EXAGGERATION_RANGE.min"
        :max="VERTICAL_EXAGGERATION_RANGE.max"
        step="0.05"
        :disabled="flatMode"
        aria-label="山地夸张倍数"
      />
    </label>

    <p v-if="statusHint" class="terrain-hint" :title="status.error || statusHint">{{ statusHint }}</p>

    <div class="terrain-actions">
      <button v-if="flatMode" type="button" class="to-3d" @click="emit('request-3d')">切到 3D 地形</button>
      <button
        v-else
        type="button"
        class="to-3d"
        title="飞到高差最大的场站，用低视角确认地形是否真的生效"
        @click="emit('request-terrain-tour')"
      >
        <Binoculars :size="13" aria-hidden="true" /> 地形巡视视角
      </button>
      <button type="button" class="token-entry" :title="ionTokenConfigured ? '已配置 Cesium ion token' : '配置 Cesium ion token 以启用带山体阴影的地形'" @click="openTokenEditor">
        <KeyRound :size="13" aria-hidden="true" /> {{ ionTokenConfigured ? 'ion 已配置' : '配置 ion token' }}
      </button>
    </div>

    <div v-if="tokenEditorOpen" class="token-editor">
      <label>
        <span>Cesium ion token</span>
        <input
          v-model="tokenDraft"
          type="text"
          autocomplete="off"
          spellcheck="false"
          placeholder="粘贴 ion.cesium.com 的 access token"
          aria-label="Cesium ion access token"
          @keyup.enter="saveToken"
        />
      </label>
      <p class="token-note">
        保存在本机浏览器，立即生效、无需重新构建。<template v-if="ionTokenSource === 'build'">当前用的是构建期默认 token，填写后以此处为准。</template>
      </p>
      <div class="token-buttons">
        <button type="button" class="primary" @click="saveToken">保存并启用</button>
        <button v-if="ionTokenSource === 'runtime'" type="button" @click="clearToken">清除</button>
        <button type="button" @click="tokenEditorOpen = false">取消</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.terrain-control { padding: 9px 10px; border: 1px solid rgba(107, 194, 227, .16); border-radius: 11px; background: rgba(5, 21, 38, .78); backdrop-filter: blur(9px); font-size: var(--font-10); }
.terrain-head { display: flex; margin-bottom: 7px; align-items: center; justify-content: space-between; gap: 8px; }
.terrain-head span { display: inline-flex; align-items: center; gap: 5px; color: #9fd0e2; font-weight: 600; }
.terrain-head small { padding: 1px 6px; border-radius: 6px; color: #7fe0c2; background: rgba(63, 190, 152, .13); font-size: var(--font-8-5); }
.terrain-head small.loading { color: #8fc7dd; background: rgba(96, 168, 200, .13); }
.terrain-head small.fallback, .terrain-head small.error { color: #f1c66b; background: rgba(204, 150, 42, .14); }
.terrain-head small.inactive { color: #8296a2; background: rgba(130, 150, 162, .12); }
.terrain-control select { width: 100%; height: 31px; padding: 0 8px; color: #b9d8e5; border: 1px solid rgba(107, 194, 227, .18); border-radius: 8px; outline: 0; background: #071b2d; font-size: var(--font-9-5); }
.terrain-control label { display: flex; margin-top: 8px; flex-direction: column; gap: 4px; color: #8cb4c3; }
.terrain-control label b { color: #72dbf7; font-weight: 600; }
.terrain-note { margin: 7px 0 0; padding: 6px 7px; border-left: 2px solid rgba(99, 228, 255, .34); border-radius: 4px; color: #8fb6c6; background: rgba(58, 174, 225, .07); font-size: var(--font-8-5); line-height: 1.5; }
.hillshade-toggle { flex-direction: row !important; align-items: center; gap: 6px !important; }
.hillshade-toggle input { accent-color: #48cdea; }
.hillshade-toggle.unavailable span { color: #d8aa56; }
.exaggeration input { accent-color: #48cdea; }
.terrain-control :disabled { cursor: not-allowed; opacity: .45; }
.terrain-hint { margin: 6px 0 0; color: #d8aa56; font-size: var(--font-8-5); line-height: 1.45; }
.terrain-control.flat .terrain-hint { color: #8296a2; }
/* 换行是必需的：宿主页面的面板宽度从 268px（电厂地理空间）到 208px（气象影响时序）
   不等，两个按钮并排在窄的那几页会把文案挤到省略号。min-width 决定何时折行。 */
.terrain-actions { display: flex; margin-top: 7px; flex-wrap: wrap; gap: 6px; }
.terrain-actions button { display: inline-flex; height: 27px; flex: 1 1 96px; min-width: 96px; align-items: center; justify-content: center; gap: 4px; border: 1px solid rgba(99, 228, 255, .3); border-radius: 8px; color: #63e4ff; background: rgba(58, 174, 225, .12); cursor: pointer; font-size: var(--font-9); white-space: nowrap; }
.terrain-actions button:hover { background: rgba(58, 174, 225, .22); }
.token-entry { color: #9fd0e2 !important; border-color: rgba(107, 194, 227, .22) !important; background: rgba(107, 194, 227, .08) !important; }
.token-editor { margin-top: 8px; padding-top: 8px; border-top: 1px solid rgba(107, 194, 227, .16); }
.token-editor label { margin-top: 0; }
.token-editor label span { color: #9fd0e2; font-size: var(--font-8-5); }
.token-editor input { width: 100%; height: 29px; padding: 0 8px; color: #dff5ff; border: 1px solid rgba(107, 194, 227, .24); border-radius: 7px; outline: 0; background: #061a2c; font-size: var(--font-9); }
.token-editor input:focus { border-color: rgba(99, 228, 255, .55); }
.token-note { margin: 6px 0 7px; color: #7fa2b3; font-size: var(--font-8-5); line-height: 1.5; }
.token-buttons { display: flex; gap: 6px; }
.token-buttons button { height: 26px; flex: 1; border: 1px solid rgba(107, 194, 227, .22); border-radius: 7px; color: #9fd0e2; background: rgba(107, 194, 227, .08); cursor: pointer; font-size: var(--font-9); }
.token-buttons .primary { color: #63e4ff; border-color: rgba(99, 228, 255, .34); background: rgba(58, 174, 225, .16); }
.token-buttons button:hover { background: rgba(58, 174, 225, .24); }
</style>
