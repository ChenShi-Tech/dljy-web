<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { Activity, ArrowRight, CheckCircle2, Database, Eye, Globe2, Layers3, MapPinned, Network, Orbit, RefreshCw, ShieldCheck, Waypoints, XCircle } from 'lucide-vue-next'
import { selectedCompanyId } from '@/services/company/companyContext'
import { currentRegion } from '@/services/region/regionContext'
import { onRegionChange } from '@/composables/useRegionReload'
import { fetchGridOperatorProfile } from './client'
import type { GridOperatorProfile } from './types'

const active = ref<GridOperatorProfile | null>(null)
const comparison = ref<Record<'csg' | 'sgcc', GridOperatorProfile | null>>({ csg: null, sgcc: null })
const loading = ref(false)
let loadRequestId = 0
const layerLabels = { assets: '电厂空间资产', nodes: '节点 / 分区目录', topology: '授权网架', disclosure: '信息披露', weather: '地形气象', marketTimeseries: '市场时序' } as const
const activeStyle = computed(() => active.value ? {
  '--accent': active.value.visual.accent, '--secondary': active.value.visual.secondary,
  '--surface': active.value.visual.surface, '--gradient-a': active.value.visual.gradient[0], '--gradient-b': active.value.visual.gradient[2],
} : {})

async function load() {
  const requestId = ++loadRequestId
  loading.value = true
  active.value = null
  try {
    const [current, csg, sgcc] = await Promise.all([
      fetchGridOperatorProfile(currentRegion.value.id), fetchGridOperatorProfile('yunnan'), fetchGridOperatorProfile('shanxi'),
    ])
    if (requestId !== loadRequestId) return
    active.value = current
    comparison.value = { csg, sgcc }
  } finally { if (requestId === loadRequestId) loading.value = false }
}

function statusLabel(status: string) {
  return ({ available: '已接入', partial: '部分可用', degraded: '降级可用', missing: '缺少来源', 'not-configured': '未配置' } as Record<string, string>)[status] ?? status
}

onMounted(load)
onRegionChange(load)
watch(selectedCompanyId, load)
</script>

<template>
  <section v-loading="loading" class="profile-page" :style="activeStyle">
    <div class="mesh"/>
    <header v-if="active" class="hero">
      <div class="hero-copy"><span class="eyebrow"><Orbit :size="14"/> GRID OPERATOR PROFILE · {{ active.profileVersion }}</span><h1>{{ active.shortLabel }}空间展示画像</h1><p>{{ active.region.label }}当前采用 {{ active.label }} 的术语、字段、视觉与数据可用性契约。同一套组件由 manifest 驱动，不以地区硬编码分叉。</p><div class="hero-badges"><span><ShieldCheck/>跨网不回退</span><span><Database/>CONFIG · mock=false</span><span><RefreshCw/>切网清空旧缓存</span></div></div>
      <div class="operator-mark"><i/><i/><i/><strong>{{ active.visual.glyph }}</strong><small>{{ active.operatingArea }}</small></div>
    </header>

    <template v-if="active">
      <div class="top-grid">
        <article class="hierarchy-card"><header><Globe2/><div><small>REGION HIERARCHY</small><h2>空间层级</h2></div></header><div class="hierarchy"><template v-for="(item,index) in active.hierarchy" :key="item"><span>{{ item }}</span><ArrowRight v-if="index < active.hierarchy.length - 1" :size="16"/></template></div><p>默认镜头 {{ active.defaultCamera.longitude.toFixed(1) }}°E / {{ active.defaultCamera.latitude.toFixed(1) }}°N · {{ (active.defaultCamera.heightM/1000).toLocaleString() }} km，仅定义网级视域，不代表资产坐标。</p></article>
        <article class="policy-card"><header><ShieldCheck/><div><small>DATA ISOLATION</small><h2>切网策略</h2></div></header><dl><div><dt>缓存命名空间</dt><dd>{{ active.dataPolicy.cacheNamespace }}</dd></div><div><dt>跨网回退</dt><dd>禁止</dd></div><div><dt>切换清理</dt><dd>旧图层 / 请求 / 选择态</dd></div><div><dt>生产写入</dt><dd>false</dd></div></dl></article>
      </div>

      <section class="availability"><div class="section-title"><span><Activity :size="18"/>当前地区数据层</span><small>真实源状态，不以品牌色暗示可用性</small></div><div class="layer-grid"><article v-for="(state,key) in active.dataAvailability" :key="key" :class="state.status"><span class="status-icon"><CheckCircle2 v-if="state.status==='available'"/><XCircle v-else-if="state.status==='missing'||state.status==='not-configured'"/><Activity v-else/></span><small>{{ layerLabels[key] }}</small><strong>{{ statusLabel(state.status) }}</strong><p>{{ state.reason }}</p></article></div></section>

      <div class="contract-grid">
        <article class="term-card"><div class="section-title"><span><Waypoints :size="18"/>术语映射</span><small>{{ active.shortLabel }} vocabulary</small></div><dl><div v-for="(value,key) in active.terminology" :key="key"><dt>{{ key }}</dt><dd>{{ value }}</dd></div></dl></article>
        <article class="field-card"><div class="section-title"><span><Layers3 :size="18"/>组件字段</span><small>同组件 · profile-driven</small></div><h3>{{ active.terminology.pricingNode }}</h3><ul><li v-for="item in active.nodeFields" :key="item"><Eye :size="13"/>{{ item }}</li></ul><h3>{{ active.terminology.intertie }}</h3><ul><li v-for="item in active.intertieFields" :key="item"><Network :size="13"/>{{ item }}</li></ul></article>
      </div>

      <section class="compare"><div class="section-title"><span><MapPinned :size="18"/>南网 / 国网对照</span><small>切换地区后当前画像自动更新</small></div><div class="compare-grid"><article v-for="profile in comparison" :key="profile?.id" :class="profile?.id"><span class="compare-glyph">{{ profile?.visual.glyph }}</span><div><small>{{ profile?.operatingArea }}</small><h3>{{ profile?.label }}</h3><p>{{ profile?.terminology.unifiedClearing }} · {{ profile?.terminology.pricingNode }} · {{ profile?.terminology.disclosure }}</p><div class="principles"><span v-for="item in profile?.principles" :key="item">{{ item }}</span></div></div></article></div></section>
    </template>
  </section>
</template>

<style scoped>
.profile-page{--accent:#22d3ee;--secondary:#2dd4bf;--surface:#071b29;--gradient-a:#062b3d;--gradient-b:#116466;position:relative;min-height:100%;padding:24px;overflow:hidden;color:#dcecff;background:radial-gradient(circle at 84% -10%,color-mix(in srgb,var(--accent) 18%,transparent),transparent 34%),linear-gradient(145deg,#06101b,#071725 55%,#050b13)}.mesh{position:absolute;inset:0;pointer-events:none;opacity:.25;background-image:linear-gradient(color-mix(in srgb,var(--accent) 12%,transparent) 1px,transparent 1px),linear-gradient(90deg,color-mix(in srgb,var(--accent) 12%,transparent) 1px,transparent 1px);background-size:36px 36px;mask-image:radial-gradient(circle at 70% 10%,#000,transparent 72%)}.hero,.top-grid,.availability,.contract-grid,.compare{position:relative;max-width:1480px;margin-left:auto;margin-right:auto}.hero{display:flex;justify-content:space-between;align-items:center;padding:30px;border:1px solid color-mix(in srgb,var(--accent) 28%,transparent);border-radius:24px;background:linear-gradient(110deg,color-mix(in srgb,var(--gradient-a) 85%,transparent),#081321dd);box-shadow:inset 4px 0 var(--accent),0 25px 70px #0007}.hero-copy{max-width:860px}.eyebrow{display:flex;align-items:center;gap:7px;color:var(--accent);font-size:15px;font-weight:800;letter-spacing:.17em}.hero h1{margin:9px 0;font-size:clamp(31px,4vw,50px);letter-spacing:-.04em}.hero p{max-width:780px;color:#8fa6bf;line-height:1.7}.hero-badges{display:flex;gap:8px;flex-wrap:wrap;margin-top:17px}.hero-badges span{display:flex;align-items:center;gap:5px;padding:6px 9px;border:1px solid color-mix(in srgb,var(--accent) 24%,transparent);border-radius:99px;color:#a8c7dc;background:#ffffff08;font-size:15px}.hero-badges svg{width:13px}.operator-mark{position:relative;width:174px;height:174px;display:grid;place-content:center;text-align:center;border:1px solid color-mix(in srgb,var(--accent) 35%,transparent);border-radius:50%;background:radial-gradient(circle,color-mix(in srgb,var(--accent) 20%,transparent),transparent 68%)}.operator-mark i{position:absolute;inset:12px;border:1px dashed color-mix(in srgb,var(--accent) 35%,transparent);border-radius:50%;animation:spin 16s linear infinite}.operator-mark i:nth-child(2){inset:28px;animation-direction:reverse}.operator-mark i:nth-child(3){inset:48px}.operator-mark strong{font-size:34px;color:var(--accent)}.operator-mark small{color:#7c95ad;font-size:14px}@keyframes spin{to{transform:rotate(360deg)}}
.top-grid,.contract-grid{display:grid;grid-template-columns:1.5fr 1fr;gap:12px;margin-top:12px}.top-grid article,.contract-grid article,.availability,.compare{padding:18px;border:1px solid #7290ab24;border-radius:18px;background:#071522df;backdrop-filter:blur(12px)}article header{display:flex;align-items:center;gap:9px;color:var(--accent)}article header svg{width:20px}article header small,article header h2{display:block;margin:0}article header small{font-size:14px;letter-spacing:.14em;color:#6c8299}article header h2{font-size:16px;color:#d7e8f7}.hierarchy{display:flex;align-items:center;gap:9px;margin:20px 0}.hierarchy span{flex:1;padding:12px;border:1px solid color-mix(in srgb,var(--accent) 28%,transparent);border-radius:11px;text-align:center;color:#cceaf3;background:color-mix(in srgb,var(--surface) 75%,transparent);font-size:15px}.hierarchy svg{color:#59748e}.hierarchy-card p{font-size:15px;color:#6f879f}.policy-card dl,.term-card dl{margin:12px 0 0}.policy-card dl>div,.term-card dl>div{display:grid;grid-template-columns:130px 1fr;gap:10px;padding:8px 0;border-bottom:1px dashed #718ba321;font-size:15px}.policy-card dt,.term-card dt{color:#6c849d}.policy-card dd,.term-card dd{margin:0;color:#c7dbea}.availability,.compare{margin-top:12px}.section-title{display:flex;align-items:center;justify-content:space-between}.section-title span{display:flex;align-items:center;gap:7px;font-size:16px;font-weight:700}.section-title span svg{color:var(--accent)}.section-title small{font-size:14px;color:#647b93}.layer-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:14px}.layer-grid article{position:relative;padding:13px;border:1px solid #718ba322;border-radius:13px;background:#081825}.status-icon{position:absolute;right:10px;top:10px;color:#f59e0b}.status-icon svg{width:16px}.layer-grid article.available .status-icon{color:#34d399}.layer-grid article.missing .status-icon,.layer-grid article.not-configured .status-icon{color:#fb7185}.layer-grid small,.layer-grid strong{display:block}.layer-grid small{color:#6f879f;font-size:14px}.layer-grid strong{margin-top:6px;font-size:16px}.layer-grid p{min-height:44px;font-size:14px;line-height:1.55;color:#7189a2}.contract-grid{grid-template-columns:1fr 1fr}.term-card dl{display:grid;grid-template-columns:1fr 1fr;column-gap:18px}.field-card h3{font-size:15px;color:var(--accent);margin:16px 0 8px}.field-card ul{display:flex;flex-wrap:wrap;gap:7px;padding:0;margin:0;list-style:none}.field-card li{display:flex;align-items:center;gap:5px;padding:7px 9px;border-radius:8px;color:#93abc1;background:#0b2030;font-size:15px}.compare-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:14px}.compare-grid article{display:flex;gap:14px;padding:18px;border:1px solid #7692aa26;border-radius:15px;background:var(--panel)}.compare-grid article.sgcc{background:var(--panel)}.compare-glyph{width:52px;height:52px;flex:0 0 auto;display:grid;place-content:center;border-radius:14px;color:#04202a;background:linear-gradient(135deg,#22d3ee,#2dd4bf);font-size:15px;font-weight:900}.sgcc .compare-glyph{color:#07152f;background:linear-gradient(135deg,#60a5fa,#818cf8)}.compare-grid small{color:#6f879e;font-size:14px}.compare-grid h3{margin:3px 0;font-size:17px}.compare-grid p{color:#859cb3;font-size:15px}.principles{display:flex;gap:6px;flex-wrap:wrap}.principles span{padding:5px 7px;border-radius:7px;color:#7792aa;background:#ffffff08;font-size:14px}@media(max-width:980px){.layer-grid{grid-template-columns:repeat(2,1fr)}.top-grid,.contract-grid,.compare-grid{grid-template-columns:1fr}.operator-mark{display:none}}@media(max-width:600px){.profile-page{padding:10px}.hero{padding:20px}.hierarchy{flex-direction:column}.hierarchy span{width:100%;box-sizing:border-box}.hierarchy svg{transform:rotate(90deg)}.layer-grid{grid-template-columns:1fr}.term-card dl{grid-template-columns:1fr}}
</style>
