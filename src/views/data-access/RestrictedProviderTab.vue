<script setup lang="ts">
// 数据源接入 · 受控接入 tab（Epic #1893 / Issue #1896）。
//
// 授权网架 Provider 等需要数据 Owner 亲自交付、不得在浏览器粘贴或推测的数据源。
// 当前只建立 Provider 契约和受控空态。
import { nextTick, onMounted } from 'vue'
import { ArrowRight, GitBranch, ShieldCheck } from 'lucide-vue-next'

onMounted(async () => {
  if (new URLSearchParams(window.location.search).get('section') !== 'grid-topology') return
  await nextTick()
  document.querySelector('#grid-topology')?.scrollIntoView({
    behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
    block: 'center',
  })
})
</script>

<template>
  <section id="grid-topology" class="topology-card" tabindex="-1" aria-labelledby="grid-topology-title">
    <div class="topology-card-head">
      <span class="topology-icon"><GitBranch :size="20" aria-hidden="true" /></span>
      <div>
        <small>RESTRICTED PROVIDER</small>
        <h3 id="grid-topology-title">授权网架 Provider</h3>
      </div>
      <span class="topology-state">等待授权数据包</span>
    </div>
    <p>
      当前只建立 Provider 契约和受控空态，不接受在浏览器粘贴线路或推测坐标。
      正式接入必须由数据 Owner 提供拓扑版本、WGS84/源 CRS、许可与授权编号、设备稳定 ID、权威几何及公司/地区/角色 ACL，随后在服务端私有 Provider 中注册。
    </p>
    <div class="topology-guards">
      <span><ShieldCheck :size="13" aria-hidden="true" />跨公司/地区/电网 fail-closed</span>
      <span><ShieldCheck :size="13" aria-hidden="true" />零推测坐标与连线</span>
      <span><ShieldCheck :size="13" aria-hidden="true" />只读 · 不写生产</span>
    </div>
    <RouterLink class="topology-link" to="/grid-assets/topology">
      打开授权网架接入舱 <ArrowRight :size="14" aria-hidden="true" />
    </RouterLink>
  </section>
</template>

<style scoped>
.topology-card {
  scroll-margin-top: 88px;
  padding: 24px 26px;
  border: 1px solid var(--el-border-color-light);
  border-radius: 16px;
  background:
    radial-gradient(circle at 92% 0, rgba(34, 211, 238, .1), transparent 36%),
    var(--el-bg-color);
}
.topology-card:focus-visible { outline: 2px solid #22b8cf; outline-offset: 3px; }
.topology-card-head { display: flex; align-items: center; gap: 11px; }
.topology-icon { display: grid; width: 40px; height: 40px; place-items: center; color: #0891b2; border: 1px solid rgba(8, 145, 178, .24); border-radius: 11px; background: rgba(8, 145, 178, .08); }
.topology-card-head small { display: block; color: #0891b2; font-size: 9px; font-weight: 800; letter-spacing: .14em; }
.topology-card-head h3 { margin: 2px 0 0; color: var(--el-text-color-primary); font-size: 16px; }
.topology-state { margin-left: auto; padding: 4px 9px; color: #9a6700; border: 1px solid rgba(217, 153, 24, .28); border-radius: 999px; background: rgba(245, 184, 58, .1); font-size: 11px; }
.topology-card > p { max-width: 980px; margin: 13px 0 10px; color: var(--el-text-color-secondary); font-size: 12.5px; line-height: 1.75; }
.topology-guards { display: flex; flex-wrap: wrap; gap: 7px; }
.topology-guards span { display: inline-flex; align-items: center; gap: 5px; padding: 6px 8px; color: var(--el-text-color-secondary); border: 1px solid var(--el-border-color-light); border-radius: 8px; font-size: 11px; }
.topology-guards svg { color: #159570; }
.topology-link { display: inline-flex; align-items: center; gap: 6px; margin-top: 14px; color: #087f9c; font-size: 12px; font-weight: 700; text-decoration: none; }
.topology-link:hover { color: #0e7490; text-decoration: underline; text-underline-offset: 3px; }
.topology-link:focus-visible { outline: 2px solid #22b8cf; outline-offset: 3px; border-radius: 3px; }
@media (max-width: 560px) { .topology-state { display: none; } }
</style>
