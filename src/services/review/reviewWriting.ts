import { chatCompletion } from '@/services/llm'
import { buildReviewWritingPrompt, type ReviewWritingInput, type ReviewWritingMode } from '@/prompts/reviewWriting'
export type WritingCandidate = { text: string; evidenceRefs: number[]; uncertainties: string[] }
export function parseWritingCandidate(raw: string, evidenceCount: number): WritingCandidate {
  const value = JSON.parse(raw.replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '')) as WritingCandidate
  if (!value || typeof value.text !== 'string' || !value.text.trim() || value.text.length > 16000 || !Array.isArray(value.evidenceRefs) || !Array.isArray(value.uncertainties)) throw new Error('建议格式不完整')
  const refs = [...value.evidenceRefs, ...Array.from(value.text.matchAll(/【材料(\d+)】/g), match => Number(match[1]))]
  if (refs.some(id => !Number.isInteger(id) || id < 1 || id > evidenceCount) || value.uncertainties.length > 12 || value.uncertainties.some(item => typeof item !== 'string' || item.length > 2000)) throw new Error('建议引用或待核实事项无效')
  return { text: value.text.trim(), evidenceRefs: [...new Set(refs)], uncertainties: value.uncertainties }
}
export async function suggestReviewWriting(input: ReviewWritingInput, mode: ReviewWritingMode, scope: { companyId: string; region: string }, signal: AbortSignal): Promise<WritingCandidate> {
  const raw = await chatCompletion(buildReviewWritingPrompt(input, mode), { json: true, signal, scope })
  return parseWritingCandidate(raw, input.evidence.length)
}
