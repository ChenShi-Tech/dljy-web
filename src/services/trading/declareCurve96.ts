// 96 点申报曲线编辑器的纯函数层（merge-declare-desk-into-s4 任务 2.1）：
// 自 DeclarationDeskView 抽出，供受控共享组件 DeclarationCurveEditor 与单测消费。
// 存储口径：96 点为 MWh/15min，功率 MW = MWh×4；编辑器每点即一个 15min 时点。
// 非法输入（未填/非数/负数）的归一判定在 services/declarations 的 editorMwOf/
// invalidPointIndexesOf，本模块不重复造。

export const CURVE_POINT_COUNT = 96

/**
 * 编辑器/主图的时点标签（时段起点 00:00~23:45）。
 * 96 点明细表与导出 CSV 用的是时段段末口径（curvePointLabel，00:15~24:00），
 * 两套口径各自注明，不混用。非法下标返回 '—'，不硬凑时刻。
 */
export function pointStartLabel(i: number | '' | undefined): string {
  const n = Number(i)
  if (!Number.isFinite(n) || n < 0 || n > CURVE_POINT_COUNT - 1) return '—'
  const h = Math.floor(n / 4)
  const m = (n % 4) * 15
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

/** 96 点明细/导出的时点标签（15min 时段段末 00:15~24:00）。 */
export function curvePointLabel(i: number): string {
  const h = Math.floor((i + 1) / 4)
  const m = ((i + 1) % 4) * 15
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

/** 保存曲线（MWh/15min 点）→ 编辑器功率口径（MW = MWh×4，2 位舍入与服务端 round2 精度对齐）。 */
export function energy96ToMw96(energy: number[]): Array<number | ''> {
  return Array.from({ length: CURVE_POINT_COUNT }, (_, i) => Math.round((energy[i] ?? 0) * 4 * 100) / 100)
}

/** 编辑器功率口径（MW，已归一为数值）→ 保存链曲线（MWh/点 = MW/4，4 位舍入）。 */
export function mw96ToEnergy96(pointMw: number[]): number[] {
  return Array.from({ length: CURVE_POINT_COUNT }, (_, i) => Math.round(((pointMw[i] ?? 0) / 4) * 10000) / 10000)
}

export type CurveDetailRow = { label: string; mw: string; mwh: string }

/**
 * 96 点明细行（清单 D1）：编辑中以编辑器实时值为准，否则读已保存的申报单曲线。
 * 时点标注与「导出当日明细」同一口径（段末 00:15~24:00），同页两处不各说各话。
 */
export function buildCurveDetail96(savedEnergy96: number[], editingMw96: number[] | null): CurveDetailRow[] {
  return Array.from({ length: CURVE_POINT_COUNT }, (_, i) => {
    const mw = editingMw96
      ? Math.round((editingMw96[i] ?? 0) * 100) / 100
      : Math.round((savedEnergy96[i] ?? 0) * 4 * 100) / 100
    const mwh = editingMw96
      ? Math.round((mw / 4) * 10000) / 10000
      : Math.round((savedEnergy96[i] ?? 0) * 10000) / 10000
    return { label: curvePointLabel(i), mw: mw.toFixed(2), mwh: mwh.toFixed(4) }
  })
}

/** 明细 → CSV 文本（UTF-8 BOM 头由调用方拼，这里只出正文，便于单测断言）。 */
export function buildCurveCsv(rows: CurveDetailRow[], totalMwh: number): string {
  const header = '时点,功率(MW),电量(MWh)'
  const body = rows.map((r) => `${r.label},${r.mw},${r.mwh}`).join('\n')
  return `${header}\n${body}\n合计(96点),,${totalMwh}\n`
}
