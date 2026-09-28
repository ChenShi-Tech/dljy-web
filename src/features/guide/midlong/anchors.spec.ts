// 中长期导引锚点守卫（ChenShi-Tech/dljy#3404）。
// 守什么：anchors.ts 是锚点 / 表单键 / 状态键 / 信号名的唯一真值清单，.vue 模板必须与它
// 双向一致——清单里的锚点（ready 导引用到的）都要真的挂在模板上，模板里出现的 data-guide
// 也都得在清单里；表单 / 状态 / 信号键要在组件里真的接上 useGuideForm / useGuideState / emitGuideSignal。
// 坏掉的症状：导引某一步的高亮找不到元素、静默超时进 target-missing；或改版后模板残留
// 锚点字符串而清单已删，两者漂移没人发现。
import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { ANCHOR, FORM, GUIDE_ANCHORS, GUIDE_SIGNAL_NAMES, GUIDE_STATE_KEYS, SIGNAL, STATE } from './anchors'
import { plannedGuides } from './plannedGuides'

function collectVueSources(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) collectVueSources(full, out)
    else if (entry.name.endsWith('.vue')) out.push(readFileSync(full, 'utf8'))
  }
  return out
}

const sources = collectVueSources(resolve(process.cwd(), 'src'))
const allVue = sources.join('\n')

describe('中长期导引锚点清单与模板双向一致', () => {
  it('清单里 ready 导引用到的锚点都真实挂在某个 .vue 模板上', () => {
    // practice-space-badge 归练习空间（ChenShi-Tech/dljy#3403），只是借用同一查找机制，不在本导引守卫范围。
    const planned = new Set(plannedGuides.flatMap((g) => g.plannedAnchors ?? []))
    for (const name of GUIDE_ANCHORS) {
      if (name === ANCHOR.practiceBadge) continue
      // plannedAnchors 与 ready 清单交叠的锚点（如 ml-econ-alloc）仍按 ready 标准检查；
      // 只在 planned 里登记、尚未实现的（ml-plan-create 等）不在 ANCHOR 清单中，天然不查。
      void planned
      expect(allVue.includes(`data-guide="${name}"`), `缺少锚点 ${name}`).toBe(true)
    }
  })

  it('模板里出现的每个 data-guide 值都在清单里（改版删除锚点时清单同步收敛）', () => {
    const used = new Set<string>()
    for (const match of allVue.matchAll(/data-guide="([^"]+)"/g)) used.add(match[1])
    expect([...used].every((name) => GUIDE_ANCHORS.includes(name)), `模板里存在清单外的锚点：${[...used].filter((n) => !GUIDE_ANCHORS.includes(n)).join(', ')}`).toBe(true)
  })

  it('每个表单键都有组件真的接上 useGuideForm（否则「帮我填」找不到表单）', () => {
    for (const [prop] of Object.entries(FORM)) {
      // 调用常带换行（多行适配器参数），用 \s* 容忍括号后的空白。
      expect(new RegExp(`useGuideForm\\(\\s*FORM\\.${prop}\\b`).test(allVue), `缺少 useGuideForm(FORM.${prop}, …)`).toBe(true)
    }
  })

  it('每个状态键都有组件真的接上 useGuideState（否则刷新恢复找不到进度）', () => {
    for (const [prop] of Object.entries(STATE)) {
      expect(new RegExp(`useGuideState\\(\\s*STATE\\.${prop}\\b`).test(allVue), `缺少 useGuideState(STATE.${prop}, …)`).toBe(true)
    }
    void GUIDE_STATE_KEYS
  })

  it('每个信号名都有组件在成功分支发 emitGuideSignal（否则保存成功不推进）', () => {
    for (const [prop] of Object.entries(SIGNAL)) {
      expect(new RegExp(`emitGuideSignal\\(\\s*SIGNAL\\.${prop}\\b`).test(allVue), `缺少 emitGuideSignal(SIGNAL.${prop}, …)`).toBe(true)
    }
    void GUIDE_SIGNAL_NAMES
  })
})
