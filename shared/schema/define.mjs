// 零依赖微型 schema：一份定义同时驱动
//  ① 后端运行时校验/规范化（server/company-store.mjs 落库前 parse）
//  ② 前端 TS 类型推导（见同目录 define.d.ts 的 Infer<typeof schema>）
//  ③ 治理一致性校验（scripts/verify/verify-schema-contracts.mjs）
// 设计刻意保持纯 Node 标准库、无外部依赖，coerce 语义与既有 company-store 的
// numOrNull/strOrNull/normalize* 完全对齐，确保替换后行为不回归。

export function str(opts = {}) {
  return { kind: 'string', ...opts }
}
export function num(opts = {}) {
  return { kind: 'number', ...opts }
}
export function enumOf(values, opts = {}) {
  return { kind: 'enum', values, ...opts }
}
export function object(fields) {
  return { kind: 'object', fields }
}

// 读取字段原始值：先 canonical 名（camelCase），再按 alias 兜底（兼容 snake_case 导入）。
function readRaw(input, name, field) {
  if (input == null || typeof input !== 'object') return undefined
  if (input[name] !== undefined) return input[name]
  const aliases = field.alias ? (Array.isArray(field.alias) ? field.alias : [field.alias]) : []
  for (const alias of aliases) {
    if (input[alias] !== undefined) return input[alias]
  }
  return undefined
}

function resolveDefault(field) {
  return typeof field.default === 'function' ? field.default() : field.default
}

// 与 company-store.strOrNull 对齐：trim 后空串归 null。
function coerceString(value) {
  if (value === undefined || value === null) return null
  const str = String(value).trim()
  return str || null
}

// 与 company-store.numOrNull 对齐：空/非有限数归 null。
function coerceNumber(value) {
  if (value === undefined || value === null || value === '') return null
  const num = Number(value)
  return Number.isFinite(num) ? num : null
}

// 解析 + 规范化输入为符合 schema 的 mart 记录。返回 { ok, value, errors }。
// 注意：value 始终包含 schema 全部字段（缺失项取默认值或 null），便于直接落库。
export function parse(schema, input) {
  const errors = []
  const value = {}
  for (const [name, field] of Object.entries(schema.fields)) {
    const raw = readRaw(input, name, field)
    let out
    if (field.kind === 'number') {
      out = coerceNumber(raw)
      if (out === null && field.default !== undefined) out = resolveDefault(field)
    } else if (field.kind === 'enum') {
      const normalized = coerceString(raw)
      if (normalized !== null && field.values.includes(normalized)) out = normalized
      else out = field.default !== undefined ? resolveDefault(field) : field.values[0]
    } else {
      out = coerceString(raw)
      if (out === null && field.default !== undefined) out = resolveDefault(field)
    }
    if ((out === null || out === undefined) && field.required) {
      errors.push(`字段 ${name} 必填`)
    }
    value[name] = out
  }
  return { ok: errors.length === 0, value, errors }
}

// schema 的全部字段名（治理校验用：断言落库返回字段覆盖 schema 定义）。
export function fieldNames(schema) {
  return Object.keys(schema.fields)
}

// 数值字段可接受的形态：null（无数据）、有限数、可解析为有限数的字符串（含空串→视为无数据）。
// 拒绝对象/数组/布尔等「类型不对」的脏值——供真实数据守门，宁缺毋滥。
function isNumberLike(value) {
  if (value === null) return true
  if (typeof value === 'number') return Number.isFinite(value)
  if (typeof value === 'string') {
    const text = value.trim()
    return text === '' || Number.isFinite(Number(text))
  }
  return false
}

// 字符串/枚举字段可接受的形态：null、字符串或数字（数字会被规范化为字符串）。拒绝对象/数组/布尔。
function isStringLike(value) {
  return value === null || typeof value === 'string' || typeof value === 'number'
}

// 类型级行校验：判定一行是否「字段齐备且类型正确」符合 schema。
// 与 parse 的分工：parse 负责落库前规范化（缺失取默认、脏值强转 null），是宽容的写入路径；
// matchesSchema 负责「真实数据守门」——不做修补，字段缺失或类型不符即判失败，
// 供 server/index.mjs 校验私有缓存真实行使用（任一行不合格则整文件回退 Mock）。
// 较旧的「仅检查字段名是否存在」更严：能拦住数值字段是非数字串/对象、必填串为空等坏数据。
export function matchesSchema(schema, row) {
  if (row == null || typeof row !== 'object' || Array.isArray(row)) return false
  for (const [name, field] of Object.entries(schema.fields)) {
    if (!Object.hasOwn(row, name)) return false
    const value = row[name]
    if (field.kind === 'number') {
      const blank = value === null || value === undefined || (typeof value === 'string' && value.trim() === '')
      if (blank) {
        if (field.required) return false
        continue
      }
      if (!isNumberLike(value)) return false
      continue
    }
    if (!isStringLike(value)) return false
    const normalized = coerceString(value)
    if (field.required && normalized === null) return false
    if (field.kind === 'enum' && normalized !== null && !field.values.includes(normalized)) return false
  }
  return true
}
