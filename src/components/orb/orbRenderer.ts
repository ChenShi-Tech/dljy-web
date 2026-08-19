// 液态玻璃球 WebGPU 渲染器 —— 移植自「液态玻璃球编辑器」导出模板的运行时，
// 并按嵌入场景加固：DPR 上限 2、画布不可见/标签页隐藏时暂停帧循环、
// 设备失联与着色器编译错误回调上层降级，destroy() 全量释放。
import shaderSource from './liquidGlassOrb.wgsl?raw'
import { ORB_UNIFORM_INDICES } from './orbPresets'

// 当前 lib.dom 未声明 GPUBufferUsage 全局，取规范固定位掩码：COPY_DST(0x8) | UNIFORM(0x40)
const GPU_BUFFER_USAGE_UNIFORM_DST = 0x48

export type OrbRenderStatus = 'running' | 'unsupported' | 'failed'

export interface OrbRendererOptions {
  /** uniform 种子（buildOrbUniformSeed 产物，渲染器持有副本逐帧覆写宽/高/时间） */
  seed: Float32Array
  /** 状态回调：'unsupported' 时上层应走 CSS 降级 */
  onStatus?: (status: OrbRenderStatus, detail?: string) => void
}

export class LiquidOrbRenderer {
  private readonly canvas: HTMLCanvasElement
  private readonly onStatus?: OrbRendererOptions['onStatus']
  private values: Float32Array
  private device: GPUDevice | null = null
  private context: GPUCanvasContext | null = null
  private uniformBuffer: GPUBuffer | null = null
  private bindGroup: GPUBindGroup | null = null
  private pipeline: GPURenderPipeline | null = null
  private animationFrame = 0
  private startedAt = 0
  private stopped = false
  /** 画布是否值得继续画（可见 + 页面激活），false 时暂停 RAF 但保住 GPU 资源 */
  private visible = true
  private baseSpeed = 1
  private speedScale = 1
  private visibilityBound = false
  private onVisibilityChange = (): void => {
    this.setVisible(this.visible)
  }

  constructor(canvas: HTMLCanvasElement, options: OrbRendererOptions) {
    this.canvas = canvas
    this.onStatus = options.onStatus
    this.values = options.seed.slice()
    this.baseSpeed = options.seed[ORB_UNIFORM_INDICES.speed]
  }

  async start(): Promise<OrbRenderStatus> {
    if (!('gpu' in navigator) || !navigator.gpu) {
      this.fail('unsupported')
      return 'unsupported'
    }
    try {
      const adapter = await navigator.gpu.requestAdapter()
      if (!adapter) {
        this.fail('unsupported', '未找到可用的 WebGPU 适配器')
        return 'unsupported'
      }
      const device = await adapter.requestDevice()
      // lib.dom 未收录 'webgpu' 的 getContext 重载，按规范窄化
      const context = this.canvas.getContext('webgpu') as GPUCanvasContext | null
      if (!context) {
        this.fail('failed', '无法创建 WebGPU 画布上下文')
        return 'failed'
      }
      this.device = device
      this.context = context

      const format = navigator.gpu.getPreferredCanvasFormat()
      context.configure({ device, format, alphaMode: 'premultiplied' })

      const shader = device.createShaderModule({ code: shaderSource })
      const compilation = await shader.getCompilationInfo()
      const errors = compilation.messages.filter((message) => message.type === 'error')
      if (errors.length) {
        this.fail('failed', errors.map((m) => `${m.lineNum}:${m.linePos} ${m.message}`).join('\n'))
        return 'failed'
      }

      const pipeline = device.createRenderPipeline({
        layout: 'auto',
        vertex: { module: shader, entryPoint: 'vs_main' },
        fragment: { module: shader, entryPoint: 'fs_main', targets: [{ format }] },
        primitive: { topology: 'triangle-list' }
      })
      const uniformBuffer = device.createBuffer({
        size: this.values.byteLength,
        usage: GPU_BUFFER_USAGE_UNIFORM_DST
      })
      const bindGroup = device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [{ binding: 0, resource: { buffer: uniformBuffer } }]
      })
      this.pipeline = pipeline
      this.uniformBuffer = uniformBuffer
      this.bindGroup = bindGroup

      device.lost.then((info) => {
        this.fail('failed', `WebGPU 设备已断开：${info.message || info.reason}`)
      })
      device.addEventListener('uncapturederror', (event) => {
        event.preventDefault()
        this.fail('failed', `WebGPU 渲染错误：${event.error instanceof Error ? event.error.message : String(event.error)}`)
      })

      document.addEventListener('visibilitychange', this.onVisibilityChange)
      this.visibilityBound = true
      this.stopped = false
      this.startedAt = performance.now()
      this.animationFrame = requestAnimationFrame(this.frame)
      this.onStatus?.('running')
      return 'running'
    } catch (error) {
      this.fail('failed', error instanceof Error ? error.message : String(error))
      return 'failed'
    }
  }

  /** 切换预设/参数：换一颗种子（宽高时间由帧循环覆写，无需额外处理） */
  updateSeed(seed: Float32Array): void {
    this.values = seed.slice()
    this.baseSpeed = seed[ORB_UNIFORM_INDICES.speed]
    this.applySpeed()
  }

  /** 速度倍率（悬浮提速、生成中加速等状态反馈），1 为预设原速 */
  setSpeedScale(scale: number): void {
    this.speedScale = scale
    this.applySpeed()
  }

  /** 暂停/恢复渲染；不可见时挂起 RAF 但保留管线与 uniform，恢复零成本 */
  setVisible(visible: boolean): void {
    this.visible = visible && !document.hidden
    if (this.stopped) return
    if (this.visible) {
      if (!this.animationFrame) {
        this.startedAt = performance.now() - this.values[ORB_UNIFORM_INDICES.time] * 1000
        this.animationFrame = requestAnimationFrame(this.frame)
      }
    } else {
      cancelAnimationFrame(this.animationFrame)
      this.animationFrame = 0
    }
  }

  destroy(): void {
    this.stopped = true
    if (this.animationFrame) {
      cancelAnimationFrame(this.animationFrame)
      this.animationFrame = 0
    }
    if (this.visibilityBound) {
      document.removeEventListener('visibilitychange', this.onVisibilityChange)
      this.visibilityBound = false
    }
    this.device?.destroy()
    this.device = null
    this.context = null
    this.uniformBuffer = null
    this.bindGroup = null
    this.pipeline = null
  }

  private applySpeed(): void {
    this.values[ORB_UNIFORM_INDICES.speed] = this.baseSpeed * this.speedScale
  }

  private frame = (now: number): void => {
    if (this.stopped || !this.visible) return
    try {
      const device = this.device
      const context = this.context
      if (!device || !context || !this.uniformBuffer || !this.pipeline || !this.bindGroup) return
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      const width = Math.max(1, Math.floor(this.canvas.clientWidth * dpr))
      const height = Math.max(1, Math.floor(this.canvas.clientHeight * dpr))
      if (this.canvas.width !== width || this.canvas.height !== height) {
        this.canvas.width = width
        this.canvas.height = height
      }
      this.values[ORB_UNIFORM_INDICES.width] = width
      this.values[ORB_UNIFORM_INDICES.height] = height
      this.values[ORB_UNIFORM_INDICES.time] = (now - this.startedAt) / 1000
      device.queue.writeBuffer(this.uniformBuffer, 0, this.values)

      const encoder = device.createCommandEncoder()
      const pass = encoder.beginRenderPass({
        colorAttachments: [
          {
            view: context.getCurrentTexture().createView(),
            clearValue: { r: 0, g: 0, b: 0, a: 0 },
            loadOp: 'clear',
            storeOp: 'store'
          }
        ]
      })
      pass.setPipeline(this.pipeline)
      pass.setBindGroup(0, this.bindGroup)
      pass.draw(3)
      pass.end()
      device.queue.submit([encoder.finish()])
      this.animationFrame = requestAnimationFrame(this.frame)
    } catch (error) {
      this.fail('failed', error instanceof Error ? error.message : String(error))
    }
  }

  private fail(status: OrbRenderStatus, detail?: string): void {
    this.destroy()
    this.onStatus?.(status, detail)
  }
}
