import clsx from 'clsx'
import { memo, useRef, useState, type ReactNode } from 'react'
import { useTranslate } from '../../i18n/index.js'
import {
  IconCheckOutline16,
  IconDownloadOutline16,
  IconEditOutline16,
  IconPinOutline16,
  IconPanelLeftOutline16,
  IconRefreshOutline16,
  IconTrashOutline16,
} from '../base/icons.js'
import { exportSession } from '../../services/chat/backup.js'
import { compressContext, renameSession, selectSession } from '../../services/chat/store.js'
import { useSettings } from '../../services/settings.js'
import type { SessionSummary } from '../../services/chat/types.js'
import { saveBlob } from '../../utils/download.js'
import { ContextUsageBar } from '../base/ContextUsageBar.js'
import { askManualCompress } from '../base/ManualCompressDialog.js'
import { askSessionFolder } from '../base/FolderDialog.js'
import { assignSessionFolder, useSessionFolders } from '../../services/chat/sessionFolders.js'
import { Menu } from '../base/Menu.js'
import { showToast } from '../base/toastState.js'
import { closeMobileSider } from './mobileSiderState.js'
import {
  requestJump,
  setActiveHit,
  useActiveHit,
  useSessionSearch,
} from '../../services/chat/searchState.js'
import styles from './SessionItem.module.css'

export const SessionItem = memo(function SessionItem({
  session,
  active,
  snippet,
  messageId,
  hitTime,
  selectable = false,
  selected = false,
  onToggleSelect,
  onPin,
  onDelete,
}: {
  session: SessionSummary
  active: boolean
  /** 搜索命中时给出的一段上下文 */
  snippet?: string
  /** 搜索命中的消息 id；点击时直接定位到这一句 */
  messageId?: string
  /** 命中消息的时间，搜索结果显示用 */
  hitTime?: number
  /** 多选模式下点击整行是勾选，而不是打开会话 */
  selectable?: boolean
  selected?: boolean
  onToggleSelect?: () => void
  onPin?: () => void
  onDelete: () => void
}) {
  const t = useTranslate()
  const query = useSessionSearch((state) => state.query)
  // 只订阅「哪一条被长按」：这样切换高亮时只有这一条重渲染，列表不整片重绘
  const activeHit = useActiveHit((state) => state.hit)
  // 搜索结果里只高亮点开的那一条，不能因为同属一个会话就整片亮
  const isActive = messageId
    ? Boolean(activeHit) &&
      activeHit?.sessionId === session.id &&
      activeHit.messageId === messageId
    : active
  const [editing, setEditing] = useState(false)
  /** 长按时的临时高亮：不写进 activeHit，避免把点开那条的持续高光迁走 */
  const [longPressLit, setLongPressLit] = useState(false)
  const pressed = longPressLit
  /** 三点菜单的打开函数：长按列表项时直接调用它 */
  const menuToggleRef = useRef<(() => void) | null>(null)
  const longPressRef = useRef<number | null>(null)
  const pressStartRef = useRef<{ x: number; y: number } | null>(null)
  const longPressedRef = useRef(false)
  /** 列表项本身：三点按钮去掉后，长按菜单用它定位 */
  const itemRef = useRef<HTMLDivElement>(null)
  /** 当前菜单是不是长按打开的：关闭时要顺手清掉高亮 */
  const longPressMenuRef = useRef(false)
  /** 菜单刚关闭的时间：这之后的短时间里，点击不该再打开会话 */
  const menuClosedAtRef = useRef(0)

  const clearLongPress = () => {
    if (longPressRef.current !== null) {
      window.clearTimeout(longPressRef.current)
      longPressRef.current = null
    }
    pressStartRef.current = null
  }
  const displayTitle = session.title || t('untitledChat')
  const pinned = Boolean(session.pinnedAt)
  const manualCompress = useSettings((state) => state.manualCompress)
  const organizer = useSettings((state) => state.sessionOrganizer)

  /** 导出这个对话：和全量导出共用队列，产物能被导入器直接读回；失败只提示，不影响会话本身。 */
  const exportOne = async () => {
    try {
      const { name, blob } = await exportSession(session.id)
      const saved = await saveBlob(blob, name)
      showToast(
        saved === 'failed'
          ? { key: 'sessionExportFailed', type: 'error' }
          : { key: 'sessionExportSaved' }
      )
    } catch {
      showToast({ key: 'sessionExportFailed', type: 'error' })
    }
  }

  if (editing) {
    const finish = (title: string) => {
      setEditing(false)
      if (title.trim() && title.trim() !== displayTitle) {
        renameSession(session.id, title.trim())
      }
    }
    return (
      <input
        className={styles.renameInput}
        defaultValue={displayTitle}
        autoFocus
        onFocus={(event) => event.target.select()}
        onBlur={(event) => finish(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
            finish(event.currentTarget.value)
          } else if (event.key === 'Escape') {
            setEditing(false)
          }
        }}
      />
    )
  }

  return (
    <div
      ref={itemRef}
      data-session-id={session.id}
      className={clsx(
        styles.item,
        isActive && styles.active,
        pressed && styles.pressed,
        snippet && styles.stacked
      )}
      onClick={() => {
        // 菜单刚关掉：这次点击是操作菜单的余波，不要打开会话
        if (Date.now() - menuClosedAtRef.current < 400) {
          return
        }
        // 点别的会话时，把之前选中的文字和系统选择工具条都清掉
        window.getSelection()?.removeAllRanges()
        // 长按刚弹过菜单：这次抬起的手势不再触发打开会话
        if (longPressedRef.current) {
          longPressedRef.current = false
          return
        }
        if (selectable) {
          onToggleSelect?.()
          return
        }
        selectSession(session.id)
        if (messageId) {
          setActiveHit(session.id, messageId)
          requestJump(session.id, messageId)
          // 退出全屏搜索页（关键词保留，下次进来还能接着看）
          if (document.activeElement instanceof HTMLElement) {
            document.activeElement.blur()
          }
          useSessionSearch.setState({ searchFocused: false, restoreSearch: true })
        } else {
          // 普通列表里点开一项，清掉长按留下的高亮，回到「当前会话高亮」
          useActiveHit.setState({ hit: null })
          // 标题命中的结果也来自搜索页：同样要退出并释放焦点，否则主界面会被搜索状态藏住
          if (document.activeElement instanceof HTMLElement) {
            document.activeElement.blur()
          }
          useSessionSearch.setState({ searchFocused: false, restoreSearch: true })
        }
        closeMobileSider()
      }}
      onPointerDown={(event) => {
        if (selectable) {
          return
        }
        pressStartRef.current = { x: event.clientX, y: event.clientY }
        longPressedRef.current = false
        longPressRef.current = window.setTimeout(() => {
          longPressRef.current = null
          longPressedRef.current = true
          // 触发时给一下震动，让用户知道长按生效了
          navigator.vibrate?.(40)
          // 长按的这条只做临时高亮，不改点开那条的持续高光
          setLongPressLit(true)
          longPressMenuRef.current = true
          // 等一帧：高亮渲染后三点按钮才显示，菜单才能锚在它旁边
          window.setTimeout(() => menuToggleRef.current?.(), 0)
        }, 500)
      }}
      onPointerMove={(event) => {
        const start = pressStartRef.current
        // 手指移动超过 8px 就算滚动，不触发长按
        if (
          start &&
          (Math.abs(event.clientX - start.x) > 8 || Math.abs(event.clientY - start.y) > 8)
        ) {
          clearLongPress()
        }
      }}
      onPointerUp={clearLongPress}
      onPointerCancel={clearLongPress}
      onPointerLeave={clearLongPress}
      // 整理模式下可以把会话直接拖到分组标题上
      draggable={organizer && !selectable}
      onDragStart={
        organizer
          ? (event) => {
              event.dataTransfer.setData('text/session-id', session.id)
              event.dataTransfer.effectAllowed = 'move'
            }
          : undefined
      }
    >
      {selectable ? (
        <span className={clsx(styles.check, selected && styles.checkOn)} aria-hidden>
          {selected ? <IconCheckOutline16 /> : null}
        </span>
      ) : null}
      <div className={styles.body}>
        <div className={styles.titleRow}>
          <div className={styles.title}>{displayTitle}</div>
          {hitTime ? <span className={styles.hitTime}>{formatHitTime(hitTime)}</span> : null}
        </div>
        {snippet ? <div className={styles.snippet}>{highlightSnippet(snippet, query)}</div> : null}
      </div>
      {selectable ? null : (
        <Menu
          anchorEl={itemRef.current}
          align="end"
          // 菜单最上面先给一条上下文用量：纯展示，替代不了任何操作
          header={<ContextUsageBar usage={session.contextUsage} />}
            onClose={() => {
              menuClosedAtRef.current = Date.now()
              if (longPressMenuRef.current) {
                longPressMenuRef.current = false
                // 只收长按的临时高亮，点开那条的持续高光保持不动
                setLongPressLit(false)
              }
            }}
            options={[
              {
                key: 'pin',
                label: t(pinned ? 'sessionItemMenuUnpinOption' : 'sessionItemMenuPinOption'),
                icon: <IconPinOutline16 />,
                onSelect: () => onPin?.(),
              },
              {
                key: 'rename',
                label: t('sessionItemMenuRenameOption'),
                icon: <IconEditOutline16 />,
                onSelect: () => setEditing(true),
              },
              {
                key: 'export',
                label: t('sessionItemMenuExportOption'),
                icon: <IconDownloadOutline16 />,
                onSelect: () => void exportOne(),
              },
              // 默认关：只有设置里开了「手动压缩上下文」才出现
              ...(manualCompress
                ? [
                    {
                      key: 'compress',
                      label: t('sessionItemMenuCompressOption'),
                      icon: <IconRefreshOutline16 />,
                      onSelect: () => {
                        void askManualCompress().then((confirmed) => {
                          if (confirmed) {
                            void compressContext(session.id)
                          }
                        })
                      },
                    },
                  ]
                : []),
              // 会话整理模式：把会话归进某个分组（只做归类）
              ...(organizer
                ? [
                    {
                      key: 'folder',
                      label: t('sessionFolderMenuOption'),
                      icon: <IconPanelLeftOutline16 />,
                      onSelect: () => {
                        void askSessionFolder(
                          useSessionFolders.getState().map[session.id] ?? null
                        ).then((folderId) => {
                          if (folderId !== undefined) {
                            assignSessionFolder(session.id, folderId)
                          }
                        })
                      },
                    },
                  ]
                : []),
              {
                key: 'delete',
                label: t('delete'),
                icon: <IconTrashOutline16 />,
                danger: true,
                onSelect: onDelete,
              },
            ]}
          >
            {({ toggle }) => {
              menuToggleRef.current = toggle
              return null
            }}
          </Menu>
      )}
    </div>
  )
})

/** 把片段里的所有命中词加粗标出来（同一个片段里可能有多处） */
const highlightSnippet = (text: string, query: string) => {
  const keyword = query.trim()
  if (!keyword) {
    return text
  }
  const lower = text.toLowerCase()
  const needle = keyword.toLowerCase()
  const parts: ReactNode[] = []
  let cursor = 0
  let index = lower.indexOf(needle)
  while (index >= 0) {
    if (index > cursor) {
      parts.push(text.slice(cursor, index))
    }
    parts.push(
      <mark key={index} className={styles.hit}>
        {text.slice(index, index + needle.length)}
      </mark>
    )
    cursor = index + needle.length
    index = lower.indexOf(needle, cursor)
  }
  if (cursor < text.length) {
    parts.push(text.slice(cursor))
  }
  return <>{parts}</>
}

/** 搜索结果的时间：今天 / 昨天 / 月日 / 年月日 */
const formatHitTime = (ts: number): string => {
  const date = new Date(ts)
  const now = new Date()
  const startOfDay = (value: Date) =>
    new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime()
  const today = startOfDay(now)
  const day = startOfDay(date)
  if (day === today) {
    return '今天'
  }
  if (day === today - 86_400_000) {
    return '昨天'
  }
  if (date.getFullYear() === now.getFullYear()) {
    return `${date.getMonth() + 1}月${date.getDate()}日`
  }
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`
}
