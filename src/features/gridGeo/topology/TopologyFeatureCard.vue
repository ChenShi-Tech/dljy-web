<script setup lang="ts">
import { computed } from 'vue'
import { GitBranch, MapPinned, Network, ShieldCheck, X } from 'lucide-vue-next'
import type { GridTopologyFeature, GridTopologyManifest } from '../types'
import { topologyFeatureLabel } from './topologyStyle'

const props = defineProps<{ feature: GridTopologyFeature; manifest: GridTopologyManifest; sourceType: 'CONFIG' | 'DB' | 'IMPORT' }>()
defineEmits<{ close: [] }>()
const explicitRefs = computed(() => Object.entries(props.feature.refs ?? {}).filter(([, value]) => value !== null && value !== undefined && (!Array.isArray(value) || value.length)))
</script>

<template>
  <article class="topology-feature-card" aria-live="polite">
    <button type="button" class="close" aria-label="关闭网架要素卡片" @click="$emit('close')"><X :size="15" /></button>
    <small><GitBranch :size="13" />AUTHORIZED TOPOLOGY · {{ topologyFeatureLabel(feature.kind) }}</small>
    <h2>{{ feature.name }}</h2>
    <p><MapPinned :size="14" />{{ feature.regionId }} · {{ feature.gridOperator.toUpperCase() }} · {{ feature.status }}</p>
    <dl>
      <div><dt>稳定 ID</dt><dd>{{ feature.featureId }}</dd></div>
      <div><dt>拓扑版本</dt><dd>{{ feature.topologyVersion }}</dd></div>
      <div><dt>来源</dt><dd>{{ sourceType }} · {{ feature.sourceRef }}</dd></div>
      <div><dt>几何</dt><dd>{{ feature.geometry.type }} · WGS84</dd></div>
    </dl>
    <section v-if="explicitRefs.length">
      <strong><Network :size="13" />显式身份关联</strong>
      <span v-for="[key, value] in explicitRefs" :key="key"><b>{{ key }}</b>{{ Array.isArray(value) ? value.join('、') : value }}</span>
    </section>
    <footer><ShieldCheck :size="13" />{{ manifest.classification }} · 只读视觉身份，不表示潮流、负载率或阻塞成因</footer>
  </article>
</template>

<style scoped>
.topology-feature-card{position:absolute;z-index:13;right:382px;bottom:58px;width:min(430px,calc(100% - 650px));padding:15px;color:#d8eef3;border:1px solid rgba(198,156,255,.28);border-radius:15px;background:linear-gradient(145deg,rgba(18,18,48,.96),rgba(3,17,29,.94));box-shadow:0 28px 70px rgba(0,0,0,.55);backdrop-filter:blur(20px)}.close{position:absolute;top:9px;right:9px;display:grid;width:28px;height:28px;place-items:center;color:#8ea9b4;border:0;border-radius:7px;background:#ffffff0c;cursor:pointer}.topology-feature-card>small,.topology-feature-card>p,.topology-feature-card footer,.topology-feature-card section strong{display:flex;align-items:center;gap:6px}.topology-feature-card>small{color:#c69cff;font-size: var(--font-lg);font-weight:800;letter-spacing:.12em}.topology-feature-card h2{margin:5px 30px 4px 0;font-size: var(--font-20)}.topology-feature-card>p{margin:0;color:#7899a6;font-size: var(--font-15)}.topology-feature-card dl{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin:11px 0}.topology-feature-card dl div{min-width:0;padding:8px;border-radius:8px;background:#020e194d}.topology-feature-card dt{color:#627f8c;font-size: var(--font-lg)}.topology-feature-card dd{overflow:hidden;margin:3px 0 0;color:#d7edf2;font-size: var(--font-15);text-overflow:ellipsis;white-space:nowrap}.topology-feature-card section{display:flex;flex-direction:column;gap:5px;padding:9px;border:1px solid #8c70b628;border-radius:9px}.topology-feature-card section strong{color:#bda6e8;font-size: var(--font-15)}.topology-feature-card section span{display:grid;grid-template-columns:110px 1fr;gap:8px;color:#88a5b0;font-size: var(--font-lg)}.topology-feature-card section b{color:#c9dbe1}.topology-feature-card footer{margin-top:10px;color:#7e91a6;font-size: var(--font-lg);line-height:1.45}@media(max-width:900px){.topology-feature-card{right:360px;left:104px;width:auto}}@media(max-width:700px){.topology-feature-card{right:10px;bottom:calc(166px + env(safe-area-inset-bottom));left:10px;width:auto}.topology-feature-card dl{grid-template-columns:1fr}.topology-feature-card section{display:none}}
</style>
