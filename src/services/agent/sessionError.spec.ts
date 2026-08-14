import { describe, expect, it } from 'vitest'

import { formatCreateSessionError, readErrorDetail } from './sessionError'

describe('formatCreateSessionError', () => {
  it('服务端 detail 优先透传，不再谎报「后端未启动」（#1631）', () => {
    const msg = formatCreateSessionError(424, '缺少 deepseek 的 API Key：请在「AI 设置」配置，或设环境变量 DEEPSEEK_API_KEY')
    expect(msg).toContain('缺少 deepseek 的 API Key')
    expect(msg).not.toContain('后端未启动')
  })

  it('500 且带 detail 时同样透传 detail 而非兜底话术', () => {
    const msg = formatCreateSessionError(500, '上游数据库连接失败')
    expect(msg).toBe('创建会话失败: 500（上游数据库连接失败）')
  })

  it('5xx 无 detail 保留「后端未启动」兜底（真宕机/代理连不上语义不变）', () => {
    expect(formatCreateSessionError(500)).toBe(
      '创建会话失败: 500（智能体后端未启动：npm run dev:agent-api）'
    )
  })

  it('404 无 detail 保留「未启用智能体」兜底', () => {
    expect(formatCreateSessionError(404)).toContain('后端未启用智能体')
  })

  it('4xx 其它状态无 detail 时只报状态码', () => {
    expect(formatCreateSessionError(400)).toBe('创建会话失败: 400')
  })
})

describe('readErrorDetail', () => {
  it('提取 FastAPI 结构化 detail', async () => {
    const res = new Response(JSON.stringify({ detail: '缺少 key' }))
    expect(await readErrorDetail(res)).toBe('缺少 key')
  })

  it('非 JSON 响应（代理错误页）返回空串', async () => {
    const res = new Response('<html>502 Bad Gateway</html>')
    expect(await readErrorDetail(res)).toBe('')
  })

  it('detail 非字符串（如校验错误数组）返回空串走兜底', async () => {
    const res = new Response(JSON.stringify({ detail: [{ loc: ['body'] }] }))
    expect(await readErrorDetail(res)).toBe('')
  })
})
