// ============================================================================
// declaration-codes.mjs — 山西平台宽表「type → 口径」字典与抽取选择器的单一事实源
// ----------------------------------------------------------------------------
// 背景（#1529）：sdpt_zrqsb（日前上报）等宽表载荷里 dl/jg/jq 等指标容器下按 type 分
// 多条不同口径的曲线，取错 type 不报错、只给出错误口径的数字（#1498 实发：申报量取到
// type='0' 中长期电量而非 type='1' 日前电量，量级同为 4.4 万 MWh 肉眼不可辨）。此前字典
// 只硬编码在前端 DayAheadReportView.vue::ZPTQX/ZPTJG，Python 侧 _WIDE_SELECTORS 又
// 手写了一份 selector——两处独立表达同一口径，漂移无门禁。
//
// 本文件是唯一事实源，三端由它派生（scripts/build/generate-declaration-codes.mjs）：
//   ① Python 常量  packages/agent-runtime/.../market/declaration_codes_gen.py
//   ② TS 常量      src/services/data/contracts/declarationCodes.gen.ts（sync:web 带往 dljy-web）
//   ③ 人读文档     docs/data/declaration-codes.md
// 改字典/选择器只改这里，然后 npm run build:declaration-codes 重生成；verify:declaration-codes
// 保证生成物零漂移 + 结构自洽（含负例自测）。
//
// ⚠ 口径红线：type 语义来自平台侧（新增/调整取值要同步这里）；selector 引用的 type
// 必须能在对应字典里查到（validateDeclarationCodes 强校验）——查不到即红，杜绝
// 「选择器指向一个谁也不知道是什么的口径」。
// ============================================================================

export const DECLARATION_CODES_SCHEMA_VERSION = 'declaration-codes/v1'

/**
 * 电量类口径码（容器 dl/jq/jq2，前端 ZPTQX 同源）。
 * 键 = 平台 type 字段取值；值 = 口径中文名（UI 图例/曲线名直接消费）。
 */
export const DECLARATION_QTY_TYPE_CODES = {
  '0': '中长期电量',
  '1': '日前电量',
  '2': '实时电量',
  '3': '实时电量加权',
  '4': '预估电量',
  '8': '主策略',
  '9': '小策略',
  '14': 'AI策略1',
  '15': '日前电量AI1',
  '16': 'AI策略2',
  '17': '日前电量AI2',
  '72': '执行策略',
}

/**
 * 价格类口径码（容器 jg，前端 ZPTJG 同源；sdpt_zcqxhdl 的 dmx 容器同码表——
 * 实测 rqdj[date].jz 与 dmx type='0' 逐点相同，即 24 点逐日文件是它的逐小时均值）。
 */
export const DECLARATION_PRICE_TYPE_CODES = {
  '0': '日前价出清',
  '1': '实时价出清',
  '8': '日前价回归',
  '11': '实时价公司预测',
  '30': '日前价电厂预测',
  '40': '日前价公司预测',
  '41': '日前价国能日新预测',
  '45': '日前价AI预测2',
  '61': '日前价AI预测1',
  '62': '实时价AI预测1',
}

/**
 * 多指标宽表族的抽取选择器：(family, synth_kind) → 取哪个容器下的哪条曲线（#1498）。
 *
 * - container：宽表 data 下的指标容器名（sdpt_zptqx 的 rows 在**顶层**，见 pick 注）
 * - type：曲线口径码（必须在 dict 指向的字典里，强校验）
 * - date_field（#1531）：行式容器还要按运行日区间筛，否则整包全历史被拼成一条
 *   跨多天序列（sdpt_zcqxhdl/listrs_full 的 dmx 是 1434 运行日 × 2 类型 = 2868 行）
 * - pick='total_of_siblings'：sdpt_zptqx 同日恒 3 行且无区分字段（只有 id/total 不同），
 *   合计条靠逐点恒等式「某条 == 其余之和」验证选出，验不出就整天丢弃（_pick_sibling_totals）；
 *   type='2' 是平台的「实时电量」——**绝对量**而非增量（实测与日前电量比值 0.83~1.17）。
 */
export const WIDE_TABLE_SELECTORS = [
  { family: 'sdpt_zrqsb', synthKind: 'declared_qty', container: 'dl', type: '1', dict: 'qty' },
  { family: 'sdpt_zcqxhdl', synthKind: 'price_day_ahead', container: 'dmx', type: '0', dict: 'price', dateField: 'date' },
  { family: 'sdpt_zcqxhdl', synthKind: 'price_real_time', container: 'dmx', type: '1', dict: 'price', dateField: 'date' },
  { family: 'sdpt_zptqx', synthKind: 'actual_qty', container: 'rows', type: '2', dict: 'qty', dateField: 'date', pick: 'total_of_siblings' },
]

/**
 * 结构校验（verify:declaration-codes 消费；返回错误文案数组，空=通过）：
 * A. 字典非空、键为纯数字串（平台 type 取值口径）、口径名非空
 * B. selector 无重复 (family, synthKind) 键
 * C. selector 的 type 必须能在其 dict 指向的字典里查到（口径红线）
 * D. pick 仅允许 'total_of_siblings'
 * E. 口径名禁含引号/反斜杠——三端 codegen 直接拼字符串字面量，含这些字符会
 *    生成语法错误的 Python/TS（防注入面从源头拒绝）
 */
export function validateDeclarationCodes() {
  const errors = []
  const dicts = [
    ['qty', DECLARATION_QTY_TYPE_CODES],
    ['price', DECLARATION_PRICE_TYPE_CODES],
  ]
  for (const [name, dict] of dicts) {
    const keys = Object.keys(dict)
    if (!keys.length) errors.push(`字典 ${name} 为空`)
    for (const k of keys) {
      if (!/^\d+$/.test(k)) errors.push(`字典 ${name} 键 ${JSON.stringify(k)} 非纯数字串（平台 type 取值口径）`)
      if (!dict[k] || !dict[k].trim()) errors.push(`字典 ${name} 键 ${k} 口径名为空`)
      if (/["'\\]/.test(dict[k] ?? '')) errors.push(`字典 ${name} 键 ${k} 口径名含引号/反斜杠——codegen 拼字面量会生成非法语法`)
    }
  }
  const seen = new Set()
  for (const s of WIDE_TABLE_SELECTORS) {
    const key = `${s.family}|${s.synthKind}`
    if (seen.has(key)) errors.push(`selector 重复键 ${key}`)
    seen.add(key)
    if (!s.family || !s.synthKind || !s.container) errors.push(`selector ${key} 的 family/synthKind/container 有空值`)
    const dict = s.dict === 'qty' ? DECLARATION_QTY_TYPE_CODES : s.dict === 'price' ? DECLARATION_PRICE_TYPE_CODES : null
    if (!dict) {
      errors.push(`selector ${key} 的 dict 取值非法：${JSON.stringify(s.dict)}`)
    } else if (!(s.type in dict)) {
      errors.push(`selector ${key} 的 type='${s.type}' 不在 ${s.dict} 字典里（口径红线：选择器不得指向未知口径）`)
    }
    if (s.pick !== undefined && s.pick !== 'total_of_siblings') {
      errors.push(`selector ${key} 的 pick 取值非法：${JSON.stringify(s.pick)}`)
    }
  }
  return errors
}
