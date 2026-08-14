<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import {
  ArrowRight,
  BatteryCharging,
  Bot,
  ChartSpline,
  Gauge,
  Leaf,
  Network,
  Zap
} from 'lucide-vue-next'

type HeroMetric = {
  label: string
  value: string
  detail: string
}

type HeroCapability = {
  title: string
  text: string
}

type HeroActionLink = {
  label: string
  href: string
  detail?: string
  tone?: 'primary' | 'default'
}

const props = withDefaults(defineProps<{
  videoSrc?: string
  posterSrc: string
  brandName?: string
  brandSubtitle?: string
  title: string
  subtitle: string
  description: string
  metrics?: HeroMetric[]
  capabilities?: HeroCapability[]
  featureLinks?: HeroActionLink[]
  primaryActionLabel?: string
  primaryActionHref?: string
  secondaryActionLabel?: string
  secondaryActionHref?: string
}>(), {
  videoSrc: '',
  brandName: 'CGN New Energy',
  brandSubtitle: '清洁能源资产与电力交易协同',
  metrics: () => [],
  capabilities: () => [],
  featureLinks: () => [],
  primaryActionLabel: '查看交易能力',
  primaryActionHref: '/dashboard',
  secondaryActionLabel: '进入登录页',
  secondaryActionHref: '/login'
})

const videoFailed = ref(false)
const reducedMotion = ref(false)
const pointerStyle = ref<Record<string, string>>({
  '--hero-x': '50%',
  '--hero-y': '50%',
  '--hero-tilt-x': '0deg',
  '--hero-tilt-y': '0deg'
})

let motionQuery: MediaQueryList | undefined

const canPlayVideo = computed(() => Boolean(props.videoSrc) && !videoFailed.value && !reducedMotion.value)
const actionLinks = computed<HeroActionLink[]>(() => {
  if (props.featureLinks.length > 0) return props.featureLinks

  return [
    {
      label: props.primaryActionLabel,
      href: props.primaryActionHref,
      detail: '查看行情、预测与策略实验',
      tone: 'primary'
    },
    {
      label: props.secondaryActionLabel,
      href: props.secondaryActionHref,
      detail: '进入账号与权限校验'
    }
  ]
})

function markVideoFailed() {
  videoFailed.value = true
}

function onPointerMove(event: PointerEvent) {
  if (reducedMotion.value) return
  const target = event.currentTarget as HTMLElement
  const rect = target.getBoundingClientRect()
  const x = ((event.clientX - rect.left) / rect.width) * 100
  const y = ((event.clientY - rect.top) / rect.height) * 100
  pointerStyle.value = {
    '--hero-x': `${x.toFixed(2)}%`,
    '--hero-y': `${y.toFixed(2)}%`,
    '--hero-tilt-x': `${((50 - y) / 50).toFixed(2)}deg`,
    '--hero-tilt-y': `${((x - 50) / 60).toFixed(2)}deg`
  }
}

function resetPointer() {
  pointerStyle.value = {
    '--hero-x': '50%',
    '--hero-y': '50%',
    '--hero-tilt-x': '0deg',
    '--hero-tilt-y': '0deg'
  }
}

function syncReducedMotion() {
  reducedMotion.value = Boolean(motionQuery?.matches)
}

onMounted(() => {
  motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
  syncReducedMotion()
  motionQuery.addEventListener('change', syncReducedMotion)
})

onBeforeUnmount(() => {
  motionQuery?.removeEventListener('change', syncReducedMotion)
})
</script>

<template>
  <section
    class="company-hero"
    :style="pointerStyle"
    @pointermove="onPointerMove"
    @pointerleave="resetPointer"
  >
    <div class="company-hero__media" aria-hidden="true">
      <img class="company-hero__poster" :src="posterSrc" alt="" />
      <video
        v-if="canPlayVideo"
        class="company-hero__video"
        :poster="posterSrc"
        autoplay
        muted
        loop
        playsinline
        preload="metadata"
        @error="markVideoFailed"
      >
        <source :src="videoSrc" type="video/mp4" />
      </video>
      <div class="company-hero__veil"></div>
      <div class="company-hero__grid"></div>
      <div class="company-hero__cursor"></div>
      <div class="company-hero__scan"></div>
    </div>

    <div class="company-hero__inner">
      <div class="company-hero__copy">
        <div class="company-hero__brand">
          <span class="company-hero__mark">CGN</span>
          <span>
            <strong>{{ brandName }}</strong>
            <em>{{ brandSubtitle }}</em>
          </span>
        </div>

        <h1>{{ title }}</h1>
        <p class="company-hero__subtitle">{{ subtitle }}</p>
        <p class="company-hero__description">{{ description }}</p>

        <nav class="company-hero__actions" aria-label="页面入口">
          <a
            v-for="link in actionLinks"
            :key="`${link.href}-${link.label}`"
            :class="[
              'company-hero__action',
              link.tone === 'primary' ? 'company-hero__action--primary' : 'company-hero__action--default'
            ]"
            :href="link.href"
          >
            <span>
              <strong>{{ link.label }}</strong>
              <em v-if="link.detail">{{ link.detail }}</em>
            </span>
            <ArrowRight :size="17" />
          </a>
        </nav>

        <dl class="company-hero__metrics">
          <div v-for="metric in metrics" :key="metric.label">
            <dt>{{ metric.label }}</dt>
            <dd>{{ metric.value }}</dd>
            <span>{{ metric.detail }}</span>
          </div>
        </dl>
      </div>

      <aside class="company-hero__panel" aria-label="新能源交易辅助决策能力">
        <div class="company-hero__panel-top">
          <span><Leaf :size="16" /> 风光储接入层</span>
          <strong>96 点</strong>
        </div>

        <svg class="company-hero__curve" viewBox="0 0 520 180" role="img" aria-label="新能源出力与价格预测曲线示意">
          <defs>
            <linearGradient id="companyCurveFill" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stop-color="currentColor" stop-opacity="0.28" />
              <stop offset="100%" stop-color="currentColor" stop-opacity="0" />
            </linearGradient>
          </defs>
          <path
            class="company-hero__curve-fill"
            d="M0,138 C54,126 80,86 130,92 C178,98 186,142 236,128 C284,114 292,58 346,64 C404,70 424,120 520,82 L520,180 L0,180 Z"
          />
          <path
            class="company-hero__curve-main"
            d="M0,138 C54,126 80,86 130,92 C178,98 186,142 236,128 C284,114 292,58 346,64 C404,70 424,120 520,82"
          />
          <path
            class="company-hero__curve-alt"
            d="M0,112 C64,118 88,136 146,132 C220,128 248,82 310,92 C372,102 398,146 520,124"
          />
        </svg>

        <div class="company-hero__capabilities">
          <div v-for="(capability, index) in capabilities" :key="capability.title">
            <span class="company-hero__cap-icon">
              <Zap v-if="index === 0" :size="17" />
              <BatteryCharging v-else-if="index === 1" :size="17" />
              <ChartSpline v-else-if="index === 2" :size="17" />
              <Bot v-else-if="index === 3" :size="17" />
              <Network v-else-if="index === 4" :size="17" />
              <Gauge v-else :size="17" />
            </span>
            <span>
              <strong>{{ capability.title }}</strong>
              <em>{{ capability.text }}</em>
            </span>
          </div>
        </div>
      </aside>
    </div>
  </section>
</template>

<style scoped>
.company-hero {
  --hero-bg: oklch(0.13 0.025 210);
  --hero-ink: oklch(0.97 0.012 185);
  --hero-soft: oklch(0.82 0.04 205);
  --hero-muted: oklch(0.72 0.025 205);
  --hero-line: oklch(0.78 0.07 185 / 0.24);
  --hero-cyan: oklch(0.82 0.13 185);
  --hero-green: oklch(0.78 0.16 155);
  --hero-gold: oklch(0.83 0.13 82);
  position: relative;
  min-height: 100svh;
  overflow: hidden;
  isolation: isolate;
  background: var(--hero-bg);
  color: var(--hero-ink);
}

.company-hero__media {
  position: absolute;
  inset: 0;
  z-index: -2;
  background: var(--hero-bg);
}

.company-hero__poster,
.company-hero__video {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.company-hero__poster {
  transform: scale(1.02);
}

.company-hero__video {
  opacity: 0.92;
}

.company-hero__veil {
  position: absolute;
  inset: 0;
  background:
    linear-gradient(90deg, oklch(0.08 0.025 210 / 0.92) 0%, oklch(0.08 0.025 210 / 0.72) 34%, oklch(0.08 0.025 210 / 0.28) 70%, oklch(0.08 0.025 210 / 0.08) 100%),
    linear-gradient(0deg, oklch(0.07 0.025 210 / 0.92) 0%, oklch(0.07 0.025 210 / 0.12) 42%, transparent 72%),
    radial-gradient(circle at 24% 22%, oklch(0.82 0.13 185 / 0.22), transparent 34%);
}

.company-hero__grid,
.company-hero__cursor,
.company-hero__scan {
  position: absolute;
  inset: 0;
  pointer-events: none;
}

.company-hero__grid {
  background-image:
    linear-gradient(90deg, oklch(0.8 0.08 185 / 0.07) 1px, transparent 1px),
    linear-gradient(0deg, oklch(0.8 0.08 185 / 0.055) 1px, transparent 1px);
  background-size: 96px 96px;
  mask-image: linear-gradient(90deg, black, transparent 76%);
}

.company-hero__cursor {
  background:
    radial-gradient(circle at var(--hero-x) var(--hero-y), oklch(0.82 0.13 185 / 0.26), transparent 17rem),
    radial-gradient(circle at calc(var(--hero-x) + 8%) calc(var(--hero-y) + 5%), oklch(0.78 0.16 155 / 0.13), transparent 22rem);
  mix-blend-mode: screen;
  transition: background 0.16s ease-out;
}

.company-hero__scan {
  background: linear-gradient(90deg, transparent, oklch(0.82 0.13 185 / 0.12), transparent);
  width: 34%;
  transform: translateX(-120%) skewX(-12deg);
  animation: company-scan 9s ease-in-out infinite;
}

.company-hero__inner {
  width: min(1180px, calc(100% - 48px));
  min-height: 100svh;
  margin: 0 auto;
  padding: clamp(44px, 7vw, 96px) 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(320px, 440px);
  align-items: center;
  gap: clamp(36px, 6vw, 92px);
}

.company-hero__copy {
  max-width: 720px;
}

.company-hero__brand {
  display: inline-flex;
  align-items: center;
  gap: 13px;
  margin-bottom: clamp(30px, 5vw, 58px);
}

.company-hero__mark {
  width: 58px;
  height: 58px;
  display: grid;
  place-items: center;
  border: 1px solid oklch(0.82 0.13 185 / 0.36);
  border-radius: 16px;
  background: oklch(0.12 0.04 190 / 0.72);
  color: var(--hero-cyan);
  font-weight: 800;
  box-shadow: 0 18px 44px oklch(0 0 0 / 0.26);
}

.company-hero__brand strong,
.company-hero__brand em {
  display: block;
  font-style: normal;
}

.company-hero__brand strong {
  font-size: 1.05rem;
  letter-spacing: 0.02em;
}

.company-hero__brand em {
  margin-top: 3px;
  color: var(--hero-muted);
  font-size: 0.78rem;
}

.company-hero h1 {
  max-width: 12ch;
  margin: 0;
  color: var(--hero-ink);
  font-size: clamp(3rem, 7.4vw, 6rem);
  line-height: 0.95;
  letter-spacing: 0;
  text-wrap: balance;
}

.company-hero__subtitle {
  max-width: 760px;
  margin: 24px 0 0;
  color: oklch(0.88 0.045 188);
  font-size: clamp(1.2rem, 2vw, 1.58rem);
  line-height: 1.42;
  text-wrap: pretty;
}

.company-hero__description {
  max-width: 66ch;
  margin: 18px 0 0;
  color: var(--hero-soft);
  font-size: 1rem;
  line-height: 1.8;
  text-wrap: pretty;
}

.company-hero__actions {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  max-width: 680px;
  margin-top: 34px;
}

.company-hero__action {
  min-width: 0;
  min-height: 74px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  border-radius: 8px;
  padding: 14px 16px;
  text-decoration: none;
  border: 1px solid var(--hero-line);
  transition: transform 0.18s ease, border-color 0.18s ease, background 0.18s ease;
}

.company-hero__action strong,
.company-hero__action em {
  display: block;
  min-width: 0;
  font-style: normal;
}

.company-hero__action strong {
  color: inherit;
  font-size: 0.98rem;
  font-weight: 760;
  line-height: 1.25;
}

.company-hero__action em {
  margin-top: 5px;
  color: oklch(0.82 0.035 202 / 0.82);
  font-size: 0.78rem;
  line-height: 1.45;
}

.company-hero__action svg {
  flex: 0 0 auto;
}

.company-hero__action--primary {
  color: oklch(0.14 0.04 190);
  background: linear-gradient(135deg, var(--hero-cyan), var(--hero-green));
  box-shadow: 0 18px 46px oklch(0.78 0.16 155 / 0.26);
}

.company-hero__action--primary em {
  color: oklch(0.22 0.035 190 / 0.78);
}

.company-hero__action--default {
  color: var(--hero-ink);
  background: oklch(0.12 0.03 210 / 0.5);
}

.company-hero__action:hover {
  transform: translateY(-2px);
}

.company-hero__action--default:hover {
  border-color: oklch(0.82 0.13 185 / 0.52);
  background: oklch(0.16 0.035 210 / 0.62);
}

.company-hero__metrics {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 14px;
  max-width: 720px;
  margin: 40px 0 0;
}

.company-hero__metrics div {
  min-width: 0;
  border-top: 1px solid var(--hero-line);
  padding-top: 14px;
}

.company-hero__metrics dt,
.company-hero__metrics span {
  color: var(--hero-muted);
  font-size: 0.78rem;
}

.company-hero__metrics dd {
  margin: 7px 0 3px;
  color: var(--hero-ink);
  font-size: clamp(1.45rem, 3vw, 2.2rem);
  font-weight: 760;
  line-height: 1;
  font-variant-numeric: tabular-nums;
}

.company-hero__panel {
  position: relative;
  border: 1px solid oklch(0.8 0.07 185 / 0.22);
  border-radius: 22px;
  padding: 22px;
  background:
    linear-gradient(180deg, oklch(0.16 0.035 205 / 0.86), oklch(0.1 0.03 210 / 0.66)),
    oklch(0.12 0.03 210 / 0.7);
  box-shadow: 0 30px 80px oklch(0 0 0 / 0.32);
  transform: perspective(900px) rotateX(var(--hero-tilt-x)) rotateY(var(--hero-tilt-y));
  transition: transform 0.18s ease-out;
  overflow: hidden;
}

.company-hero__panel::before {
  content: '';
  position: absolute;
  inset: 0;
  background:
    radial-gradient(circle at var(--hero-x) var(--hero-y), oklch(0.82 0.13 185 / 0.18), transparent 16rem),
    linear-gradient(135deg, oklch(0.82 0.13 185 / 0.12), transparent 36%);
  pointer-events: none;
}

.company-hero__panel-top,
.company-hero__curve,
.company-hero__capabilities {
  position: relative;
}

.company-hero__panel-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  color: var(--hero-muted);
  font-size: 0.84rem;
}

.company-hero__panel-top span {
  display: inline-flex;
  align-items: center;
  gap: 7px;
}

.company-hero__panel-top strong {
  color: var(--hero-gold);
  font-size: 0.9rem;
}

.company-hero__curve {
  width: 100%;
  margin: 24px 0 18px;
  color: var(--hero-cyan);
}

.company-hero__curve-fill {
  fill: url(#companyCurveFill);
}

.company-hero__curve-main,
.company-hero__curve-alt {
  fill: none;
  stroke-linecap: round;
}

.company-hero__curve-main {
  stroke: currentColor;
  stroke-width: 5;
  filter: drop-shadow(0 0 10px oklch(0.82 0.13 185 / 0.38));
  stroke-dasharray: 720;
  animation: company-curve 8s ease-in-out infinite;
}

.company-hero__curve-alt {
  stroke: var(--hero-green);
  stroke-width: 2.5;
  opacity: 0.72;
  stroke-dasharray: 6 12;
}

.company-hero__capabilities {
  display: grid;
  gap: 12px;
}

.company-hero__capabilities div {
  display: grid;
  grid-template-columns: 38px 1fr;
  gap: 10px;
  align-items: start;
  padding: 12px 0;
  border-top: 1px solid oklch(0.8 0.07 185 / 0.16);
}

.company-hero__cap-icon {
  width: 34px;
  height: 34px;
  display: grid;
  place-items: center;
  border-radius: 11px;
  color: var(--hero-cyan);
  background: oklch(0.82 0.13 185 / 0.12);
}

.company-hero__capabilities strong,
.company-hero__capabilities em {
  display: block;
  font-style: normal;
}

.company-hero__capabilities strong {
  color: var(--hero-ink);
  font-size: 0.94rem;
}

.company-hero__capabilities em {
  margin-top: 4px;
  color: var(--hero-muted);
  font-size: 0.78rem;
  line-height: 1.55;
}

@keyframes company-scan {
  0%, 16% { transform: translateX(-120%) skewX(-12deg); opacity: 0; }
  30% { opacity: 1; }
  62% { transform: translateX(330%) skewX(-12deg); opacity: 0.6; }
  100% { transform: translateX(330%) skewX(-12deg); opacity: 0; }
}

@keyframes company-curve {
  0% { stroke-dashoffset: 720; }
  45%, 70% { stroke-dashoffset: 0; }
  100% { stroke-dashoffset: -720; }
}

@media (max-width: 980px) {
  .company-hero__inner {
    grid-template-columns: 1fr;
    align-items: start;
    padding-top: 44px;
  }

  .company-hero__panel {
    max-width: 620px;
  }

  .company-hero__veil {
    background:
      linear-gradient(180deg, oklch(0.08 0.025 210 / 0.9) 0%, oklch(0.08 0.025 210 / 0.58) 44%, oklch(0.08 0.025 210 / 0.9) 100%),
      radial-gradient(circle at 30% 18%, oklch(0.82 0.13 185 / 0.22), transparent 38%);
  }
}

@media (max-width: 680px) {
  .company-hero__inner {
    width: min(100% - 32px, 1180px);
    padding: 30px 0 36px;
    gap: 26px;
  }

  .company-hero__brand {
    margin-bottom: 28px;
  }

  .company-hero__brand em {
    max-width: 210px;
  }

  .company-hero h1 {
    font-size: clamp(2.55rem, 16vw, 4rem);
  }

  .company-hero__subtitle {
    font-size: 1.05rem;
  }

  .company-hero__metrics {
    grid-template-columns: 1fr;
    gap: 12px;
    margin-top: 30px;
  }

  .company-hero__actions {
    grid-template-columns: 1fr;
  }

  .company-hero__panel {
    border-radius: 18px;
    padding: 18px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .company-hero *,
  .company-hero *::before,
  .company-hero *::after {
    animation: none !important;
    transition-duration: 0.01ms !important;
  }

  .company-hero__video,
  .company-hero__scan,
  .company-hero__cursor {
    display: none;
  }

  .company-hero__panel {
    transform: none;
  }
}
</style>
