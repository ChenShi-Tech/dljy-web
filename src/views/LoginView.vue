<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import type { FormInstance, FormRules } from 'element-plus'
import {
  Lock, UserRound, ArrowRight,
  Activity, Bot, Sparkles, ShieldCheck
} from 'lucide-vue-next'
import loginPosterSrc from '../assets/login/power-market-quant-dashboard.png'
import BrandEmblem from '@/components/common/BrandEmblem.vue'
import { ApiError } from '@/services/api'
import { changePassword, login, type AuthUser } from '@/services/auth'
import { canAccessPath, firstAccessiblePath } from '@/services/governance'
import { requiresStanceSelection } from '@/services/stance/stanceContext'

const loginVideoModules = import.meta.glob('../assets/login/power-market-login-loop.mp4', {
  eager: true,
  query: '?url',
  import: 'default'
})
const loginVideoSrc = Object.values(loginVideoModules)[0] as string | undefined
const loginParticles = Array.from({ length: 16 }, (_, index) => index)
const defaultMotionStyle = {
  '--cursor-x': '66%',
  '--cursor-y': '42%',
  '--media-shift-x': '0px',
  '--media-shift-y': '0px',
  '--tilt-x': '0deg',
  '--tilt-y': '0deg'
}

const router = useRouter()
const route = useRoute()

const formRef = ref<FormInstance>()
const form = ref({
  username: '',
  password: '',
  rememberMe: false
})
const loading = ref(false)
// 开发期跳过滑块验证：dev server 下默认关（每次 agent/自动化登录都会被滑块挡住），
// 生产构建默认开；任何模式下显式置 VITE_DISABLE_LOGIN_CAPTCHA=1 也可关闭。
// 后端不校验 captchaVerification（纯前端演示门），跳过不影响鉴权。
const LOGIN_CAPTCHA_DISABLED =
  import.meta.env.DEV || import.meta.env.VITE_DISABLE_LOGIN_CAPTCHA === '1'
const showCaptcha = ref(false)
const captchaPassed = ref(false)
const showChangePassword = ref(false)
const pendingLoginUser = ref<AuthUser | null>(null)
const changePasswordRef = ref<FormInstance>()
const changePasswordForm = ref({
  oldPassword: '',
  newPassword: '',
  confirmPassword: ''
})
const loginMotionStyle = ref<Record<string, string>>({ ...defaultMotionStyle })
const reducedMotion = ref(false)
const videoFailed = ref(false)

// 当前时间(终端状态栏,示意用途,不涉及业务数据)
const clock = ref('')
let clockTimer: number | undefined
let motionPreferenceCleanup: (() => void) | undefined
let pointerFrame = 0
let pendingPointer: { clientX: number; clientY: number; target: HTMLElement } | undefined
function tickClock() {
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  clock.value = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`
}

onMounted(() => {
  tickClock()
  clockTimer = window.setInterval(tickClock, 1000)
  const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
  setReducedMotion(mediaQuery.matches)
  const onMotionPreferenceChange = (event: MediaQueryListEvent) => setReducedMotion(event.matches)
  mediaQuery.addEventListener('change', onMotionPreferenceChange)
  motionPreferenceCleanup = () => mediaQuery.removeEventListener('change', onMotionPreferenceChange)
})
onBeforeUnmount(() => {
  if (clockTimer) window.clearInterval(clockTimer)
  if (pointerFrame) window.cancelAnimationFrame(pointerFrame)
  motionPreferenceCleanup?.()
})

function setReducedMotion(matches: boolean) {
  reducedMotion.value = matches
  if (matches) {
    resetLoginMotion()
  }
}

function onLoginPointerMove(event: PointerEvent) {
  if (reducedMotion.value || event.pointerType === 'touch') return
  pendingPointer = {
    clientX: event.clientX,
    clientY: event.clientY,
    target: event.currentTarget as HTMLElement
  }
  if (pointerFrame) return
  pointerFrame = window.requestAnimationFrame(() => {
    pointerFrame = 0
    if (!pendingPointer) return
    applyLoginMotion(pendingPointer)
    pendingPointer = undefined
  })
}

function applyLoginMotion(pointer: { clientX: number; clientY: number; target: HTMLElement }) {
  const rect = pointer.target.getBoundingClientRect()
  const x = clamp(((pointer.clientX - rect.left) / rect.width) * 100, 0, 100)
  const y = clamp(((pointer.clientY - rect.top) / rect.height) * 100, 0, 100)
  const dx = (x - 50) / 50
  const dy = (y - 50) / 50
  loginMotionStyle.value = {
    '--cursor-x': `${x.toFixed(2)}%`,
    '--cursor-y': `${y.toFixed(2)}%`,
    '--media-shift-x': `${(-dx * 16).toFixed(2)}px`,
    '--media-shift-y': `${(-dy * 10).toFixed(2)}px`,
    '--tilt-x': `${(-dy * 2.8).toFixed(2)}deg`,
    '--tilt-y': `${(dx * 3.8).toFixed(2)}deg`
  }
}

function resetLoginMotion() {
  pendingPointer = undefined
  loginMotionStyle.value = { ...defaultMotionStyle }
}

function markVideoFailed() {
  videoFailed.value = true
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

const loginRules: FormRules = {
  username: [
    {
      validator: (_rule, value, callback) => {
        const username = String(value ?? '').trim()
        if (!username) {
          callback(new Error('请输入账号'))
          return
        }
        if (username.length > 32) {
          callback(new Error('账号不能超过 32 个字符'))
          return
        }
        callback()
      },
      trigger: ['blur', 'change']
    }
  ],
  password: [
    {
      validator: (_rule, value, callback) => {
        const password = String(value ?? '')
        if (!password.trim()) {
          callback(new Error('请输入密码'))
          return
        }
        if (password.length > 64) {
          callback(new Error('密码不能超过 64 个字符'))
          return
        }
        callback()
      },
      trigger: ['blur', 'change']
    }
  ]
}

const passwordRules: FormRules = {
  oldPassword: [{ required: true, message: '请输入旧密码', trigger: 'blur' }],
  newPassword: [
    {
      validator: (_rule, value, callback) => {
        const password = String(value ?? '')
        if (password.length < 8) {
          callback(new Error('新密码至少 8 位'))
          return
        }
        if (!/[a-zA-Z]/.test(password) || !/\d/.test(password)) {
          callback(new Error('新密码必须包含字母和数字'))
          return
        }
        callback()
      },
      trigger: ['blur', 'change']
    }
  ],
  confirmPassword: [
    {
      validator: (_rule, value, callback) => {
        if (String(value ?? '') !== changePasswordForm.value.newPassword) {
          callback(new Error('两次输入的新密码不一致'))
          return
        }
        callback()
      },
      trigger: ['blur', 'change']
    }
  ]
}

function onUsernameInput() {
  resetCaptcha()
}

function onPasswordInput() {
  resetCaptcha()
}

function resolveLoginTarget(roleUser: Awaited<ReturnType<typeof login>>['user']) {
  const redirect = typeof route.query.redirect === 'string' ? route.query.redirect : ''
  // 多立场账号未选立场 → 先落立场选择页（#2193），回跳目标透传。
  // login() 内部已随 persistAuthUser 同步过立场集合，此处读到的是最新状态。
  if (requiresStanceSelection()) {
    return { path: '/select-stance', query: redirect ? { redirect } : {} }
  }
  // 判权按路径（canAccessPath 的 normalizePath 自会剥 query/hash）：守卫存的 redirect 是
  // fullPath（含 ?tab=/?mod= 等页面状态 query），路径有权即放行完整深链。
  if (redirect && canAccessPath(redirect, roleUser)) {
    return redirect
  }
  return firstAccessiblePath(roleUser)
}

async function validateLoginForm() {
  const valid = await formRef.value?.validate().catch(() => false)
  if (!valid) {
    ElMessage.error('请先完善登录信息')
    return false
  }
  form.value.username = form.value.username.trim()
  return true
}

// 滑块验证：pointer 拖动，直观可靠
const trackRef = ref<HTMLElement | null>(null)
const dragX = ref(0)
const HANDLE_W = 44
let dragging = false
let startX = 0
let startLeft = 0
let maxX = 0

function onPointerDown(e: PointerEvent) {
  if (captchaPassed.value) return
  dragging = true
  startX = e.clientX
  startLeft = dragX.value
  maxX = (trackRef.value?.clientWidth ?? 300) - HANDLE_W
  ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
}
function onPointerMove(e: PointerEvent) {
  if (!dragging) return
  dragX.value = Math.max(0, Math.min(maxX, startLeft + (e.clientX - startX)))
}
function onPointerUp() {
  if (!dragging) return
  dragging = false
  if (dragX.value >= maxX - 4) {
    dragX.value = maxX
    captchaPassed.value = true
    window.setTimeout(() => {
      showCaptcha.value = false
      submitLogin()
    }, 280)
  } else {
    dragX.value = 0
  }
}
function resetCaptcha() {
  captchaPassed.value = false
  dragX.value = 0
  dragging = false
}

async function openCaptcha() {
  if (loading.value) return
  if (!(await validateLoginForm())) {
    return
  }
  resetCaptcha()
  if (LOGIN_CAPTCHA_DISABLED) {
    captchaPassed.value = true
    await submitLogin()
    return
  }
  showCaptcha.value = true
}

async function submitLogin() {
  if (!captchaPassed.value) {
    ElMessage.warning('请先完成安全验证')
    return
  }
  loading.value = true
  try {
    const result = await login({ ...form.value, captchaVerification: 'mock-captcha-ok' })
    if (result.resetPwdFlag || result.user.mustChangePassword) {
      pendingLoginUser.value = result.user
      changePasswordForm.value = {
        oldPassword: form.value.password,
        newPassword: '',
        confirmPassword: ''
      }
      showChangePassword.value = true
      ElMessage.warning('请先修改初始或临时密码')
      return
    }
    ElMessage.success('登录成功')
    router.push(resolveLoginTarget(result.user))
  } catch (error) {
    ElMessage.error(loginErrorMessage(error))
    resetCaptcha()
  } finally {
    loading.value = false
  }
}

async function submitChangePassword() {
  const valid = await changePasswordRef.value?.validate().catch(() => false)
  if (!valid) return
  loading.value = true
  try {
    const info = await changePassword({ ...changePasswordForm.value })
    showChangePassword.value = false
    ElMessage.success('密码已修改')
    router.push(resolveLoginTarget(info.user))
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '修改密码失败')
  } finally {
    loading.value = false
  }
}

function showForgotPasswordHint() {
  ElMessage.info('请联系系统管理员重置密码')
}

function loginErrorMessage(error: unknown) {
  if (error instanceof ApiError) {
    if (error.code === 423) {
      return error.lockedUntil ? `账号已锁定，解锁时间：${formatDate(error.lockedUntil)}` : error.message
    }
    if (typeof error.remainingAttempts === 'number') {
      return `${error.message}，剩余 ${error.remainingAttempts} 次`
    }
  }
  return error instanceof Error ? error.message : '登录失败'
}

function formatDate(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('zh-CN', { hour12: false })
}
</script>

<template>
  <div class="lp" :style="loginMotionStyle" @pointermove="onLoginPointerMove" @pointerleave="resetLoginMotion">
    <!-- 氛围层：视频背景 + 坐标网格 + 示意行情曲线 + 鼠标扫描场 -->
    <div class="lp-bg" aria-hidden="true">
      <div class="lp-media">
        <div class="lp-bg-image" :style="{ backgroundImage: `url(${loginPosterSrc})` }"></div>
        <video
          v-if="loginVideoSrc && !videoFailed && !reducedMotion"
          class="lp-bg-video"
          :poster="loginPosterSrc"
          autoplay
          muted
          loop
          playsinline
          preload="metadata"
          @error="markVideoFailed"
        >
          <source :src="loginVideoSrc" type="video/mp4" />
        </video>
      </div>
      <div class="lp-grid"></div>
      <div class="lp-cursor-field"></div>
      <div class="lp-data-field"></div>
      <div class="lp-particles">
        <i v-for="particle in loginParticles" :key="particle"></i>
      </div>
      <div class="lp-sweep"></div>
      <svg class="lp-wave" viewBox="0 0 1200 320" preserveAspectRatio="xMidYMax slice">
        <defs>
          <linearGradient id="lpArea" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="var(--teal)" stop-opacity="0.20" />
            <stop offset="100%" stop-color="var(--teal)" stop-opacity="0" />
          </linearGradient>
        </defs>
        <path
          class="lp-wave-area"
          d="M0,232 C120,226 220,166 360,146 C460,131 540,190 600,196 C700,206 820,120 900,104 C980,92 1080,168 1200,214 L1200,320 L0,320 Z"
          fill="url(#lpArea)"
        />
        <path
          id="lpCurve"
          class="lp-wave-line"
          d="M0,232 C120,226 220,166 360,146 C460,131 540,190 600,196 C700,206 820,120 900,104 C980,92 1080,168 1200,214"
          fill="none"
        />
        <path
          class="lp-wave-line lp-wave-line--ghost"
          d="M0,256 C140,250 240,214 360,206 C500,196 560,236 640,238 C760,242 840,196 940,182 C1040,168 1110,210 1200,238"
          fill="none"
        />
        <circle class="lp-spark" r="4">
          <animateMotion dur="11s" repeatCount="indefinite" rotate="auto">
            <mpath href="#lpCurve" />
          </animateMotion>
        </circle>
      </svg>
      <div class="lp-vignette"></div>
    </div>

    <div class="lp-stage">
      <!-- 左：终端品牌区 -->
      <aside class="lp-brand">
        <div class="lp-brand-head">
          <span class="lp-brand-badge"><BrandEmblem :size="28" weight="bold" /></span>
          <div class="lp-brand-id">
            <span class="lp-brand-name">电力交易决策</span>
            <span class="lp-brand-sub">SPOT TRADING TERMINAL</span>
          </div>
        </div>

        <div class="lp-headline">
          <h1>电力交易辅助<br />决策支持系统</h1>
          <p>真实生产数据 · 全省现货行情 · AI 预测与智能决策</p>
        </div>

        <ul class="lp-signals">
          <li>
            <span class="lp-sig-ico"><Activity :size="17" /></span>
            <span class="lp-sig-text"><strong>实时行情</strong>现货 96 点价格与负荷</span>
          </li>
          <li>
            <span class="lp-sig-ico"><Bot :size="17" /></span>
            <span class="lp-sig-text"><strong>AI 预测</strong>价格 / 负荷 / 新能源出力</span>
          </li>
          <li>
            <span class="lp-sig-ico"><Sparkles :size="17" /></span>
            <span class="lp-sig-text"><strong>智能决策</strong>一句话直达对应页面</span>
          </li>
        </ul>
      </aside>

      <!-- 右：接入控制台 -->
      <main class="lp-console">
        <section class="lp-card">
          <div class="lp-card-top">
            <span class="lp-secure"><ShieldCheck :size="13" /> 安全接入</span>
            <span class="lp-clock">{{ clock }}</span>
          </div>

          <h2 class="lp-title">欢迎登录</h2>
          <p class="lp-subtitle">登录后按角色加载菜单与数据权限</p>

          <el-form ref="formRef" :model="form" :rules="loginRules" class="lp-form" @submit.prevent>
            <label class="lp-flabel">账号</label>
            <el-form-item prop="username">
              <el-input
                v-model="form.username"
                size="large"
                placeholder="请输入账号"
                class="lp-field"
                autocomplete="username"
                @input="onUsernameInput"
                @keyup.enter="openCaptcha"
              >
                <template #prefix><UserRound :size="17" /></template>
              </el-input>
            </el-form-item>

            <label class="lp-flabel">密码</label>
            <el-form-item prop="password">
              <el-input
                v-model="form.password"
                size="large"
                placeholder="请输入密码"
                show-password
                class="lp-field"
                autocomplete="current-password"
                @input="onPasswordInput"
                @keyup.enter="openCaptcha"
              >
                <template #prefix><Lock :size="17" /></template>
              </el-input>
            </el-form-item>

            <div class="lp-row">
              <el-checkbox v-model="form.rememberMe">保持登录</el-checkbox>
              <a class="lp-link" href="javascript:void(0)" @click="showForgotPasswordHint">忘记密码？</a>
            </div>

            <button type="button" class="lp-submit" :disabled="loading" @click="openCaptcha">
              <span class="lp-submit-text">{{ loading ? '登录中' : '登录' }}</span>
              <ArrowRight v-if="!loading" :size="18" class="lp-submit-arrow" />
              <span v-else class="lp-spinner" aria-hidden="true"></span>
            </button>
          </el-form>

          <div class="lp-divider"><span>其他登录方式</span></div>
          <div class="lp-alt">
            <button type="button" class="lp-alt-btn" title="钉钉登录">
              <span class="lp-dingding">钉</span> 钉钉登录
            </button>
          </div>

          <p class="lp-foot">© 电力交易辅助决策支持系统 · 内部系统请勿外传</p>
        </section>
      </main>
    </div>

    <!-- 滑块验证 -->
    <el-dialog
      v-model="showCaptcha"
      class="lp-modal"
      title="请完成安全验证"
      width="360px"
      append-to-body
      @closed="resetCaptcha"
    >
      <div class="slide-captcha" :class="{ done: captchaPassed }">
        <div class="sc-track" ref="trackRef">
          <div class="sc-fill" :style="{ width: dragX + HANDLE_W + 'px' }"></div>
          <span class="sc-text">{{ captchaPassed ? '验证通过' : '按住滑块拖到最右' }}</span>
          <div
            class="sc-handle"
            :style="{ transform: `translateX(${dragX}px)` }"
            @pointerdown="onPointerDown"
            @pointermove="onPointerMove"
            @pointerup="onPointerUp"
            @pointercancel="onPointerUp"
          >
            <span class="sc-icon">{{ captchaPassed ? '✓' : '›' }}</span>
          </div>
        </div>
        <p class="sc-hint">{{ captchaPassed ? '即将登录…' : '拖动右侧滑块到最右端即可' }}</p>
      </div>
    </el-dialog>

    <el-dialog
      v-model="showChangePassword"
      class="lp-modal"
      title="首次登录修改密码"
      width="420px"
      append-to-body
      :close-on-click-modal="false"
      :show-close="false"
    >
      <div v-if="pendingLoginUser" class="pwd-user">
        <strong>{{ pendingLoginUser.displayName }}</strong>
        <span>{{ pendingLoginUser.username }} · {{ pendingLoginUser.role }}</span>
      </div>
      <el-form ref="changePasswordRef" :model="changePasswordForm" :rules="passwordRules" class="pwd-form" label-position="top">
        <el-form-item label="旧密码" prop="oldPassword">
          <el-input v-model="changePasswordForm.oldPassword" show-password autocomplete="current-password" />
        </el-form-item>
        <el-form-item label="新密码" prop="newPassword">
          <el-input v-model="changePasswordForm.newPassword" show-password autocomplete="new-password" />
        </el-form-item>
        <el-form-item label="确认新密码" prop="confirmPassword">
          <el-input v-model="changePasswordForm.confirmPassword" show-password autocomplete="new-password" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button type="primary" :loading="loading" @click="submitChangePassword">修改并进入系统</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.lp {
  --bg: oklch(0.155 0.017 192);
  --bg-edge: oklch(0.125 0.015 196);
  --s1: oklch(0.205 0.020 193);
  --s2: oklch(0.245 0.022 193);
  --line: oklch(0.31 0.018 193);
  --line-2: oklch(0.42 0.028 188);
  --ink: oklch(0.96 0.006 190);
  --ink-2: oklch(0.82 0.012 190);
  --muted: oklch(0.67 0.014 190);
  --teal: oklch(0.74 0.115 183);
  --teal-2: oklch(0.84 0.12 183);
  --teal-deep: oklch(0.57 0.10 184);
  --cursor-x: 66%;
  --cursor-y: 42%;
  --media-shift-x: 0px;
  --media-shift-y: 0px;
  --tilt-x: 0deg;
  --tilt-y: 0deg;

  position: relative;
  min-height: 100vh;
  min-height: 100svh;
  overflow: hidden;
  background:
    radial-gradient(120% 120% at 14% 8%, oklch(0.22 0.03 188 / 0.55), transparent 46%),
    radial-gradient(120% 130% at 100% 100%, oklch(0.10 0.012 200), var(--bg-edge) 70%),
    var(--bg);
  color: var(--ink);
  font-family: Inter, "PingFang SC", "Microsoft YaHei", system-ui, sans-serif;
}

/* ===== 氛围层 ===== */
.lp-bg {
  position: absolute;
  inset: 0;
  pointer-events: none;
}
.lp-media {
  position: absolute;
  inset: -24px;
  overflow: hidden;
  transform: translate3d(var(--media-shift-x), var(--media-shift-y), 0) scale(1.035);
  transition: transform 0.22s ease-out;
}
.lp-media::after {
  content: '';
  position: absolute;
  inset: 0;
  background:
    linear-gradient(90deg, oklch(0.10 0.012 200 / 0.18), transparent 34%, oklch(0.07 0.01 200 / 0.48) 78%),
    linear-gradient(180deg, oklch(0.08 0.01 200 / 0.16), transparent 34%, oklch(0.07 0.01 200 / 0.46)),
    oklch(0.10 0.012 200 / 0.18);
}
.lp-bg-image,
.lp-bg-video {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  object-position: center;
}
.lp-bg-image {
  background-size: cover;
  background-position: center;
  opacity: 0.48;
  filter: saturate(1.1) contrast(1.03);
}
.lp-bg-video {
  opacity: 0.64;
  filter: saturate(1.08) contrast(1.04) brightness(0.95);
}
.lp-grid {
  position: absolute;
  inset: 0;
  background-image:
    linear-gradient(oklch(0.7 0.05 190 / 0.05) 1px, transparent 1px),
    linear-gradient(90deg, oklch(0.7 0.05 190 / 0.05) 1px, transparent 1px);
  background-size: 46px 46px;
  background-position:
    calc(var(--media-shift-x) * 0.55) calc(var(--media-shift-y) * 0.55),
    calc(var(--media-shift-x) * 0.55) calc(var(--media-shift-y) * 0.55);
  -webkit-mask-image: radial-gradient(120% 90% at 30% 22%, #000 0%, transparent 78%);
  mask-image: radial-gradient(120% 90% at 30% 22%, #000 0%, transparent 78%);
  transition: background-position 0.22s ease-out;
}
.lp-cursor-field {
  position: absolute;
  inset: 0;
  opacity: 0.82;
  background:
    linear-gradient(90deg, transparent calc(var(--cursor-x) - 1px), oklch(0.78 0.13 183 / 0.34) var(--cursor-x), transparent calc(var(--cursor-x) + 1px)),
    linear-gradient(0deg, transparent calc(var(--cursor-y) - 1px), oklch(0.78 0.13 183 / 0.26) var(--cursor-y), transparent calc(var(--cursor-y) + 1px));
  -webkit-mask-image: radial-gradient(340px 260px at var(--cursor-x) var(--cursor-y), #000 0%, transparent 74%);
  mask-image: radial-gradient(340px 260px at var(--cursor-x) var(--cursor-y), #000 0%, transparent 74%);
  transition: opacity 0.2s ease-out;
}
.lp-data-field {
  position: absolute;
  inset: 8% -8% 0;
  opacity: 0.44;
  background:
    repeating-linear-gradient(112deg, transparent 0 34px, oklch(0.74 0.11 184 / 0.07) 35px 36px, transparent 37px 72px),
    repeating-linear-gradient(178deg, transparent 0 86px, oklch(0.82 0.12 183 / 0.08) 87px 88px, transparent 89px 150px);
  transform: translate3d(calc(var(--media-shift-x) * -0.75), calc(var(--media-shift-y) * -0.75), 0) skewY(-8deg);
  -webkit-mask-image: linear-gradient(90deg, #000 0%, #000 62%, transparent 92%);
  mask-image: linear-gradient(90deg, #000 0%, #000 62%, transparent 92%);
  transition: transform 0.22s ease-out;
}
.lp-particles {
  position: absolute;
  inset: 0;
  opacity: 0.78;
  transform: translate3d(calc(var(--media-shift-x) * -1.2), calc(var(--media-shift-y) * -1.2), 0);
  transition: transform 0.22s ease-out;
}
.lp-particles i {
  position: absolute;
  width: 28px;
  height: 2px;
  border-radius: 2px;
  background: linear-gradient(90deg, transparent, oklch(0.8 0.13 183 / 0.78), transparent);
  box-shadow: 0 0 12px oklch(0.74 0.12 183 / 0.4);
  animation: lp-particle 9s linear infinite;
}
.lp-particles i:nth-child(1) { left: 8%; top: 18%; animation-delay: -1s; }
.lp-particles i:nth-child(2) { left: 18%; top: 66%; animation-delay: -4s; }
.lp-particles i:nth-child(3) { left: 26%; top: 38%; animation-delay: -6s; }
.lp-particles i:nth-child(4) { left: 34%; top: 76%; animation-delay: -2s; }
.lp-particles i:nth-child(5) { left: 44%; top: 22%; animation-delay: -7s; }
.lp-particles i:nth-child(6) { left: 52%; top: 62%; animation-delay: -3s; }
.lp-particles i:nth-child(7) { left: 58%; top: 44%; animation-delay: -8s; }
.lp-particles i:nth-child(8) { left: 67%; top: 16%; animation-delay: -5s; }
.lp-particles i:nth-child(9) { left: 74%; top: 72%; animation-delay: -9s; }
.lp-particles i:nth-child(10) { left: 82%; top: 30%; animation-delay: -2.5s; }
.lp-particles i:nth-child(11) { left: 88%; top: 54%; animation-delay: -6.5s; }
.lp-particles i:nth-child(12) { left: 12%; top: 48%; animation-delay: -8.5s; }
.lp-particles i:nth-child(13) { left: 40%; top: 50%; animation-delay: -0.5s; }
.lp-particles i:nth-child(14) { left: 70%; top: 40%; animation-delay: -4.5s; }
.lp-particles i:nth-child(15) { left: 92%; top: 20%; animation-delay: -7.5s; }
.lp-particles i:nth-child(16) { left: 4%; top: 82%; animation-delay: -3.5s; }
@keyframes lp-particle {
  0% { transform: translate3d(-24px, 0, 0) scaleX(0.45); opacity: 0; }
  14% { opacity: 0.75; }
  72% { opacity: 0.75; }
  100% { transform: translate3d(92px, -14px, 0) scaleX(1); opacity: 0; }
}
.lp-wave {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  width: 100%;
  height: min(58vh, 460px);
  opacity: 0.9;
}
.lp-wave-area { transform-origin: bottom; }
.lp-wave-line {
  stroke: var(--teal);
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
  filter: drop-shadow(0 0 6px oklch(0.74 0.12 183 / 0.5));
  stroke-dasharray: 2600;
  stroke-dashoffset: 2600;
  animation: lp-draw 1.6s cubic-bezier(0.16, 1, 0.3, 1) 0.15s forwards;
}
.lp-wave-line--ghost {
  stroke: oklch(0.6 0.06 196);
  stroke-width: 1.25;
  opacity: 0.45;
  filter: none;
  animation-delay: 0.35s;
}
@keyframes lp-draw {
  to { stroke-dashoffset: 0; }
}
.lp-spark {
  fill: var(--teal-2);
  filter: drop-shadow(0 0 8px oklch(0.84 0.13 183 / 0.95));
}
.lp-sweep {
  position: absolute;
  top: 0;
  bottom: 0;
  left: -40%;
  width: 40%;
  background: linear-gradient(90deg, transparent, oklch(0.7 0.08 186 / 0.06), transparent);
  animation: lp-sweep 14s linear infinite;
}
@keyframes lp-sweep {
  0% { left: -40%; }
  100% { left: 140%; }
}
.lp-vignette {
  position: absolute;
  inset: 0;
  background: radial-gradient(110% 80% at 70% 40%, transparent 55%, oklch(0.09 0.01 200 / 0.55) 100%);
}

/* ===== 主舞台 ===== */
.lp-stage {
  position: relative;
  z-index: 1;
  display: grid;
  grid-template-columns: 1.1fr 0.9fr;
  align-items: center;
  gap: 48px;
  max-width: 1160px;
  min-height: 100vh;
  min-height: 100svh;
  margin: 0 auto;
  padding: 48px clamp(24px, 5vw, 72px);
}

/* ===== 左：终端品牌 ===== */
.lp-brand {
  display: flex;
  flex-direction: column;
  gap: 34px;
  max-width: 520px;
}
.lp-brand-head { display: flex; align-items: center; gap: 13px; }
.lp-brand-badge {
  width: 42px; height: 42px; flex: none;
  display: grid; place-items: center;
  border-radius: 11px;
  /* 品牌标识徽标：深蓝底 + 冷白青线稿，与网站图标、顶栏徽标一致 */
  color: #bfe3ec;
  background: linear-gradient(180deg, #0e2440, #050b16);
  box-shadow: inset 0 0 0 1px rgba(108, 201, 219, 0.4), 0 10px 26px -10px rgba(44, 138, 166, 0.8);
}
.lp-brand-id { display: flex; flex-direction: column; line-height: 1.2; }
.lp-brand-name { font-size: var(--font-15); font-weight: 650; letter-spacing: 0.5px; color: var(--ink); }
.lp-brand-sub {
  margin-top: 3px;
  font-family: "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: var(--font-10-5);
  letter-spacing: 0.22em;
  color: var(--teal);
  text-transform: uppercase;
}

.lp-headline h1 {
  margin: 0;
  font-size: clamp(2rem, 1.2rem + 2.4vw, 2.85rem);
  font-weight: 800;
  line-height: 1.16;
  letter-spacing: -0.01em;
  text-wrap: balance;
  color: var(--ink);
}
.lp-headline p {
  margin: 16px 0 0;
  font-size: 0.95rem;
  line-height: 1.6;
  letter-spacing: 0.01em;
  color: var(--ink-2);
}

.lp-signals {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.lp-signals li {
  display: flex;
  align-items: center;
  gap: 13px;
  padding: 13px 15px;
  border: 1px solid var(--line);
  border-radius: 11px;
  background: oklch(0.2 0.02 193 / 0.5);
  backdrop-filter: blur(2px);
  transition: border-color 0.2s, transform 0.2s, background 0.2s;
}
.lp-signals li:hover {
  border-color: var(--line-2);
  background: oklch(0.23 0.022 193 / 0.65);
  transform: translateX(3px);
}
.lp-sig-ico {
  width: 34px; height: 34px; flex: none;
  display: grid; place-items: center;
  border-radius: 9px;
  color: var(--teal-2);
  background: oklch(0.74 0.11 184 / 0.12);
  border: 1px solid oklch(0.74 0.11 184 / 0.24);
}
.lp-sig-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: 0.78rem;
  line-height: 1.45;
  color: var(--muted);
}
.lp-sig-text strong {
  font-size: 0.9rem;
  font-weight: 600;
  color: var(--ink);
  letter-spacing: 0.01em;
}

/* ===== 右：接入控制台 ===== */
.lp-console {
  display: flex;
  align-items: center;
  justify-content: center;
  perspective: 1100px;
  transform: rotateX(var(--tilt-x)) rotateY(var(--tilt-y));
  transform-style: preserve-3d;
  transition: transform 0.2s ease-out;
}
.lp-card {
  width: 100%;
  max-width: 396px;
  padding: 30px 30px 24px;
  border: 1px solid var(--line);
  border-radius: 16px;
  background:
    radial-gradient(120% 100% at var(--cursor-x) 0%, oklch(0.31 0.032 188 / 0.36), transparent 46%),
    linear-gradient(180deg, oklch(0.23 0.022 193 / 0.9), oklch(0.18 0.018 194 / 0.94));
  box-shadow:
    0 30px 70px -34px oklch(0.05 0.01 200 / 0.9),
    inset 0 1px 0 oklch(1 0 0 / 0.05);
  backdrop-filter: blur(14px);
  animation: lp-rise 0.6s cubic-bezier(0.16, 1, 0.3, 1) both;
}
@keyframes lp-rise {
  from { opacity: 0; transform: translateY(16px); }
  to { opacity: 1; transform: none; }
}

.lp-card-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 22px;
  font-family: "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: var(--font-xs);
  letter-spacing: 0.06em;
}
.lp-secure {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  border-radius: 999px;
  color: var(--teal-2);
  background: oklch(0.74 0.11 184 / 0.12);
  border: 1px solid oklch(0.74 0.11 184 / 0.28);
}
.lp-clock {
  color: var(--muted);
  font-variant-numeric: tabular-nums;
}

.lp-title {
  margin: 0;
  font-size: 1.5rem;
  font-weight: 700;
  letter-spacing: 0.01em;
  color: var(--ink);
}
.lp-subtitle {
  margin: 7px 0 24px;
  font-size: 0.82rem;
  line-height: 1.5;
  color: var(--muted);
}

.lp-form {
  --el-color-primary: var(--teal);
  --el-color-danger: oklch(0.72 0.15 30);
  --el-input-bg-color: var(--s2);
  --el-input-text-color: var(--ink);
  --el-input-border-color: transparent;
  --el-input-hover-border-color: transparent;
  --el-text-color-placeholder: var(--muted);
  --el-text-color-regular: var(--ink-2);
  --el-border-radius-base: 10px;
}
.lp-flabel {
  display: block;
  margin-bottom: 7px;
  font-family: "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: var(--font-xs);
  font-weight: 500;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--muted);
}
.lp-form :deep(.el-form-item) {
  margin-bottom: 16px;
}
.lp-form :deep(.el-form-item__error) {
  padding-top: 4px;
  color: oklch(0.76 0.14 32);
}
.lp-field { width: 100%; }
.lp-field :deep(.el-input__wrapper) {
  border-radius: 10px;
  padding: 6px 14px;
  background: var(--s2);
  box-shadow: inset 0 0 0 1px var(--line);
  transition: box-shadow 0.2s, background 0.2s;
}
.lp-field :deep(.el-input__wrapper:hover) {
  box-shadow: inset 0 0 0 1px var(--line-2);
}
.lp-field :deep(.el-input__wrapper.is-focus) {
  background: oklch(0.27 0.024 193);
  box-shadow:
    inset 0 0 0 1.5px var(--teal),
    0 0 0 4px oklch(0.74 0.11 184 / 0.16);
}
.lp-field :deep(.el-input__inner) {
  height: 30px;
  color: var(--ink);
  caret-color: var(--teal-2);
}
/* 浏览器自动填充:盖掉默认的白底高亮,贴合深色风格。
   autofill 时普通 color/background 会被浏览器伪样式覆盖,须用 -webkit-text-fill-color 改字色,
   再用超大 inset 阴影把白底顶成 --s2;transition 延迟背景变化兜底。 */
.lp-field :deep(.el-input__inner:-webkit-autofill),
.lp-field :deep(.el-input__inner:-webkit-autofill:hover),
.lp-field :deep(.el-input__inner:-webkit-autofill:active) {
  -webkit-text-fill-color: var(--ink);
  -webkit-box-shadow: 0 0 0 1000px var(--s2) inset;
  caret-color: var(--teal-2);
  transition: background-color 9999s ease-in-out 0s;
}
.lp-field :deep(.el-input__inner:-webkit-autofill:focus) {
  -webkit-box-shadow: 0 0 0 1000px oklch(0.27 0.024 193) inset;
}
.lp-field :deep(.el-input__prefix) { color: var(--teal); }
.lp-field :deep(.el-input__suffix) { color: var(--muted); }

.lp-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin: 4px 0 22px;
}
.lp-row :deep(.el-checkbox__label) { color: var(--ink-2); font-size: var(--font-md); }
.lp-row :deep(.el-checkbox__inner) {
  background: var(--s2);
  border-color: var(--line-2);
}
.lp-link {
  font-size: var(--font-md);
  color: var(--teal-2);
  text-decoration: none;
  transition: color 0.15s;
}
.lp-link:hover { color: var(--ink); text-decoration: underline; }

.lp-submit {
  position: relative;
  width: 100%;
  height: 48px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 9px;
  border: 0;
  border-radius: 11px;
  color: oklch(0.17 0.03 190);
  font-size: var(--font-15);
  font-weight: 700;
  letter-spacing: 0.32em;
  text-indent: 0.32em;
  cursor: pointer;
  background: linear-gradient(135deg, var(--teal-2), var(--teal));
  box-shadow: 0 14px 30px -12px oklch(0.74 0.12 183 / 0.7), inset 0 1px 0 oklch(1 0 0 / 0.35);
  transition: transform 0.18s, box-shadow 0.18s, filter 0.18s, opacity 0.18s;
}
.lp-submit:hover {
  transform: translateY(-2px);
  filter: brightness(1.05);
  box-shadow: 0 20px 38px -12px oklch(0.78 0.13 183 / 0.85), inset 0 1px 0 oklch(1 0 0 / 0.4);
}
.lp-submit:active { transform: translateY(0); }
.lp-submit:focus-visible {
  outline: 2px solid var(--teal-2);
  outline-offset: 3px;
}
.lp-submit:disabled { opacity: 0.72; cursor: default; transform: none; filter: none; }
.lp-submit-arrow { transition: transform 0.18s; }
.lp-submit:hover:not(:disabled) .lp-submit-arrow { transform: translateX(3px); }
.lp-spinner {
  width: 16px; height: 16px;
  border: 2px solid oklch(0.17 0.03 190 / 0.35);
  border-top-color: oklch(0.17 0.03 190);
  border-radius: 50%;
  animation: lp-spin 0.7s linear infinite;
}
@keyframes lp-spin { to { transform: rotate(360deg); } }

.lp-divider {
  position: relative;
  text-align: center;
  margin: 22px 0 14px;
}
.lp-divider::before {
  content: '';
  position: absolute;
  top: 50%; left: 0; right: 0;
  height: 1px;
  background: var(--line);
}
.lp-divider span {
  position: relative;
  padding: 0 12px;
  background: oklch(0.205 0.02 193);
  font-size: var(--font-sm);
  color: var(--muted);
}
.lp-alt { display: flex; justify-content: center; }
.lp-alt-btn {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 20px;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: var(--s1);
  color: var(--ink-2);
  font-size: var(--font-md);
  cursor: pointer;
  transition: border-color 0.2s, color 0.2s, background 0.2s;
}
.lp-alt-btn:hover { border-color: var(--teal-deep); color: var(--ink); background: var(--s2); }
.lp-dingding {
  width: 22px; height: 22px;
  display: grid; place-items: center;
  border-radius: 6px;
  background: var(--el-color-primary);
  color: #fff;
  font-size: var(--font-md);
  font-weight: 700;
}

.lp-foot {
  margin: 22px 0 0;
  text-align: center;
  font-size: var(--font-xs);
  letter-spacing: 0.02em;
  color: oklch(0.66 0.012 190);
}

/* ===== 滑块验证(对话框内,scoped 作用于 slot 内容) ===== */
.slide-captcha { padding: 4px 2px 2px; }
.sc-track {
  position: relative; height: 46px; border-radius: 10px;
  background: var(--s2, var(--text)); border: 1px solid var(--line, var(--text));
  overflow: hidden; user-select: none; touch-action: none;
}
.sc-fill {
  position: absolute; left: 0; top: 0; height: 100%; width: 44px;
  background: linear-gradient(90deg, var(--teal-deep, var(--primary)), var(--teal-2, var(--primary)));
  border-radius: 10px 0 0 10px;
}
.sc-text {
  position: absolute; inset: 0;
  display: flex; align-items: center; justify-content: center;
  font-size: var(--font-md); color: var(--muted, var(--muted)); pointer-events: none; z-index: 1; letter-spacing: 1px;
}
.slide-captcha.done .sc-text { color: oklch(0.18 0.03 190); font-weight: 600; }
.sc-handle {
  position: absolute; left: 0; top: 0; width: 44px; height: 46px;
  display: flex; align-items: center; justify-content: center;
  background: oklch(0.3 0.02 193); border: 1px solid var(--line-2, var(--text)); border-radius: 10px;
  box-shadow: 0 2px 10px oklch(0 0 0 / 0.35);
  cursor: grab; z-index: 2; touch-action: none;
}
.sc-handle:active { cursor: grabbing; }
.sc-icon { font-size: var(--font-22); font-weight: 700; line-height: 1; color: var(--teal-2, var(--primary)); }
.slide-captcha.done .sc-handle { background: var(--teal, var(--primary)); border-color: var(--teal, var(--primary)); }
.slide-captcha.done .sc-icon { color: oklch(0.18 0.03 190); }
.sc-hint { margin: 12px 0 2px; text-align: center; font-size: var(--font-sm); color: var(--muted, var(--muted)); }

.pwd-user {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-bottom: 14px;
  padding: 10px 12px;
  border: 1px solid oklch(0.74 0.1 184 / 0.3);
  border-radius: 10px;
  background: oklch(0.74 0.1 184 / 0.08);
}
.pwd-user strong { color: var(--teal-2, var(--primary)); }
.pwd-user span { color: var(--muted, var(--muted)); font-size: var(--font-sm); }
.pwd-form :deep(.el-form-item) { margin-bottom: 14px; }

/* ===== 响应式 ===== */
@media (max-width: 920px) {
  .lp-stage {
    grid-template-columns: 1fr;
    gap: 36px;
    padding: 40px clamp(20px, 6vw, 48px);
  }
  .lp-brand { max-width: 560px; margin: 0 auto; }
  .lp-console { justify-content: center; }
  .lp-card { margin: 0 auto; }
}

@media (max-width: 560px) {
  .lp-stage { padding: 28px 18px 36px; gap: 26px; }
  .lp-brand { gap: 24px; }
  .lp-signals li { padding: 11px 13px; }
  .lp-headline p { font-size: 0.9rem; }
  .lp-card { padding: 26px 20px 22px; border-radius: 14px; }
  .lp-wave { height: 40vh; }
  .lp-bg-video { opacity: 0.5; }
  .lp-particles { opacity: 0.45; }
}

@media (max-width: 380px) {
  .lp-submit { letter-spacing: 0.2em; text-indent: 0.2em; }
}

/* ===== 减弱动效 ===== */
@media (prefers-reduced-motion: reduce) {
  .lp-wave-line,
  .lp-card,
  .lp-sweep,
  .lp-media,
  .lp-grid,
  .lp-data-field,
  .lp-particles,
  .lp-particles i,
  .lp-console,
  .lp-submit-arrow,
  .lp-spinner {
    animation: none;
    transition: none;
  }
  .lp-bg-video,
  .lp-cursor-field,
  .lp-data-field,
  .lp-particles {
    display: none;
  }
  .lp-media,
  .lp-console {
    transform: none;
  }
  .lp-wave-line { stroke-dashoffset: 0; }
  .lp-spark { display: none; }
  .lp-signals li:hover { transform: none; }
}
</style>

<!-- 对话框外壳为 Element Plus 渲染、teleport 到 body，需非 scoped 暗色覆盖；以唯一类 .lp-modal 限定，无全局泄漏 -->
<style>
.lp-modal.el-dialog {
  --el-dialog-bg-color: oklch(0.2 0.02 193);
  --el-text-color-primary: oklch(0.96 0.006 190);
  --el-text-color-regular: oklch(0.82 0.012 190);
  --el-color-primary: oklch(0.74 0.115 183);
  --el-color-danger: oklch(0.72 0.15 30);
  --el-input-bg-color: oklch(0.245 0.022 193);
  --el-input-text-color: oklch(0.96 0.006 190);
  --el-text-color-placeholder: oklch(0.67 0.014 190);
  --el-fill-color-blank: oklch(0.245 0.022 193);
  --el-border-color: oklch(0.31 0.018 193);
  border: 1px solid oklch(0.31 0.018 193);
  border-radius: 14px;
  box-shadow: 0 30px 80px -30px oklch(0.04 0.01 200 / 0.9);
}
.lp-modal.el-dialog .el-dialog__title { font-weight: 650; }
.lp-modal.el-dialog .el-dialog__headerbtn .el-dialog__close { color: oklch(0.67 0.014 190); }
.lp-modal.el-dialog .el-dialog__headerbtn:hover .el-dialog__close { color: oklch(0.96 0.006 190); }
.lp-modal.el-dialog .el-input__wrapper {
  background: oklch(0.245 0.022 193);
  box-shadow: inset 0 0 0 1px oklch(0.31 0.018 193);
}
.lp-modal.el-dialog .el-input__wrapper.is-focus {
  box-shadow: inset 0 0 0 1.5px oklch(0.74 0.115 183);
}
.lp-modal.el-dialog .el-input__inner { color: oklch(0.96 0.006 190); }
.lp-modal.el-dialog .el-form-item__label { color: oklch(0.82 0.012 190); }
</style>
