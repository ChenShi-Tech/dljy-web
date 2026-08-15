declare module '*.vue' {
  import type { DefineComponent } from 'vue'

  const component: DefineComponent<Record<string, unknown>, Record<string, unknown>, unknown>
  export default component
}

/** Vite `?raw` 原样字符串导入（液态玻璃球 WGSL 着色器等） */
declare module '*.wgsl?raw' {
  const content: string
  export default content
}
