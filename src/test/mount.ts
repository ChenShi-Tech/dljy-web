// 组件 spec 共享挂载辅助（Epic #1702 P1）：默认装 Element Plus（el-* 组件需要）+ transition stub。
// 显式 import（非全局 setup），保住「每个 spec 自包含」约定；需覆盖时传 global.plugins/stubs 合并。
import { mount as vtjMount } from '@vue/test-utils'
import type { MountingOptions } from '@vue/test-utils'
import type { Component } from 'vue'
import ElementPlus from 'element-plus'

export function mount(component: Component, options: MountingOptions<any> = {}) {
  return vtjMount(component, {
    ...options,
    global: {
      // 先展开 options.global（基础）再写合并后的 plugins/stubs——顺序反了会让传入项覆盖默认（codex P2 #1712）
      ...options.global,
      plugins: [ElementPlus, ...(options.global?.plugins ?? [])],
      stubs: { transition: true, ...(options.global?.stubs ?? {}) }
    }
  })
}
