// InsightBlock.component.spec.ts — 区块容器文案与状态优先级回归（dljy#2996 任务 5.5）
// 守什么不变量：
//   ① 错误文案映射：403 只说没有权限（不透露资料是否存在）、409 版本冲突给刷新入口、
//      400/422 显示后端原因、503 读取失败可重试；
//   ② 409 且旧结果仍在：旧内容继续显示（不藏旧图、不静默换新），刷新只由用户点击触发；
//   ③ 空态按 availability.reason 显示中文原因；日期相关原因提供「查看可分析日期」入口，
//      点击 emit open-candidates（组件不改上下文）；
//   ④ 部分可用：内容照常渲染 + 提示条 + 未读到对象列表（不装作完整）；
//   ⑤ 展示文本永不出现 family / capture 前缀 / SQL / sourceId 原文（红词扫描）。
import { describe, expect, it, vi } from 'vitest'
import { mount } from '@/test/mount'
import InsightBlock from './InsightBlock.vue'
import { InsightRequestError } from '@/services/insight/insightClient'
import { insightResult, nodePriceResult } from './insightFixtures'

function requestError(status: number, message = ''): InsightRequestError {
  return new InsightRequestError({ status, errorCode: 'TEST', message })
}

/** 按可见文本找按钮（头部「证据」按钮总是第一个 button，不能按下标取）。 */
function buttonByText(wrapper: ReturnType<typeof mount>, text: string) {
  const button = wrapper.findAll('button').find((item) => item.text() === text)
  expect(button, `应存在「${text}」按钮`).toBeTruthy()
  return button!
}

const RED_WORDS = [/yn_/, /capture/, /family/, /SELECT/, /yn\./]

function expectNoRedWords(html: string): void {
  for (const word of RED_WORDS) expect(html, `渲染文本不应含内部标识：${word}`).not.toMatch(word)
}

describe('错误文案映射', () => {
  it('403：只说没有权限，不透露资料是否存在，也不给重试入口', () => {
    const wrapper = mount(InsightBlock, {
      props: { title: '节点价格', result: null, error: requestError(403, 'forbidden') },
    })

    expect(wrapper.text()).toContain('当前公司没有这类资料的查看权限')
    expect(wrapper.text()).not.toContain('重试')
  })

  it('409 无旧结果：版本冲突提示 + 刷新按钮只由用户点击触发', async () => {
    const onRefresh = vi.fn()
    const wrapper = mount(InsightBlock, {
      props: { title: '节点价格', result: null, error: requestError(409, 'conflict'), onRefresh },
    })

    expect(wrapper.text()).toContain('资料已更新，当前看到的不是最新版本')
    expect(onRefresh).not.toHaveBeenCalled()

    await buttonByText(wrapper, '刷新').trigger('click')
    expect(onRefresh).toHaveBeenCalledTimes(1)
  })

  it('422：显示后端给出的可行动原因并给重试', () => {
    const wrapper = mount(InsightBlock, {
      props: {
        title: '节点价格',
        result: null,
        error: requestError(422, '一次最多选择 200 个对象'),
        onRetry: () => {},
      },
    })

    expect(wrapper.text()).toContain('一次最多选择 200 个对象')
    expect(wrapper.text()).toContain('重试')
  })

  it('503：统一「资料读取失败」+ 重试，不吞成空图', () => {
    const wrapper = mount(InsightBlock, {
      props: { title: '节点价格', result: null, error: requestError(503), onRetry: () => {} },
    })

    expect(wrapper.text()).toContain('资料读取失败')
    expect(wrapper.text()).toContain('重试')
  })
})

describe('409 不静默替换', () => {
  it('旧结果仍在时内容继续显示，冲突以警告条叠加；刷新需用户点击', async () => {
    const onRefresh = vi.fn()
    const wrapper = mount(InsightBlock, {
      props: { title: '节点价格', result: nodePriceResult(['300']), error: requestError(409), onRefresh },
      slots: { default: '<div class="old-chart">旧版本内容</div>' },
    })

    expect(wrapper.text()).toContain('旧版本内容')
    expect(wrapper.text()).toContain('不是最新版本')
    expect(onRefresh).not.toHaveBeenCalled()

    await buttonByText(wrapper, '刷新').trigger('click')
    expect(onRefresh).toHaveBeenCalledTimes(1)
  })
})

describe('空态与候选入口', () => {
  it('beyond-coverage：中文原因 + 后端 detail +「查看可分析日期」入口（点击 emit）', async () => {
    const result = insightResult({
      runtime: {
        access: 'granted',
        availability: { state: 'empty', reason: 'beyond-coverage', detail: '已入库完整日期到 2026-09-15' },
        freshness: { state: 'unknown' },
        comparability: { status: 'insufficient', reasons: [{ code: 'no-data', detail: '无数据' }] },
      },
    })
    const wrapper = mount(InsightBlock, { props: { title: '节点价格', result, error: null } })

    expect(wrapper.text()).toContain('所选日期没有已入库资料')
    expect(wrapper.text()).toContain('已入库完整日期到 2026-09-15')

    await buttonByText(wrapper, '查看可分析日期').trigger('click')
    expect(wrapper.emitted('open-candidates')).toHaveLength(1)
  })

  it('not-enabled：功能未开通不给候选入口（换日期解决不了）', () => {
    const result = insightResult({
      runtime: {
        access: 'granted',
        availability: { state: 'empty', reason: 'not-enabled' },
        freshness: { state: 'unknown' },
        comparability: { status: 'insufficient', reasons: [{ code: 'no-data', detail: '无数据' }] },
      },
    })
    const wrapper = mount(InsightBlock, { props: { title: '节点价格', result, error: null } })

    expect(wrapper.text()).toContain('功能未开通')
    expect(wrapper.text()).not.toContain('查看可分析日期')
  })
})

describe('部分可用与来源标签', () => {
  it('partial：内容照常渲染 + 提示条列出未读到的对象，不装作完整', () => {
    const result = nodePriceResult(['300', null, '301'], {
      runtime: {
        access: 'granted',
        availability: { state: 'partial', reason: 'partial-missing', detail: '00:15-00:30 缺测' },
        freshness: { state: 'fresh' },
        comparability: { status: 'compatible', reasons: [] },
      },
      coverage: {
        'yn.price.node.public.day-ahead': {
          objects: { observedObjects: 1, missingRequested: ['YN.QJ.02'], unmappedNames: [] },
        },
      },
    })
    const wrapper = mount(InsightBlock, {
      props: { title: '节点价格', result, error: null },
      slots: { default: '<div class="chart">图表内容</div>' },
    })

    expect(wrapper.text()).toContain('图表内容')
    expect(wrapper.text()).toContain('00:15-00:30 缺测')
    expect(wrapper.text()).toContain('未读到的对象：YN.QJ.02')
  })

  it('来源标签显示业务标题与公开/获权标注；证据按钮 emit open-evidence', async () => {
    const result = nodePriceResult(['300'], {
      sourceRefs: [
        { sourceId: 'yn.price.node.public.day-ahead', accessScope: 'public' },
        { sourceId: 'cgn.price.node.day-ahead', accessScope: 'company' },
      ],
    })
    const wrapper = mount(InsightBlock, {
      props: { title: '节点价格', result, error: null },
      slots: { default: '<div />' },
    })

    expect(wrapper.text()).toContain('公开')
    expect(wrapper.text()).toContain('获权')
    expect(wrapper.text()).not.toContain('yn.price.node.public.day-ahead')

    const evidenceButton = wrapper.findAll('button').find((button) => button.text() === '证据')
    expect(evidenceButton).toBeTruthy()
    await evidenceButton!.trigger('click')
    expect(wrapper.emitted('open-evidence')).toHaveLength(1)
  })
})

describe('展示纪律（红词扫描）', () => {
  it('错误、空态、部分可用各场景的渲染文本都不含内部标识', () => {
    const emptyResult = insightResult({
      runtime: {
        access: 'granted',
        availability: { state: 'empty', reason: 'beyond-coverage', detail: '已入库到 2026-09-15' },
        freshness: { state: 'unknown' },
        comparability: { status: 'insufficient', reasons: [{ code: 'no-data', detail: '无数据' }] },
      },
    })
    const partialResult = nodePriceResult(['300'], {
      runtime: {
        access: 'granted',
        availability: { state: 'partial', reason: 'partial-missing', detail: '部分缺测' },
        freshness: { state: 'fresh' },
        comparability: { status: 'compatible', reasons: [] },
      },
      coverage: {
        'yn.price.node.public.day-ahead': {
          objects: { observedObjects: 1, missingRequested: ['YN.QJ.02'], unmappedNames: [] },
        },
      },
    })

    const cases = [
      mount(InsightBlock, { props: { title: '节点价格', result: null, error: requestError(403) } }),
      mount(InsightBlock, { props: { title: '节点价格', result: null, error: requestError(422, '范围过大') } }),
      mount(InsightBlock, { props: { title: '节点价格', result: emptyResult, error: null } }),
      mount(InsightBlock, { props: { title: '节点价格', result: partialResult, error: null }, slots: { default: '<div />' } }),
    ]
    for (const wrapper of cases) expectNoRedWords(wrapper.html())
  })
})
