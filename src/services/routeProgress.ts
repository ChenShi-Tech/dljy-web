// 轻量路由切换进度条（无第三方依赖）：懒加载路由 chunk / 守卫耗时期间
// 在页面顶部显示进度反馈，避免"点了没反应"的体感。router/index.ts 中接线。
let bar: HTMLDivElement | null = null
let trickleTimer = 0
let hideTimer = 0
let active = false

function ensureBar(): HTMLDivElement {
  if (bar) return bar
  bar = document.createElement('div')
  bar.setAttribute('role', 'progressbar')
  bar.style.cssText = [
    'position:fixed',
    'top:0',
    'left:0',
    'height:2px',
    'width:0',
    'z-index:99999',
    'pointer-events:none',
    'background:var(--primary, #409eff)',
    'box-shadow:0 0 6px var(--primary, #409eff)',
    'opacity:0',
    'transition:width 0.25s ease, opacity 0.25s ease'
  ].join(';')
  document.body.appendChild(bar)
  return bar
}

export function startRouteProgress() {
  const el = ensureBar()
  active = true
  window.clearTimeout(hideTimer)
  window.clearInterval(trickleTimer)
  el.style.opacity = '1'
  el.style.width = '12%'
  let progress = 12
  // 缓推进度到 85%，等待真正完成
  trickleTimer = window.setInterval(() => {
    progress = Math.min(85, progress + Math.max(1, (85 - progress) * 0.12))
    el.style.width = `${progress}%`
  }, 180)
}

export function finishRouteProgress() {
  if (!active || !bar) return
  active = false
  window.clearInterval(trickleTimer)
  bar.style.width = '100%'
  hideTimer = window.setTimeout(() => {
    if (!bar) return
    bar.style.opacity = '0'
    hideTimer = window.setTimeout(() => {
      if (bar) bar.style.width = '0'
    }, 260)
  }, 120)
}
