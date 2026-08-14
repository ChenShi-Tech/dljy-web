/**
 * T0/T1 手录模板 xlsx 生成器（Issue #768）。
 *
 * 输入 `EXCEL_TEMPLATE_DECLARATIONS` 的模板声明，产出带「列名 + 填写说明 + 示例行」的 xlsx。
 * 单一来源：列名/单位/格式/示例改声明即变，模板自动跟随（验收标准①）。
 *
 * 说明/示例行约定（与上传解析侧唯一契约 `TEMPLATE_COMMENT_PREFIX`）：
 *   - 数据 sheet 第 1 行 = 列名（上传解析用作表头）；
 *   - 首列以 `#` 开头的行 = 说明行 / 示例行，上传时统一过滤；
 *   - 用户填写真实数据请另起新行，且行首不要用 `#`。
 * 服务端 `validateTemplateRecords` / `isTemplateCommentCells` 从同一常量派生过滤逻辑。
 *
 * 经 `import('@/utils/importTemplate')` 懒加载，xlsx 库不进主 bundle（照抄 exportExcel.ts 模式）。
 */
import { exportWorkbook, type ExcelSheet } from './exportExcel'
import { TEMPLATE_COMMENT_PREFIX } from 'shared/schema/source-registry.mjs'

export type TemplateColumn = {
  name: string
  type?: string
  format?: string
  unit?: string
  required?: boolean
}

export type ExcelTemplateDeclaration = {
  templateId: string
  tier?: string
  label?: string
  ownership?: string
  note?: string
  columns: TemplateColumn[]
  sampleRows?: (string | number)[][]
}

/** 单列填写提示：类型/格式/单位/必填。 */
function columnHint(col: TemplateColumn): string {
  const parts = [`类型:${col.type ?? 'string'}`]
  if (col.format) parts.push(`格式:${col.format}`)
  if (col.unit) parts.push(`单位:${col.unit}`)
  parts.push(col.required ? '必填' : '选填')
  return parts.join(' ')
}

/** 生成模板工作簿的 sheet 列表（数据 sheet + 填写说明 sheet），供下载与单测复用。 */
export function buildTemplateSheets(declaration: ExcelTemplateDeclaration): ExcelSheet[] {
  const header = declaration.columns.map((c) => c.name)

  // 整体说明行（首列以 # 开头，上传忽略）。
  const noticeRow: (string | number)[] = [
    `${TEMPLATE_COMMENT_PREFIX} 以 ${TEMPLATE_COMMENT_PREFIX} 开头的行为说明/示例，上传时自动忽略；` +
      `填写真实数据请另起新行，行首不要用 ${TEMPLATE_COMMENT_PREFIX}`
  ]
  // 逐列提示行：首列加 # 前缀（既是注释标记，也承载首列自己的提示）。
  const hintRow: (string | number)[] = declaration.columns.map((c, i) =>
    i === 0 ? `${TEMPLATE_COMMENT_PREFIX} ${columnHint(c)}` : columnHint(c)
  )
  // 示例行：首列加 # 前缀，上传时整行过滤；保留在数据 sheet 供用户直观参照列的形状。
  const sampleRows: (string | number)[][] = (declaration.sampleRows ?? []).map((row) =>
    row.map((v, i) => (i === 0 ? `${TEMPLATE_COMMENT_PREFIX} ${v}` : v))
  )

  const dataSheet: ExcelSheet = {
    name: '数据',
    rows: [header, noticeRow, hintRow, ...sampleRows]
  }

  // 填写说明 sheet：列声明表 + 归属提示。上传只读第 1 个 sheet，本 sheet 不参与摄取。
  const docRows: (string | number)[][] = [
    ['列名', '类型', '格式', '单位', '必填'],
    ...declaration.columns.map((c) => [
      c.name,
      c.type ?? 'string',
      c.format ?? '',
      c.unit ?? '',
      c.required ? '必填' : '选填'
    ])
  ]
  if (declaration.ownership === 'company') {
    docRows.push([], ['归属', '公司私有模板：不填「公司」列，数据归属由登录会话公司自动决定'])
  }
  if (declaration.note) docRows.push([], ['说明', declaration.note])
  const docSheet: ExcelSheet = { name: '填写说明', rows: docRows }

  return [dataSheet, docSheet]
}

/** 生成并触发浏览器下载 `<templateId>.xlsx`。 */
export function downloadTemplateWorkbook(declaration: ExcelTemplateDeclaration): void {
  exportWorkbook(declaration.templateId, buildTemplateSheets(declaration))
}
