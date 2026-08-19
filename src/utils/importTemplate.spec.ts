import { describe, expect, it } from 'vitest'
import {
  EXCEL_TEMPLATE_DECLARATIONS,
  listExcelTemplateDeclarations,
  TEMPLATE_COMMENT_PREFIX
} from 'shared/schema/source-registry.mjs'
import { buildTemplateSheets } from './importTemplate'

// #768：模板生成器与声明的单一来源锁，数据 sheet 表头必须严格等于声明列名，
// 说明/示例行必须带注释前缀（上传侧据此过滤），company 模板下载不得暴露公司列。
describe('importTemplate 生成器', () => {
  it('数据 sheet 第 1 行严格等于声明列名（改声明即改模板）', () => {
    for (const decl of listExcelTemplateDeclarations()) {
      const [dataSheet] = buildTemplateSheets(decl)
      expect(dataSheet.rows[0]).toEqual(decl.columns.map((c: { name: string }) => c.name))
    }
  })

  it('数据 sheet 说明行与示例行首列以注释前缀开头（上传侧统一过滤）', () => {
    const decl = EXCEL_TEMPLATE_DECLARATIONS['yn-t0-node-price']
    const [dataSheet] = buildTemplateSheets(decl)
    // rows: [header, noticeRow, hintRow, ...sampleRows]；除表头外全部以 # 开头。
    for (const row of dataSheet.rows.slice(1)) {
      expect(String(row[0]).startsWith(TEMPLATE_COMMENT_PREFIX)).toBe(true)
    }
  })

  it('company 模板数据 sheet 表头不含「公司」列（归属走会话）', () => {
    const decl = EXCEL_TEMPLATE_DECLARATIONS['yn-t1-station-node']
    const [dataSheet] = buildTemplateSheets(decl)
    expect(dataSheet.rows[0].some((h) => String(h).includes('公司'))).toBe(false)
  })
})
