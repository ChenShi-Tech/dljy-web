<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { GitBranch, LayoutDashboard, LogIn, LogOut, MapPinned, Orbit, ShieldCheck } from 'lucide-vue-next'
import { getInfo, getToken, login, logout } from '@/services/auth'
import { resetCompanyContextToHome } from '@/services/company/companyContext'
import GridGeoAssetsView from '../GridGeoAssetsView.vue'
import GridSpatialCommandView from '../GridSpatialCommandView.vue'
import GridTopologyProviderView from '../GridTopologyProviderView.vue'

const checking = ref(true)
const authenticated = ref(false)
const submitting = ref(false)
const error = ref('')
const form = reactive({ username: 'cgn-admin', password: '', rememberMe: false })
const activeModule = ref<'command' | 'plants' | 'topology'>('command')
const activeView = computed(() => activeModule.value === 'command'
  ? GridSpatialCommandView
  : activeModule.value === 'plants'
    ? GridGeoAssetsView
    : GridTopologyProviderView)

async function restoreSession() {
  if (!getToken()) {
    checking.value = false
    return
  }
  try {
    await getInfo()
    // 独立服务不暴露全量公司目录或公司切换器，只允许登录主体访问自身公司。
    resetCompanyContextToHome()
    authenticated.value = true
  } catch {
    authenticated.value = false
  } finally {
    checking.value = false
  }
}

async function submitLogin() {
  if (!form.username.trim() || !form.password) {
    error.value = '请输入账号和密码'
    return
  }
  submitting.value = true
  error.value = ''
  try {
    await login({ ...form, captchaVerification: 'grid-geo-standalone' })
    resetCompanyContextToHome()
    authenticated.value = true
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '登录失败'
  } finally {
    submitting.value = false
  }
}

async function signOut() {
  await logout()
  form.password = ''
  authenticated.value = false
}

onMounted(restoreSession)
</script>

<template>
  <main class="standalone-grid-geo">
    <div v-if="checking" class="auth-state" role="status" aria-live="polite"><Orbit :size="34" aria-hidden="true" /><span>正在校验空间资产访问权限…</span></div>
    <section v-else-if="!authenticated" class="standalone-login">
      <div class="login-orbit"><Orbit :size="28" aria-hidden="true" /></div>
      <small>GRID GEO · SECURE ACCESS</small>
      <h1>电力地理空间资产</h1>
      <p><ShieldCheck :size="16" aria-hidden="true" /> 独立服务复用 dljy 登录与公司授权，不开放匿名公司资产或拓扑入口。</p>
      <form @submit.prevent="submitLogin">
        <label>账号<input v-model="form.username" autocomplete="username" /></label>
        <label>密码<input v-model="form.password" type="password" autocomplete="current-password" /></label>
        <label class="remember"><input v-model="form.rememberMe" type="checkbox" /> 保持登录</label>
        <div v-if="error" class="login-error" role="alert">{{ error }}</div>
        <button :disabled="submitting" type="submit"><LogIn :size="16" aria-hidden="true" /> {{ submitting ? '正在登录…' : '进入空间资产' }}</button>
      </form>
      <footer>受控目录 · 公司/地区/电网隔离 · 不写生产</footer>
    </section>
    <template v-else>
      <nav class="standalone-module-switch" aria-label="空间资产模块">
        <button type="button" :aria-pressed="activeModule === 'command'" :class="{ active: activeModule === 'command' }" @click="activeModule = 'command'"><LayoutDashboard :size="14" aria-hidden="true" />空间总览</button>
        <button type="button" :aria-pressed="activeModule === 'plants'" :class="{ active: activeModule === 'plants' }" @click="activeModule = 'plants'"><MapPinned :size="14" aria-hidden="true" />电厂分布</button>
        <button type="button" :aria-pressed="activeModule === 'topology'" :class="{ active: activeModule === 'topology' }" @click="activeModule = 'topology'"><GitBranch :size="14" aria-hidden="true" />授权网架</button>
      </nav>
      <button class="standalone-logout" aria-label="退出空间资产" @click="signOut"><LogOut :size="15" aria-hidden="true" /> 退出</button>
      <KeepAlive :max="3"><component :is="activeView" /></KeepAlive>
    </template>
  </main>
</template>

<style scoped>
.standalone-grid-geo {
  position: relative;
  box-sizing: border-box;
  min-height: 100vh;
  padding: 12px;
  background: #010711;
}

.standalone-grid-geo :deep(.grid-geo-shell) {
  height: calc(100vh - 24px);
}

.standalone-grid-geo :deep(.topology-page) {
  min-height: calc(100vh - 24px);
}

.standalone-grid-geo :deep(.command-shell) {
  min-height: calc(100vh - 24px);
}

.auth-state,
.standalone-login {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  color: #dff7ff;
}

.auth-state { display: flex; align-items: center; gap: 12px; color: #86bbce; }
.auth-state svg { color: #31d9ff; animation: spin 2s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }

.standalone-login {
  width: min(390px, calc(100% - 32px));
  padding: 30px;
  border: 1px solid rgba(81, 205, 242, .28);
  border-radius: 20px;
  background: radial-gradient(circle at 80% 0, rgba(49, 217, 255, .16), transparent 38%), linear-gradient(145deg, rgba(6, 26, 45, .98), rgba(2, 12, 25, .98));
  box-shadow: 0 30px 90px rgba(0, 0, 0, .5), inset 0 1px rgba(255, 255, 255, .05);
}
.login-orbit { display: grid; width: 54px; height: 54px; margin-bottom: 18px; place-items: center; color: #31d9ff; border: 1px solid rgba(49, 217, 255, .45); border-radius: 16px; background: rgba(49, 217, 255, .08); }
.standalone-login > small { color: #52c8e9; font-size: var(--font-9); letter-spacing: .2em; }
.standalone-login h1 { margin: 6px 0 10px; font-size: var(--font-23); }
.standalone-login p { display: flex; align-items: flex-start; gap: 8px; margin: 0 0 22px; color: #83adbd; font-size: var(--font-xs); line-height: 1.55; }
.standalone-login p svg { flex: 0 0 auto; color: #6ce3bb; }
.standalone-login form { display: flex; flex-direction: column; gap: 12px; }
.standalone-login label { display: flex; flex-direction: column; gap: 6px; color: #80a5b4; font-size: var(--font-10); }
.standalone-login input:not([type='checkbox']) { height: 42px; padding: 0 12px; color: #e7f9ff; border: 1px solid rgba(94, 180, 215, .22); border-radius: 10px; outline: none; background: rgba(2, 13, 25, .65); }
.standalone-login input:focus { border-color: rgba(49, 217, 255, .6); box-shadow: 0 0 0 3px rgba(49, 217, 255, .08); }
.standalone-login .remember { flex-direction: row; align-items: center; }
.login-error { padding: 8px 10px; color: #ff9f9f; border-radius: 8px; background: rgba(190, 53, 65, .12); font-size: var(--font-10); }
.standalone-login button { display: flex; height: 43px; align-items: center; justify-content: center; gap: 8px; color: #03131d; border: 0; border-radius: 10px; background: linear-gradient(135deg, #64e3ff, #3eb7e9); font-weight: 700; cursor: pointer; }
.standalone-login button:disabled { opacity: .65; cursor: wait; }
.standalone-login footer { margin-top: 18px; color: #537887; font-size: var(--font-9); text-align: center; }
.standalone-logout { position: absolute; z-index: 50; top: 29px; right: 28px; display: inline-flex; height: 31px; align-items: center; gap: 5px; padding: 0 10px; color: #86b6c7; border: 1px solid rgba(104, 193, 225, .18); border-radius: 8px; background: rgba(4, 20, 35, .82); cursor: pointer; }
.standalone-module-switch { position: absolute; z-index: 50; top: 28px; left: 50%; display: flex; padding: 3px; transform: translateX(-50%); border: 1px solid rgba(104, 193, 225, .2); border-radius: 10px; background: rgba(3, 17, 30, .88); box-shadow: 0 12px 28px rgba(0, 5, 16, .34); backdrop-filter: blur(14px); }
.standalone-module-switch button { display: inline-flex; height: 29px; align-items: center; gap: 5px; padding: 0 10px; color: #7298a9; border: 0; border-radius: 7px; background: transparent; font-size: var(--font-10); cursor: pointer; }
.standalone-module-switch button.active { color: #03131d; background: linear-gradient(135deg, #64e3ff, #3eb7e9); }
.standalone-module-switch button:focus-visible, .standalone-logout:focus-visible, .standalone-login button:focus-visible, .standalone-login input:focus-visible { outline: 2px solid #31d9ff; outline-offset: 3px; }

@media (max-width: 620px) {
  .standalone-grid-geo { min-height: 100dvh; }
  .standalone-login { padding: 24px; }
  .standalone-logout { top: 23px; right: 22px; width: 32px; padding: 0; justify-content: center; font-size: 0; }
  .standalone-grid-geo :deep(.profile-banner .policy) { display: none; }
  .standalone-module-switch { top: auto; right: 18px; bottom: calc(18px + env(safe-area-inset-bottom)); left: 18px; justify-content: center; transform: none; }
  .standalone-module-switch button { min-height: 40px; flex: 1; justify-content: center; }
  .standalone-grid-geo :deep(.command-shell) { min-height: calc(100dvh - 24px); }
  .standalone-grid-geo :deep(.command-stage) { height: calc(100dvh - 110px); min-height: calc(100dvh - 110px); }
  .standalone-grid-geo :deep(.scene-rail) { bottom: calc(76px + env(safe-area-inset-bottom)); }
  .standalone-grid-geo :deep(.truth-console) { bottom: calc(144px + env(safe-area-inset-bottom)); }
  .standalone-grid-geo :deep(.selection-card) { bottom: calc(198px + env(safe-area-inset-bottom)); }
  .standalone-grid-geo :deep(.intel-dock) { bottom: calc(260px + env(safe-area-inset-bottom)); }
  .standalone-grid-geo :deep(.command-stage .cesium-viewer-bottom) { bottom: calc(230px + env(safe-area-inset-bottom)) !important; }
}

@media (prefers-reduced-motion: reduce) {
  .auth-state svg { animation: none; }
}
</style>
