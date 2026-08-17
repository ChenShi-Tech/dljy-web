// 报告摘要提取（Epic #2033 · M1 · #2040 S1 昨夜报告卡 / #2038 驾驶舱报告位共用）
// 纯函数：markdown 正文 → 首个有实质内容的段落，去常见记号，定长截断。

/** 取正文第一段 ≥minChars 的文本，去 markdown 记号，超长截断加省略号。 */
export function summarizeReportMd(md: string, maxChars = 120, minChars = 16): string {
  for (const raw of md.split('\n')) {
    const line = raw
      .replace(/^#{1,6}\s*/, '')
      .replace(/\*\*/g, '')
      .replace(/`/g, '')
      .replace(/\|/g, '')
      .replace(/^[-*>]\s*/, '')
      .replace(/^\d+[.、]\s*/, '')
      .trim()
    if (line.length >= minChars) {
      return line.length > maxChars ? `${line.slice(0, maxChars)}…` : line
    }
  }
  return ''
}
