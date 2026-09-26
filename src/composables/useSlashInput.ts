// 斜杠指令输入集成：菜单状态机 + 键盘处理 + 输入历史。
// 宿主组件（AgentChatPanel 等）把输入 ref 与 CommandContext 工厂传进来，
// 模板里挂 <SlashCommandMenu>，keydown 时先问本 composable 是否消费了按键。
import { ref, watch, type Ref } from 'vue'
import {
  getCommands,
  filterCommands,
  findCommand,
  parseSlashInput,
  executeSlashInput,
  type CommandContext,
  type CommandHost,
  type SlashCommand
} from '@/services/slashCommands'
import { backendSkillsVersion, refreshBackendSkills } from '@/services/skills'

export type SlashMenuItem = {
  title: string
  desc: string
  hint?: string
  source: 'builtin' | 'skill'
  // 选中后写回输入框的文本；runNow=true 时选中即执行
  insert: string
  runNow: boolean
}

const HISTORY_LIMIT = 50

export function useSlashInput(opts: {
  input: Ref<string>
  host: CommandHost
  makeContext: (args: string) => CommandContext
}) {
  const { input, host, makeContext } = opts

  const menuOpen = ref(false)
  const menuItems = ref<SlashMenuItem[]>([])
  const activeIndex = ref(0)

  // 菜单状态机：跟随输入内容刷新
  function refresh() {
    const text = input.value
    if (!text.startsWith('/') || /\n/.test(text)) {
      closeMenu()
      return
    }
    refreshBackendSkills()
    // 菜单只列可见指令；隐藏指令（如无权限的专家命令）不出现在补全里，但手动输入仍可执行
    const commands = getCommands(host, makeContext('').extraCommands ?? []).filter((c) => !c.hidden)
    const space = text.search(/\s/)
    if (space < 0) {
      // 指令过滤模式：/na → 过滤出 /nav
      const query = text.slice(1)
      const hits = filterCommands(commands, query)
      menuItems.value = hits.slice(0, 12).map((c) => toCommandItem(c))
    } else {
      // 参数补全模式：/nav 现货 → 该指令的候选参数
      const name = text.slice(1, space)
      const cmd = findCommand(commands, name)
      if (!cmd?.getArgOptions) {
        closeMenu()
        return
      }
      const query = text.slice(space + 1)
      menuItems.value = cmd.getArgOptions(query).map((o) => ({
        title: o.label,
        desc: o.meta ?? '',
        source: cmd.source,
        insert: `/${name} ${o.value}`,
        runNow: !!cmd.runOnArgSelect
      }))
    }
    activeIndex.value = 0
    menuOpen.value = menuItems.value.length > 0
  }

  function toCommandItem(c: SlashCommand): SlashMenuItem {
    const hasArgs = !!c.argHint || !!c.getArgOptions
    return {
      title: '/' + c.name,
      desc: c.description,
      hint: c.argHint,
      source: c.source,
      insert: '/' + c.name + (hasArgs ? ' ' : ''),
      runNow: !hasArgs
    }
  }

  function closeMenu() {
    menuOpen.value = false
    menuItems.value = []
    activeIndex.value = 0
  }

  // 输入变化刷新菜单；后端技能异步到达（版本号自增）时重算菜单补上后端技能
  watch([input, backendSkillsVersion], refresh)

  function selectItem(i: number) {
    const item = menuItems.value[i]
    if (!item) return
    if (item.runNow) {
      input.value = ''
      closeMenu()
      executeSlashInput(item.insert, makeContext)
      pushHistory(item.insert)
    } else {
      input.value = item.insert // 留在输入框等参数，watch 会切到参数补全模式
    }
  }

  // 输入历史（↑↓ 翻阅，仅本宿主、本次页面生命周期内）
  const sent: string[] = [] // 最新的在前
  let browseIdx = -1 // -1 = 未在翻阅
  let draft = ''

  function pushHistory(text: string) {
    const t = text.trim()
    if (!t) return
    if (sent[0] !== t) sent.unshift(t)
    if (sent.length > HISTORY_LIMIT) sent.length = HISTORY_LIMIT
    browseIdx = -1
  }

  function browseHistory(step: 1 | -1): boolean {
    if (!sent.length) return false
    if (browseIdx === -1) {
      if (step === -1) return false
      draft = input.value
      browseIdx = 0
    } else {
      const next = browseIdx + step
      if (next >= sent.length) return true // 已到最旧，原地不动
      if (next < 0) {
        browseIdx = -1
        input.value = draft
        return true
      }
      browseIdx = next
    }
    input.value = sent[browseIdx]
    return true
  }

  // 统一键盘处理：返回 true 表示按键已被消费，宿主不再处理
  function onKeydown(e: KeyboardEvent): boolean {
    if (menuOpen.value) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        activeIndex.value = (activeIndex.value + 1) % menuItems.value.length
        return true
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        activeIndex.value = (activeIndex.value - 1 + menuItems.value.length) % menuItems.value.length
        return true
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault()
        selectItem(activeIndex.value)
        return true
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        closeMenu()
        return true
      }
      return false
    }
    // 菜单关闭时：输入为空（或正在翻阅）用 ↑↓ 翻输入历史
    if (e.key === 'ArrowUp' && (browseIdx !== -1 || !input.value)) {
      if (browseHistory(1)) {
        e.preventDefault()
        return true
      }
    }
    if (e.key === 'ArrowDown' && browseIdx !== -1) {
      e.preventDefault()
      browseHistory(-1)
      return true
    }
    return false
  }

  // send 前调用：是斜杠指令则执行并返回 true（指令永不发给 LLM）
  function trySlash(text: string): boolean {
    if (!parseSlashInput(text)) return false
    closeMenu()
    const handled = executeSlashInput(text, makeContext)
    if (handled) pushHistory(text)
    return handled
  }

  return {
    menuOpen,
    menuItems,
    activeIndex,
    onKeydown,
    trySlash,
    pushHistory,
    selectItem,
    closeMenu
  }
}
