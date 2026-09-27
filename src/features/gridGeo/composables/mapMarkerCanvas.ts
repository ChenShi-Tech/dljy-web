/**
 * 场站/聚合的 canvas 图标绘制（#2802 拆分 CesiumPlantMap）。
 *
 * 只依赖 DOM canvas 2D 上下文，不碰 Cesium；绘制参数（光晕、线宽、图标形状）
 * 是跟着 billboard 尺寸调校的观感结果，勿随手调整。
 */
import type { GridGeoPlant } from '../types'

/** 单场站 billboard：圆底 + 风机/光伏线稿，选中态换金色并加强光晕。 */
export function markerCanvas(plant: GridGeoPlant, selected: boolean, metricColor: { toCssColorString(): string }) {
  const color = selected ? '#ffe58a' : metricColor.toCssColorString()
  const canvas = document.createElement('canvas')
  canvas.width = 96
  canvas.height = 96
  const ctx = canvas.getContext('2d')
  if (!ctx) return canvas
  ctx.translate(48, 45)
  ctx.shadowColor = color
  ctx.shadowBlur = selected ? 24 : 15
  ctx.fillStyle = 'rgba(4, 18, 34, .92)'
  ctx.strokeStyle = color
  ctx.lineWidth = selected ? 4 : 3
  ctx.beginPath()
  ctx.arc(0, 0, 34, 0, Math.PI * 2)
  ctx.fill()
  ctx.stroke()
  ctx.shadowBlur = 8
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.lineWidth = 4

  if (plant.plantType === 'wind') {
    ctx.beginPath()
    ctx.arc(0, -2, 6, 0, Math.PI * 2)
    ctx.stroke()
    for (const angle of [-Math.PI / 2, Math.PI / 6, (5 * Math.PI) / 6]) {
      ctx.save()
      ctx.rotate(angle)
      ctx.beginPath()
      ctx.moveTo(5, -2)
      ctx.quadraticCurveTo(19, -11, 27, -4)
      ctx.quadraticCurveTo(18, 2, 5, 2)
      ctx.stroke()
      ctx.restore()
    }
    ctx.beginPath()
    ctx.moveTo(-3, 5)
    ctx.lineTo(-7, 28)
    ctx.moveTo(3, 5)
    ctx.lineTo(7, 28)
    ctx.moveTo(-10, 28)
    ctx.lineTo(10, 28)
    ctx.stroke()
  } else {
    ctx.save()
    ctx.rotate(-0.16)
    ctx.strokeRect(-24, -15, 48, 31)
    for (const x of [-8, 8]) {
      ctx.beginPath()
      ctx.moveTo(x, -15)
      ctx.lineTo(x, 16)
      ctx.stroke()
    }
    ctx.beginPath()
    ctx.moveTo(-24, 0)
    ctx.lineTo(24, 0)
    ctx.stroke()
    ctx.restore()
    ctx.beginPath()
    ctx.moveTo(-7, 19)
    ctx.lineTo(-12, 28)
    ctx.moveTo(7, 19)
    ctx.lineTo(12, 28)
    ctx.moveTo(-17, 28)
    ctx.lineTo(17, 28)
    ctx.stroke()
  }
  return canvas
}

/** 远景聚合 billboard：径向渐变圆盘 + 场站数量大字 + 容量小字。 */
export function clusterCanvas(count: number) {
  const canvas = document.createElement('canvas')
  canvas.width = 112
  canvas.height = 112
  const ctx = canvas.getContext('2d')
  if (!ctx) return canvas
  const gradient = ctx.createRadialGradient(56, 56, 8, 56, 56, 45)
  gradient.addColorStop(0, 'rgba(70, 226, 255, .92)')
  gradient.addColorStop(0.46, 'rgba(13, 87, 119, .96)')
  gradient.addColorStop(1, 'rgba(4, 20, 36, .92)')
  ctx.fillStyle = gradient
  ctx.strokeStyle = '#7cecff'
  ctx.lineWidth = 3
  ctx.shadowColor = '#31d9ff'
  ctx.shadowBlur = 22
  ctx.beginPath()
  ctx.arc(56, 56, 37, 0, Math.PI * 2)
  ctx.fill()
  ctx.stroke()
  ctx.shadowBlur = 0
  ctx.fillStyle = '#f0fdff'
  ctx.font = '700 29px "PingFang SC", sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(String(count), 56, 53)
  ctx.fillStyle = '#8feaff'
  ctx.font = '600 10px "PingFang SC", sans-serif'
  ctx.fillText('场站', 56, 76)
  return canvas
}
