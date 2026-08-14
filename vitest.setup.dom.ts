// 组件测试环境 shim（Epic #1702 P1）：仅补 happy-dom 缺失的浏览器 API（无状态 ambient）。
// 严禁放 Element Plus / ElMessage / 应用状态——那些进 src/test/mount.ts 显式 import，
// 保住「每个 spec 自包含」约定（与既有 52 个 node spec 的零全局 setup 纪律一致）。
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
}

if (typeof globalThis.matchMedia === 'undefined') {
  globalThis.matchMedia = () =>
    ({ matches: false, addEventListener() {}, removeEventListener() {} }) as unknown as typeof matchMedia
}
