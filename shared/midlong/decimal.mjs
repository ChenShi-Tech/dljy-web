// 中长期合同的十进制数（#2938）：电量、价格、金额一律以规范十进制字符串交换与计算。
//
// 为什么不用 Number：0.1 + 0.2 !== 0.3。合同量、月分解合计是否守恒要做「相等」判断，
// 浮点误差会把守恒的分解判成不守恒，或把差 1e-10 的矛盾分解判成守恒。
// 内部统一换算成 SCALE 位定点整数（BigInt），全程精确；只有除法（均价、覆盖率）需要舍入，
// 且舍入位数由调用方显式给出。零依赖、前后端同构。

export const SCALE = 18
const SCALE_FACTOR = 10n ** BigInt(SCALE)
/** 整数部分最多位数：合同电量/价格/金额远用不到；更长的输入按超出范围拒绝，而不是无界展开。 */
export const MAX_INTEGER_DIGITS = 30

const PLAIN_RE = /^([+-])?(\d+)(?:\.(\d*))?$/
const LEADING_DOT_RE = /^([+-])?\.(\d+)$/
const GROUPED_RE = /^([+-])?(\d{1,3}(?:,\d{3})+)(?:\.(\d*))?$/
const EXP_RE = /^([+-])?(\d+)(?:\.(\d*))?[eE]([+-]?\d+)$/

/**
 * 解析用户或文件给出的数值。
 * @param {unknown} input 字符串或 number；空串、null、undefined 视为「未提供」而不是 0。
 * @param {{ maxScale?: number, allowNegative?: boolean }} [options]
 * @returns {{ ok: true, value: string, scale: number } | { ok: false, code: 'EMPTY'|'NOT_A_NUMBER'|'NEGATIVE'|'PRECISION_EXCEEDED'|'OUT_OF_RANGE', scale?: number }}
 */
export function parseDecimal(input, { maxScale = null, allowNegative = false } = {}) {
  if (input === null || input === undefined) return { ok: false, code: 'EMPTY' }
  let text
  if (typeof input === 'number') {
    if (!Number.isFinite(input)) return { ok: false, code: 'NOT_A_NUMBER' }
    text = String(input)
  } else if (typeof input === 'bigint') {
    text = input.toString()
  } else {
    text = String(input).trim().replace(/\s+/g, '')
  }
  if (text === '') return { ok: false, code: 'EMPTY' }

  let sign = ''
  let intPart = ''
  let fracPart = ''
  let match
  if ((match = PLAIN_RE.exec(text))) {
    ;[, sign = '', intPart, fracPart = ''] = match
  } else if ((match = LEADING_DOT_RE.exec(text))) {
    sign = match[1] ?? ''
    intPart = '0'
    fracPart = match[2]
  } else if ((match = GROUPED_RE.exec(text))) {
    sign = match[1] ?? ''
    intPart = match[2].replaceAll(',', '')
    fracPart = match[3] ?? ''
  } else if ((match = EXP_RE.exec(text))) {
    const digits = `${match[2]}${match[3] ?? ''}`
    const exponent = Number(match[4]) - (match[3] ?? '').length
    sign = match[1] ?? ''
    // 先按结果位数定界再展开：「1e100000000」这类短输入若直接 repeat/padStart 会分配上亿字符，卡死页面或服务进程。
    const significant = digits.replace(/^0+/, '')
    if (significant === '') {
      intPart = '0'
    } else if (exponent >= 0 && significant.length + exponent > MAX_INTEGER_DIGITS) {
      return { ok: false, code: 'OUT_OF_RANGE' }
    } else if (exponent < 0 && -exponent - (significant.length - significant.replace(/0+$/, '').length) > SCALE) {
      return { ok: false, code: 'PRECISION_EXCEEDED', scale: -exponent - (significant.length - significant.replace(/0+$/, '').length) }
    } else if (exponent >= 0) {
      intPart = `${digits}${'0'.repeat(exponent)}`
    } else {
      const padded = digits.padStart(-exponent + 1, '0')
      intPart = padded.slice(0, padded.length + exponent)
      fracPart = padded.slice(padded.length + exponent)
    }
  } else {
    return { ok: false, code: 'NOT_A_NUMBER' }
  }

  fracPart = fracPart.replace(/0+$/, '')
  const scale = fracPart.length
  if (scale > SCALE) return { ok: false, code: 'PRECISION_EXCEEDED', scale }
  if (maxScale !== null && scale > maxScale) return { ok: false, code: 'PRECISION_EXCEEDED', scale }
  intPart = intPart.replace(/^0+(?=\d)/, '')
  if (intPart.length > MAX_INTEGER_DIGITS) return { ok: false, code: 'OUT_OF_RANGE' }
  const isZero = /^0*$/.test(intPart) && fracPart === ''
  if (sign === '-' && !isZero && !allowNegative) return { ok: false, code: 'NEGATIVE' }
  const value = `${sign === '-' && !isZero ? '-' : ''}${intPart || '0'}${fracPart ? `.${fracPart}` : ''}`
  return { ok: true, value, scale }
}

/** 规范十进制字符串 → 定点 BigInt。非法输入直接抛（内部调用方应先 parseDecimal）。 */
export function toScaled(value) {
  const parsed = parseDecimal(value, { allowNegative: true })
  if (!parsed.ok) throw new TypeError(`非法十进制数：${String(value)}（${parsed.code}）`)
  const negative = parsed.value.startsWith('-')
  const [intPart, fracPart = ''] = parsed.value.replace('-', '').split('.')
  const scaled = BigInt(intPart) * SCALE_FACTOR + BigInt(fracPart.padEnd(SCALE, '0') || '0')
  return negative ? -scaled : scaled
}

/** 定点 BigInt → 规范十进制字符串（去尾零）。 */
export function fromScaled(scaled) {
  const negative = scaled < 0n
  const abs = negative ? -scaled : scaled
  const intPart = abs / SCALE_FACTOR
  const fracPart = (abs % SCALE_FACTOR).toString().padStart(SCALE, '0').replace(/0+$/, '')
  const body = `${intPart}${fracPart ? `.${fracPart}` : ''}`
  return negative && body !== '0' ? `-${body}` : body
}

export function decimalAdd(a, b) {
  return fromScaled(toScaled(a) + toScaled(b))
}

export function decimalSub(a, b) {
  return fromScaled(toScaled(a) - toScaled(b))
}

/** 乘积精确到 SCALE 位；超出部分按四舍五入（半数远离零）。 */
export function decimalMul(a, b) {
  return fromScaled(roundDiv(toScaled(a) * toScaled(b), SCALE_FACTOR))
}

/**
 * 除法，结果保留 places 位小数（四舍五入，半数远离零）。除数为 0 返回 null——
 * 分母为零的比率没有意义，调用方必须显式处理，不能默默当成 0。
 */
export function decimalDiv(a, b, places = 6) {
  const divisor = toScaled(b)
  if (divisor === 0n) return null
  const quotient = roundDiv(toScaled(a) * SCALE_FACTOR, divisor)
  return decimalRound(fromScaled(quotient), places)
}

/** 四舍五入到 places 位小数（半数远离零）。 */
export function decimalRound(value, places) {
  const scaled = toScaled(value)
  const unit = 10n ** BigInt(SCALE - places)
  return fromScaled(roundDiv(scaled, unit) * unit)
}

export function decimalCompare(a, b) {
  const x = toScaled(a)
  const y = toScaled(b)
  return x === y ? 0 : x < y ? -1 : 1
}

export function decimalIsZero(value) {
  return toScaled(value) === 0n
}

/** 多个十进制数求和；空数组为 '0'。 */
export function decimalSum(values) {
  let total = 0n
  for (const value of values) total += toScaled(value)
  return fromScaled(total)
}

function roundDiv(numerator, denominator) {
  const negative = (numerator < 0n) !== (denominator < 0n)
  const n = numerator < 0n ? -numerator : numerator
  const d = denominator < 0n ? -denominator : denominator
  let q = n / d
  if ((n % d) * 2n >= d) q += 1n
  return negative ? -q : q
}
