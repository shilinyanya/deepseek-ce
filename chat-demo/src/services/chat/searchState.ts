import { create } from 'zustand'
import type { SessionSearchHit } from './search.js'

/**
 * 侧栏搜索状态放在模块级：移动端抽屉关闭时 Sider 会卸载，
 * 组件内的 useState 会被丢掉，重开就变回默认列表。
 */
export const useSessionSearch = create<{
  query: string
  hits: SessionSearchHit[] | null
  searching: boolean
  /** 命中总数；hits 只是已经加载的那几页 */
  total: number
  /** 后面还有没有命中没加载 */
  hasMore: boolean
  /** 搜索框是否聚焦：聚焦即进入全屏搜索页 */
  searchFocused: boolean
  /** 从搜索结果跳走后置真：再打开侧栏时直接回到全屏搜索页 */
  restoreSearch: boolean
}>(() => ({
  query: '',
  hits: null,
  searching: false,
  total: 0,
  hasMore: false,
  /** 搜索框是否聚焦：聚焦即进入全屏搜索页 */
  searchFocused: false,
  restoreSearch: false,
}))

/** 待定位的消息：点搜索结果时设置，由消息列表消费一次后清除 */
type JumpTarget = { sessionId: string; messageId: string }

export const useJumpTarget = create<{ target: JumpTarget | null }>(() => ({ target: null }))

export const requestJump = (sessionId: string, messageId: string) =>
  useJumpTarget.setState({ target: { sessionId, messageId } })

export const clearJump = () => useJumpTarget.setState({ target: null })

/** 搜索里刚刚点开的那一条命中；同一会话的多条结果只高亮被点的这条 */
export const useActiveHit = create<{ hit: { sessionId: string; messageId: string } | null }>(
  () => ({ hit: null })
)

export const setActiveHit = (sessionId: string, messageId: string) =>
  useActiveHit.setState({ hit: { sessionId, messageId } })

/** 搜索列表的滚动位置：抽屉关闭会卸载 Sider，重开时用它回到原处 */
let savedScrollTop = 0

export const getSearchScrollTop = () => savedScrollTop

export const setSearchScrollTop = (value: number) => {
  savedScrollTop = value
}
