// 教学示例依据文件（dljy#3404）：导引「帮我填」时生成，正文明确注明非真实依据。
// 类型 text/plain + BOM，与真实上传走同一条 fileToBase64 通道，≤20MB 上限远不会超。
import type { GuideCtx } from '../types'
import { beijingParts } from './examples'

/** 正文与文件名都标明「教学示例」；记录练习公司、合同编号、生成时间与运行标签以便追溯。 */
export function makeExampleEvidenceFile(contractNo: string, ctx: GuideCtx): File {
  const p = beijingParts()
  const stamp = `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')} ${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`
  const lines = [
    '教学示例文件，非真实依据。',
    '本文件由中长期「合同入门」操作导引生成，仅用于演示补充资料与核验确认的流程。',
    `练习公司：${ctx.practiceCompanyId || '（未记录）'}`,
    `合同编号：${contractNo}`,
    `运行标签：${ctx.runTag}`,
    `生成时间（北京时间）：${stamp}`,
  ]
  const text = `\u{FEFF}${lines.join('\n')}\n`
  return new File([text], `教学示例-电子交易确认单-${contractNo}.txt`, { type: 'text/plain;charset=utf-8' })
}
