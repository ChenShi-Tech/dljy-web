<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { Database, Globe2, ShieldCheck, Waypoints } from 'lucide-vue-next'
import { selectedCompanyId } from '@/services/company/companyContext'
import { currentRegion } from '@/services/region/regionContext'
import { onRegionChange } from '@/composables/useRegionReload'
import { fetchGridOperatorProfile } from './client'
import type { GridOperatorProfile } from './types'

const props = withDefaults(defineProps<{ compact?: boolean }>(), { compact: false })
const emit = defineEmits<{ profile: [GridOperatorProfile | null] }>()
const profile = ref<GridOperatorProfile | null>(null)
const profileState = ref<'loading' | 'ready' | 'error'>('loading')
let loadRequestId = 0

const style = computed(() => profile.value ? {
  '--grid-accent': profile.value.visual.accent,
  '--grid-secondary': profile.value.visual.secondary,
  '--grid-surface': profile.value.visual.surface,
} : {})

async function load() {
  const requestId = ++loadRequestId
  profile.value = null
  profileState.value = 'loading'
  emit('profile', null)
  try {
    const nextProfile = await fetchGridOperatorProfile(currentRegion.value.id)
    if (requestId !== loadRequestId) return
    profile.value = nextProfile
    profileState.value = 'ready'
    emit('profile', profile.value)
  } catch {
    if (requestId !== loadRequestId) return
    profile.value = null
    profileState.value = 'error'
  }
}

onMounted(load)
onRegionChange(load)
watch(selectedCompanyId, load)
</script>

<template>
  <section class="profile-banner" :class="{ compact: props.compact, placeholder: !profile }" :style="style" aria-live="polite">
    <template v-if="profile">
      <div class="identity"><span class="glyph">{{ profile.visual.glyph }}</span><div><small>{{ profile.operatingArea }} · {{ profile.region.label }}</small><strong>{{ profile.label }}展示画像</strong></div></div>
      <div class="terms"><span><Waypoints :size="14" aria-hidden="true"/>{{ profile.terminology.pricingNode }}</span><span><Globe2 :size="14" aria-hidden="true"/>{{ profile.terminology.unifiedClearing }}</span><span><Database :size="14" aria-hidden="true"/>{{ profile.terminology.disclosure }}</span></div>
      <div class="policy"><ShieldCheck :size="15" aria-hidden="true"/><span>跨网不回退</span><small>{{ profile.dataPolicy.cacheNamespace }}</small></div>
    </template>
    <div v-else class="profile-placeholder" role="status">
      <Database :size="15" aria-hidden="true" />
      <span>{{ profileState === 'loading' ? '正在读取当前地区展示画像…' : `${currentRegion.name}展示画像暂不可用` }}</span>
    </div>
  </section>
</template>

<style scoped>
.profile-banner{--grid-accent:#22d3ee;--grid-secondary:#2dd4bf;--grid-surface:var(--panel);display:flex;min-height:60px;box-sizing:border-box;align-items:center;gap:18px;padding:13px 16px;margin-bottom:12px;border:1px solid color-mix(in srgb,var(--grid-accent) 30%,transparent);border-radius:15px;color:var(--text-body);background:var(--panel);box-shadow:inset 3px 0 var(--grid-accent),var(--shadow,0 12px 32px rgba(0,0,0,.12))}.profile-banner.placeholder{min-height:60px;box-shadow:inset 3px 0 color-mix(in srgb,var(--grid-accent) 55%,transparent),var(--shadow,0 12px 32px rgba(0,0,0,.12))}.profile-placeholder{display:flex;align-items:center;gap:8px;color:var(--text-soft);font-size: var(--font-15)}.profile-placeholder svg{color:var(--grid-accent)}.identity{display:flex;align-items:center;gap:10px}.glyph{width:42px;height:34px;display:grid;place-content:center;border-radius:10px;color:var(--bg);background:linear-gradient(135deg,var(--grid-accent),var(--grid-secondary));font-size: var(--font-15);font-weight:900;letter-spacing:.06em}.identity small,.identity strong{display:block}.identity small{font-size: var(--font-lg);color:var(--text-soft)}.identity strong{font-size: var(--font-15)}.terms{display:flex;align-items:center;gap:7px;flex:1}.terms span{display:flex;align-items:center;gap:5px;padding:6px 8px;border-radius:8px;color:var(--text-body);background:var(--chip-bg,transparent);font-size: var(--font-15)}.policy{display:grid;grid-template-columns:auto auto;align-items:center;column-gap:6px;color:var(--grid-accent);font-size: var(--font-15)}.policy small{grid-column:2;color:var(--text-soft);font-size: var(--font-lg)}.compact{min-height:52px;padding:9px 12px}.compact .terms span:nth-child(n+3){display:none}@media(max-width:850px){.profile-banner{align-items:flex-start;flex-wrap:wrap}.terms{order:3;flex-basis:100%;overflow:auto}.policy{margin-left:auto}}@media(max-width:520px){.terms span:nth-child(n+3){display:none}.policy small{display:none}}
</style>
