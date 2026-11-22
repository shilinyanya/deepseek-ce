import clsx from 'clsx'
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import {
  IconChecklistOutline18,
  IconChevronDownOutline14,
  IconChevronRightOutline14,
  IconCloseFill14,
  IconDownloadOutline16,
  IconEllipsisOutline16,
  IconEditOutline16,
  IconPinOutline16,
  IconUnpinOutline16,
  IconTrashOutline16,
  IconSearchOutline16,
  IconSettingsOutline16,
} from '../base/icons.js'
import { Menu } from '../base/Menu.js'
import { exportSession } from '../../services/chat/backup.js'
import { saveBlob } from '../../utils/download.js'
import { useSettings } from '../../services/settings.js'
import {
  assignSessionFolder,
  removeSessionFolder,
  renameSessionFolder,
  useSessionFolders,
} from '../../services/chat/sessionFolders.js'
import { groupSessions } from '../../services/chat/sessionGroups.js'
import { searchSessions, type SessionSearchHit } from '../../services/chat/search.js'
import {
  getSearchScrollTop,
  setSearchScrollTop,
  useSessionSearch,
} from '../../services/chat/searchState.js'
import {
  pinSession,
  removeSession,
  removeSessions,
  useChatStore,
} from '../../services/chat/store.js'
import type { SessionSummary } from '../../services/chat/types.js'
import { Button } from '../base/Button.js'
import { IconButton } from '../base/IconButton.js'
import { Modal } from '../base/Modal.js'
import { showToast } from '../base/toastState.js'
import { openSettings } from '../settings/settingsDialogState.js'
import { closeMobileSider, openMobileSider, useMobileSider } from './mobileSiderState.js'
import { SessionItem } from './SessionItem.js'
import styles from './Sider.module.css'

/** 搜索输入到发起查询之间的等待时间 */
const SEARCH_DEBOUNCE = 250
/** 搜索每页加载多少条命中 */
const SEARCH_PAGE = 30

/**
 * 展开的侧边栏：名称与收起按钮、搜索框、开启新对话、
 * 置顶分组 + 按时间分组的会话列表、底部设置；多选模式下底部换成批量操作栏。
 */
export const Sider = memo(function Sider({ mobile = false }: { mobile?: boolean }) {
  const t = useTranslate()
  const sessions = useChatStore((state) => state.sessions)
  const activeId = useChatStore((state) => state.activeId)
  const [now, setNow] = useState(Date.now)
  // 搜索状态放在 store 里：移动端抽屉关闭会卸载 Sider，组件内 state 会丢
  const query = useSessionSearch((state) => state.query)
  const hits = useSessionSearch((state) => state.hits)
  const searching = useSessionSearch((state) => state.searching)
  const setQuery = (value: string) => useSessionSearch.setState({ query: value })
  const setHits = (value: SessionSearchHit[] | null) => useSessionSearch.setState({ hits: value })
  const setSearching = (value: boolean) => useSessionSearch.setState({ searching: value })
  const [pinnedOpen, setPinnedOpen] = useState(true)
  /** 当前贴在列表顶部的分组标题：选择按钮只跟着它出现，上一组滑走后下一组才显示 */
  const [stickyHeaderKey, setStickyHeaderKey] = useState<string | null>(null)
  const [selectMode, setSelectMode] = useState(false)
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set())
  const [pinConfirm, setPinConfirm] = useState(false)
  const [exportConfirm, setExportConfirm] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [deleting, setDeleting] = useState<SessionSummary | null>(null)
  const [batchDeleting, setBatchDeleting] = useState(false)
  const [deletePending, setDeletePending] = useState(false)
  const searchToken = useRef(0)
  const offsetRef = useRef(0)
  const [loadingMore, setLoadingMore] = useState(false)
  /** 搜索框聚焦即进入全屏搜索页 */
  const searchFocused = useSessionSearch((state) => state.searchFocused)
  const setSearchFocused = (value: boolean) =>
    useSessionSearch.setState({ searchFocused: value })
  /** 手势期间锁住列表滚动：直接改 DOM，避免 state 异步导致先滚一下 */
  const gestureLockedRef = useRef(false)

  useEffect(() => {
    const release = () => {
      if (gestureLockedRef.current && listRef.current) {
        listRef.current.style.overflowY = ''
        gestureLockedRef.current = false
      }
    }
    window.addEventListener('pointerup', release)
    window.addEventListener('pointercancel', release)
    return () => {
      window.removeEventListener('pointerup', release)
      window.removeEventListener('pointercancel', release)
    }
  }, [])
  const total = useSessionSearch((state) => state.total)
  const hasMore = useSessionSearch((state) => state.hasMore)
  const listRef = useRef<HTMLDivElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const restoredRef = useRef(false)

  /** 找出当前贴在列表顶部的分组标题（sticky 顶住的那一行） */
  const updateStickyHeader = () => {
    const list = listRef.current
    if (!list) {
      return
    }
    const listTop = list.getBoundingClientRect().top
    let key: string | null = null
    for (const header of list.querySelectorAll<HTMLElement>('[data-group-header]')) {
      const rect = header.getBoundingClientRect()
      if (rect.top <= listTop + 1 && rect.bottom > listTop) {
        key = header.dataset.groupHeader ?? null
      }
    }
    // 特例：列表在顶部时置顶标题不算「贴顶」（section 有内边距），
    // 但这时也应该显示选择按钮，所以直接取第一个分组标题
    if (list.scrollTop <= 0) {
      key = list.querySelector<HTMLElement>('[data-group-header]')?.dataset.groupHeader ?? key
    }
    setStickyHeaderKey((current) => (current === key ? current : key))
  }

  // 列表或分组变化后重新确定当前贴顶的标题
  useLayoutEffect(() => {
    updateStickyHeader()
  })

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>
    const refresh = () => {
      clearTimeout(timer)
      const time = Date.now()
      setNow(time)
      const midnight = new Date(time).setHours(24, 0, 0, 0)
      timer = setTimeout(refresh, midnight - time)
    }
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        refresh()
      }
    }
    refresh()
    document.addEventListener('visibilitychange', onVisibilityChange)
    window.addEventListener('focus', refresh)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      window.removeEventListener('focus', refresh)
    }
  }, [])

  // 键盘收起（任何原因）时，没内容就退回上一步：用视口高度差判断键盘开合
  useEffect(() => {
    let maxHeight = window.innerHeight
    let wasOpen = false
    const onResize = () => {
      const height = window.innerHeight
      if (height > maxHeight) {
        maxHeight = height
      }
      const open = height < maxHeight - 120
      if (open) {
        wasOpen = true
        return
      }
      if (!wasOpen) {
        return
      }
      wasOpen = false
      // 键盘收起可能只是弹起/重排过程中的一次抖动：等一拍再决定是否退回
      window.setTimeout(() => {
        const state = useSessionSearch.getState()
        if (
          state.searchFocused &&
          !state.query.trim() &&
          document.activeElement !== searchInputRef.current
        ) {
          if (document.activeElement instanceof HTMLElement) {
            document.activeElement.blur()
          }
          useSessionSearch.setState({ searchFocused: false })
        }
      }, 250)
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  // 搜索：输入停下 250ms 后先查第一批，往下滑时再继续加载
  useEffect(() => {
    const keyword = query.trim()
    if (!keyword) {
      searchToken.current += 1
      offsetRef.current = 0
      setHits(null)
      setSearching(false)
      useSessionSearch.setState({ total: 0, hasMore: false })
      return
    }
    setSearching(true)
    const token = (searchToken.current += 1)
    offsetRef.current = 0
    const timer = setTimeout(() => {
      void searchSessions(keyword, 0, SEARCH_PAGE)
        .then((result) => {
          if (token === searchToken.current) {
            setHits(result.hits)
            offsetRef.current = result.hits.length
            useSessionSearch.setState({ total: result.total, hasMore: result.hasMore })
          }
        })
        .catch(() => {
          if (token === searchToken.current) {
            setHits([])
            useSessionSearch.setState({ total: 0, hasMore: false })
          }
        })
        .finally(() => {
          if (token === searchToken.current) {
            setSearching(false)
          }
        })
    }, SEARCH_DEBOUNCE)
    return () => clearTimeout(timer)
  }, [query])

  // 抽屉关闭会卸载组件；重新打开搜索时回到上次看到的位置
  useLayoutEffect(() => {
    if (!query.trim() || restoredRef.current) {
      return
    }
    const el = listRef.current
    if (el && el.scrollHeight > 0) {
      el.scrollTop = getSearchScrollTop()
      restoredRef.current = true
    }
  }, [query, hits])

  /** 列表滑到底部附近时，再加载下一批命中 */
  const loadMore = () => {
    const keyword = query.trim()
    if (!keyword || !useSessionSearch.getState().hasMore || loadingMore) {
      return
    }
    setLoadingMore(true)
    const token = searchToken.current
    void searchSessions(keyword, offsetRef.current, SEARCH_PAGE)
      .then((result) => {
        if (token !== searchToken.current) {
          return
        }
        useSessionSearch.setState((state) => ({
          hits: [...(state.hits ?? []), ...result.hits],
          hasMore: result.hasMore,
        }))
        offsetRef.current += result.hits.length
      })
      .finally(() => {
        setLoadingMore(false)
      })
  }

  const pinned = useMemo(
    () =>
      sessions
        .filter((session) => session.pinnedAt)
        .sort((a, b) => (b.pinnedAt ?? 0) - (a.pinnedAt ?? 0)),
    [sessions]
  )
  const unpinned = useMemo(() => sessions.filter((session) => !session.pinnedAt), [sessions])
  /** 普通列表也分批渲染：一次全量渲染几千条会拖慢抽屉打开 */
  const [visibleCount, setVisibleCount] = useState(40)
  const visibleUnpinned = useMemo(
    () => unpinned.slice(0, visibleCount),
    [unpinned, visibleCount]
  )
  const hasMoreSessions = unpinned.length > visibleCount
  // 会话整理模式：分到自定义分组的会话单独成节，剩下的仍按时间分组
  const organizer = useSettings((state) => state.sessionOrganizer)
  /** 拖动会话时高亮的分组标题 */
  const [dropFolderId, setDropFolderId] = useState<string | null>(null)
  /** 正在重命名的分组 */
  const [editingFolder, setEditingFolder] = useState<{ id: string; name: string } | null>(null)
  const folderList = useSessionFolders((state) => state.folders)
  const folderMap = useSessionFolders((state) => state.map)
  const folderIds = useMemo(() => new Set(folderList.map((folder) => folder.id)), [folderList])
  const inFolder = useCallback(
    (session: SessionSummary) => {
      const folderId = folderMap[session.id]
      return Boolean(folderId && folderIds.has(folderId))
    },
    [folderMap, folderIds]
  )
  const folderSections = useMemo(() => {
    if (!organizer) {
      return []
    }
    // 空分组也要渲染：否则新建的分组没有落点，会话拖不进去
    return folderList.map((folder) => ({
      folder,
      sessions: unpinned.filter((session) => folderMap[session.id] === folder.id),
    }))
  }, [organizer, folderList, folderMap, unpinned])
  const restUnpinned = useMemo(
    () => (organizer ? visibleUnpinned.filter((session) => !inFolder(session)) : visibleUnpinned),
    [organizer, visibleUnpinned, inFolder]
  )
  const groups = useMemo(() => groupSessions(restUnpinned, now, t), [restUnpinned, now, t])

  const searchingActive = query.trim().length > 0
  /** 全屏搜索页：只看搜索框是否聚焦，残留关键词不算（否则退出后主界面还是藏着的） */
  const searchMode = searchFocused
  // 移动端进入搜索页时把右侧主对话藏起来
  useEffect(() => {
    if (!mobile) {
      return
    }
    document.body.classList.toggle('dsh-search-mode', searchMode)
    return () => document.body.classList.remove('dsh-search-mode')
  }, [mobile, searchMode])
  const visibleIds = useMemo(
    () =>
      searchingActive
        ? (hits ?? []).map((hit) => hit.id)
        : [...pinned, ...groups.flatMap((group) => group.sessions)].map((session) => session.id),
    [searchingActive, hits, pinned, groups]
  )
  const allSelected =
    visibleIds.length > 0 && visibleIds.every((id) => selected.has(id))

  const toggleSelectMode = () => {
    setSelectMode((on) => {
      if (on) {
        setSelected(new Set())
      }
      return !on
    })
  }

  const toggleSelected = (id: string) => {
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  /** 选中的会话是否全部已置顶（决定按钮显示「置顶」还是「取消置顶」） */
  const selectedAllPinned =
    selected.size > 0 &&
    [...selected].every((id) => sessions.find((item) => item.id === id)?.pinnedAt)

  /** 批量置顶/取消置顶选中的会话 */
  const pinSelected = () => {
    for (const id of selected) {
      const session = sessions.find((item) => item.id === id)
      if (!session) {
        continue
      }
      if (selectedAllPinned) {
        pinSession(id, false)
      } else if (!session.pinnedAt) {
        pinSession(id, true)
      }
    }
    setSelectMode(false)
    setSelected(new Set())
  }

  /** 批量导出选中的会话：逐个保存 */
  const exportSelected = async () => {
    if (selected.size === 0 || exporting) {
      return
    }
    setExporting(true)
    try {
      for (const id of selected) {
        const { name, blob } = await exportSession(id)
        await saveBlob(blob, name)
      }
      showToast({ key: 'sessionExportSaved' })
      setSelectMode(false)
      setSelected(new Set())
    } catch {
      showToast({ key: 'sessionExportFailed', type: 'error' })
    } finally {
      setExporting(false)
    }
  }

  const confirmBatchDelete = async () => {
    setDeletePending(true)
    try {
      const removed = await removeSessions([...selected])
      if (removed === 0) {
        showToast({ key: 'sessionDeleteFailed', type: 'error' })
      }
      setBatchDeleting(false)
      setSelectMode(false)
      setSelected(new Set())
    } finally {
      setDeletePending(false)
    }
  }

  const renderItem = (session: SessionSummary | SessionSearchHit) => {
    const hitMessageId = 'messageId' in session ? session.messageId : undefined
    // 当前打开的会话始终用选中色；长按的高亮由 SessionItem 自己订阅
    const active = session.id === activeId
    return (
    <SessionItem
      key={hitMessageId ? `${session.id}:${hitMessageId}` : session.id}
      session={session}
      active={active}
      snippet={'snippet' in session ? session.snippet : undefined}
      messageId={'messageId' in session ? session.messageId : undefined}
      selectable={selectMode}
      selected={selected.has(session.id)}
      onToggleSelect={() => toggleSelected(session.id)}
      onPin={() => pinSession(session.id, !session.pinnedAt)}
      onDelete={() => setDeleting(session)}
      hitTime={'hitAt' in session ? session.hitAt : undefined}
    />
    )
  }

  return (
    <div
      className={clsx(styles.sider, mobile && styles.mobile, searchMode && styles.searchMode)}
      // 点侧栏任何位置都取消上一次在消息里选中的文字
      onPointerDown={() => window.getSelection()?.removeAllRanges()}
    >
      {selectMode ? (
        <div className={styles.selectHeader}>
          <span className={styles.selectTitle}>
            {selected.size > 0
              ? t('siderSelectedDialogs', { count: selected.size })
              : t('siderSelectModeTitle')}
          </span>
          <div className={styles.selectHeaderRight}>
            <button
              type="button"
              className={styles.selectClose}
              aria-label={t('cancel')}
              onClick={toggleSelectMode}
            >
              <IconCloseFill14 />
            </button>
          </div>
        </div>
      ) : (
      <div className={styles.searchRow}>
        {searchMode ? (
          <button
            type="button"
            className={styles.searchBack}
            aria-label={t('cancel')}
            onClick={() => {
              // 退出全屏搜索页：回到侧栏列表，清空输入并移除焦点
              setQuery('')
              setSearchFocused(false)
              useSessionSearch.setState({ restoreSearch: false })
              if (document.activeElement instanceof HTMLElement) {
                document.activeElement.blur()
              }
            }}
          >
            <span className={styles.searchBackIcon}>
              <IconChevronRightOutline14 />
            </span>
          </button>
        ) : null}
        <div className={styles.search} onClick={() => searchInputRef.current?.focus()}>
          <span className={styles.searchIcon}>
            <IconSearchOutline16 />
          </span>
        <input
          ref={searchInputRef}
          className={styles.searchInput}
          onFocus={() => setSearchFocused(true)}
          onBlur={() => {
            // 输入法被返回手势收掉时输入框会失焦：等一拍确认没有重新聚焦再退回
            window.setTimeout(() => {
              const state = useSessionSearch.getState()
              if (
                state.searchFocused &&
                !state.query.trim() &&
                document.activeElement !== searchInputRef.current
              ) {
                useSessionSearch.setState({ searchFocused: false })
              }
            }, 120)
          }}
          value={query}
          placeholder={t('siderSearchPlaceholder')}
          spellCheck={false}
          onChange={(event) => setQuery(event.target.value)}
        />
        {query ? (
          <button
            type="button"
            className={styles.searchClear}
            aria-label={t('cancel')}
            onClick={() => setQuery('')}
          >
            <IconCloseFill14 />
          </button>
        ) : null}
        </div>
      </div>
      )}
      <div className={styles.listWrap}>
        <div
          ref={listRef}
          className={styles.list}
          onPointerDown={() => {
            // 菜单开着时开始的手势：整段锁住滚动，抬手后由 window 监听恢复
            if (document.body.classList.contains('dsh-menu-open') && listRef.current) {
              listRef.current.style.overflowY = 'hidden'
              gestureLockedRef.current = true
            }
          }}
          onScroll={(event) => {
            const el = event.currentTarget
            setSearchScrollTop(el.scrollTop)
            updateStickyHeader()
            if (!searchingActive) {
              // 普通列表：滑到底再多渲染一批
              if (el.scrollTop + el.clientHeight >= el.scrollHeight - 240) {
                setVisibleCount((count) => count + 40)
              }
              return
            }
            if (el.scrollTop + el.clientHeight >= el.scrollHeight - 240) {
              loadMore()
            }
          }}
        >
          {searchMode ? (
            <div className={styles.section}>
              {searchingActive ? (
                <div className={styles.sectionHeader}>
                  {searching ? t('siderSearching') : t('siderSearchCount', { count: total })}
                </div>
              ) : null}
              {searching && searchingActive ? <SkeletonList /> : null}
              {searching ? null : (
                <>
              {(hits ?? []).map(renderItem)}
              {searchingActive && !searching && hits && hasMore ? (
                <div className={styles.loadingMore}>
                  <span className={styles.loadingSpinner} />
                  {t('siderLoadingMore')}
                </div>
              ) : null}
              {hits && hits.length === 0 ? (
                <div className={styles.empty}>{t('siderSearchNoResult')}</div>
              ) : null}
                </>
              )}
            </div>
          ) : (
            <>
              {pinned.length > 0 ? (
                <div className={styles.section}>
                  <div className={styles.sectionHeader} data-group-header="pinned">
                    <button
                      type="button"
                      className={styles.sectionToggle}
                      onClick={() => setPinnedOpen((open) => !open)}
                    >
                      {t('siderPinnedSection', { count: pinned.length })}
                      <span
                        className={clsx(styles.chevron, !pinnedOpen && styles.chevronClosed)}
                      >
                        <IconChevronDownOutline14 />
                      </span>
                    </button>
                    {!selectMode && stickyHeaderKey === 'pinned' ? (
                      <IconButton
                        size="xs"
                        flat
                        icon={<IconChecklistOutline18 />}
                        tooltip={selectMode ? t('siderSelectDone') : t('siderSelectMode')}
                        tooltipPlacement="bottom"
                        onClick={toggleSelectMode}
                      />
                    ) : null}
                  </div>
                  {pinnedOpen ? pinned.map(renderItem) : null}
                  <div className={styles.pinnedDivider} aria-hidden />
                </div>
              ) : null}
              {folderSections.map((section) => (
                <div key={section.folder.id} className={styles.section}>
                  <div
                    className={clsx(
                      styles.sectionHeader,
                      styles.folderHeader,
                      dropFolderId === section.folder.id && styles.folderDropTarget
                    )}
                    data-group-header={section.folder.id}
                    onDragOver={(event) => {
                      event.preventDefault()
                      setDropFolderId(section.folder.id)
                    }}
                    onDragLeave={() => setDropFolderId(null)}
                    onDrop={(event) => {
                      event.preventDefault()
                      const dragged = event.dataTransfer.getData('text/session-id')
                      if (dragged) {
                        assignSessionFolder(dragged, section.folder.id)
                      }
                      setDropFolderId(null)
                    }}
                  >
                    {editingFolder?.id === section.folder.id ? (
                      <input
                        className={styles.folderRenameInput}
                        autoFocus
                        defaultValue={editingFolder.name}
                        onBlur={(event) => {
                          renameSessionFolder(section.folder.id, event.target.value)
                          setEditingFolder(null)
                        }}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                            renameSessionFolder(section.folder.id, event.currentTarget.value)
                            setEditingFolder(null)
                          } else if (event.key === 'Escape') {
                            setEditingFolder(null)
                          }
                        }}
                      />
                    ) : (
                      <>
                        <span className={styles.folderName}>{section.folder.name}</span>
                        <Menu
                          options={[
                            {
                              key: 'rename',
                              label: t('folderRename'),
                              icon: <IconEditOutline16 />,
                              onSelect: () =>
                                setEditingFolder({
                                  id: section.folder.id,
                                  name: section.folder.name,
                                }),
                            },
                            {
                              key: 'delete',
                              label: t('folderDelete'),
                              icon: <IconTrashOutline16 />,
                              danger: true,
                              onSelect: () => {
                                removeSessionFolder(section.folder.id)
                                showToast({ key: 'folderDeleted' })
                              },
                            },
                          ]}
                        >
                          {({ toggle }) => (
                            <IconButton
                              size="xs"
                              icon={<IconEllipsisOutline16 />}
                              aria-label={t('folderActions')}
                              onClick={toggle}
                            />
                          )}
                        </Menu>
                      </>
                    )}
                  </div>
                  {section.sessions.length > 0 ? (
                    section.sessions.map(renderItem)
                  ) : (
                    <div className={styles.folderEmpty}>{t('folderEmptyHint')}</div>
                  )}
                </div>
              ))}
              {groups.map((group) => (
                <div key={group.key} className={styles.section}>
                  <div className={styles.sectionHeader} data-group-header={group.key}>
                    <span>{group.label}</span>
                    {!selectMode && stickyHeaderKey === group.key ? (
                      <IconButton
                        size="xs"
                        flat
                        icon={<IconChecklistOutline18 />}
                        tooltip={selectMode ? t('siderSelectDone') : t('siderSelectMode')}
                        tooltipPlacement="bottom"
                        onClick={toggleSelectMode}
                      />
                    ) : null}
                  </div>
                  {group.sessions.map(renderItem)}
                </div>
              ))}
              {hasMoreSessions ? (
                <div className={styles.loadingMore}>
                  <span className={styles.loadingSpinner} />
                  {t('siderLoadingMore')}
                </div>
              ) : null}
            </>
          )}
        </div>
      </div>
      {selectMode ? (
        <div className={styles.selectBar}>
          <button
            type="button"
            className={styles.selectAction}
            disabled={selected.size === 0}
            onClick={() => setPinConfirm(true)}
          >
            {selectedAllPinned ? <IconUnpinOutline16 /> : <IconPinOutline16 />}
            {selectedAllPinned ? t('siderSelectUnpin') : t('siderSelectPin')}
          </button>
          <button
            type="button"
            className={styles.selectAction}
            disabled={selected.size === 0 || exporting}
            onClick={() => setExportConfirm(true)}
          >
            <IconDownloadOutline16 />
            {t('siderSelectExport')}
          </button>
          <button
            type="button"
            className={clsx(styles.selectAction, styles.selectDanger)}
            disabled={selected.size === 0 || deletePending}
            onClick={() => setBatchDeleting(true)}
          >
            <IconTrashOutline16 />
            {t('delete')}
          </button>
        </div>
      ) : searchMode ? null : (
        <div className={styles.bottom}>
          <button type="button" className={styles.settings} onClick={() => openSettings('general')}>
            <span className={styles.settingsIcon}>
              <IconSettingsOutline16 />
            </span>
            <span className={styles.settingsLabel}>{t('settings')}</span>
          </button>
        </div>
      )}
      {deleting ? (
        <Modal
          title={t('deleteSessionModalContentTitle')}
          onClose={() => {
            if (!deletePending) {
              setDeleting(null)
            }
          }}
          footer={
            <>
              <Button variant="outlined" disabled={deletePending} onClick={() => setDeleting(null)}>
                {t('cancel')}
              </Button>
              <Button
                variant="danger"
                disabled={deletePending}
                onClick={async () => {
                  setDeletePending(true)
                  try {
                    if (await removeSession(deleting.id)) {
                      setDeleting(null)
                    } else {
                      showToast({ key: 'sessionDeleteFailed', type: 'error' })
                    }
                  } finally {
                    setDeletePending(false)
                  }
                }}
              >
                {t('delete')}
              </Button>
            </>
          }
        >
          {t('deleteSessionWithFilesDescription')}
        </Modal>
      ) : null}
      {pinConfirm ? (
        <Modal
          title={t(
            selectedAllPinned ? 'siderUnpinConfirmTitle' : 'siderPinConfirmTitle',
            { count: selected.size }
          )}
          onClose={() => setPinConfirm(false)}
          footer={
            <>
              <Button variant="outlined" onClick={() => setPinConfirm(false)}>
                {selectedAllPinned ? t('keep') : t('cancel')}
              </Button>
              <Button
                onClick={() => {
                  setPinConfirm(false)
                  pinSelected()
                }}
              >
                {selectedAllPinned ? t('siderSelectUnpin') : t('siderSelectPin')}
              </Button>
            </>
          }
        >
          <span />
        </Modal>
      ) : null}
      {exportConfirm ? (
        <Modal
          title={t('siderExportConfirmTitle', { count: selected.size })}
          onClose={() => setExportConfirm(false)}
          footer={
            <>
              <Button variant="outlined" onClick={() => setExportConfirm(false)}>
                {t('cancel')}
              </Button>
              <Button
                onClick={() => {
                  setExportConfirm(false)
                  void exportSelected()
                }}
              >
                {t('siderSelectExport')}
              </Button>
            </>
          }
        >
          <span />
        </Modal>
      ) : null}
      {batchDeleting ? (
        <Modal
          title={t('siderBatchDeleteTitle', { count: selected.size })}
          onClose={() => {
            if (!deletePending) {
              setBatchDeleting(false)
            }
          }}
          footer={
            <>
              <Button
                variant="outlined"
                disabled={deletePending}
                onClick={() => setBatchDeleting(false)}
              >
                {t('cancel')}
              </Button>
              <Button variant="danger" disabled={deletePending} onClick={() => void confirmBatchDelete()}>
                {t('delete')}
              </Button>
            </>
          }
        >
          {t('deleteSessionWithFilesDescription')}
        </Modal>
      ) : null}
    </div>
  )
})

/** 搜索结果加载中的骨架屏 */
const SkeletonList = () => (
  <div className={styles.skeletonList} aria-hidden>
    {[0, 1, 2, 3, 4].map((index) => (
      <div key={index} className={styles.skeletonItem}>
        <span className={styles.skeletonCircle} />
        <span className={styles.skeletonLines}>
          <span className={styles.skeletonLine} />
          <span className={styles.skeletonLineShort} />
        </span>
      </div>
    ))}
  </div>
)

/** 移动端抽屉：浮在页面上方，点空白区域关闭。 */
export const MobileSider = () => {
  const open = useMobileSider((state) => state.open)
  const drawerRef = useRef<HTMLDivElement>(null)

  // 抽屉开合时给 body 打标记，主界面据此右移并加蒙版
  useEffect(() => {
    document.body.classList.toggle('dsh-drawer-open', open)
    return () => document.body.classList.remove('dsh-drawer-open')
  }, [open])

  // 从搜索结果跳走后再打开抽屉：直接回到全屏搜索页，列表位置保持上次的
  useEffect(() => {
    if (!open) {
      return
    }
    const state = useSessionSearch.getState()
    if (state.restoreSearch && state.query.trim()) {
      useSessionSearch.setState({ searchFocused: true, restoreSearch: false })
    }
  }, [open])

  // 抽屉开着时，在任意位置左滑都能把它推回去（抽屉和右侧主界面行为一致）
  useEffect(() => {
    if (!open) {
      return
    }
    const drawer = drawerRef.current
    if (!drawer) {
      return
    }
    const gesture = { startX: 0, startY: 0, dx: 0, active: false, startTime: 0 }

    const onStart = (event: TouchEvent) => {
      const touch = event.touches[0]
      gesture.startX = touch.clientX
      gesture.startY = touch.clientY
      gesture.dx = 0
      gesture.active = false
      gesture.startTime = Date.now()
      // 手指一落下就让抽屉内容提前渲染，滑开时不再临时绘制
      document.body.classList.add('dsh-drawer-prewarm')
    }

    const onMove = (event: TouchEvent) => {
      const touch = event.touches[0]
      const dx = touch.clientX - gesture.startX
      const dy = touch.clientY - gesture.startY
      if (!gesture.active) {
        if (dx > -4 || Math.abs(dx) <= Math.abs(dy)) {
          return
        }
        gesture.active = true
        document.body.classList.add('dsh-dragging')
        drawer.style.transition = 'none'
      }
      const width = drawer.offsetWidth || 280
      // 钳在 [-width, 0]：手指反向（向右）时不能把抽屉拖出屏幕
      gesture.dx = Math.max(Math.min(dx, 0), -width)
      drawer.style.transform = `translateX(${gesture.dx}px)`
      const progress = Math.max(0, 1 + gesture.dx / width)
      document.documentElement.style.setProperty('--drawer-progress', String(progress))
      document.documentElement.style.setProperty('--drawer-mask', String(progress))
    }

    const onEnd = () => {
      document.body.classList.remove('dsh-drawer-prewarm')
      if (!gesture.active) {
        return
      }
      gesture.active = false
      const width = drawer.offsetWidth || 280
      const elapsed = Math.max(Date.now() - gesture.startTime, 1)
      const velocity = Math.abs(gesture.dx) / elapsed
      drawer.style.transition = ''
      drawer.style.transform = ''
      document.body.classList.remove('dsh-dragging')
      document.documentElement.style.removeProperty('--drawer-progress')
      document.documentElement.style.removeProperty('--drawer-mask')
      if (Math.abs(gesture.dx) > width * 0.65 || velocity > 0.3) {
        const state = useSessionSearch.getState()
        if (state.searchFocused) {
          // 搜索页左滑：把搜索搁置起来（保留关键词、结果和滚动位置），关抽屉；
          // 下次打开侧栏时 restoreSearch 会让它继续这个搜索
          useSessionSearch.setState({ searchFocused: false, restoreSearch: true })
          if (document.activeElement instanceof HTMLElement) {
            document.activeElement.blur()
          }
        }
        closeMobileSider()
      }
    }

    document.addEventListener('touchstart', onStart, { passive: true })
    document.addEventListener('touchmove', onMove, { passive: true })
    document.addEventListener('touchend', onEnd)
    document.addEventListener('touchcancel', onEnd)
    return () => {
      document.removeEventListener('touchstart', onStart)
      document.removeEventListener('touchmove', onMove)
      document.removeEventListener('touchend', onEnd)
      document.removeEventListener('touchcancel', onEnd)
    }
  }, [open])

  // 抽屉关着时，在主界面右滑也能把它拉出来（和关闭时对称的跟手 + 甩动）
  useEffect(() => {
    if (open) {
      return
    }
    const drawer = drawerRef.current
    if (!drawer) {
      return
    }
    const gesture = {
      startX: 0,
      startY: 0,
      dx: 0,
      active: false,
      startTime: 0,
    }

    const onStart = (event: TouchEvent) => {
      const touch = event.touches[0]
      gesture.startX = touch.clientX
      gesture.startY = touch.clientY
      gesture.dx = 0
      gesture.active = false
      gesture.startTime = Date.now()
      // 手指一落下就让抽屉内容提前渲染，滑开时不再临时绘制
      document.body.classList.add('dsh-drawer-prewarm')
    }

    const onMove = (event: TouchEvent) => {
      const touch = event.touches[0]
      const dx = touch.clientX - gesture.startX
      const dy = touch.clientY - gesture.startY
      if (!gesture.active) {
        // 只认明显向右的水平手势，竖向留给列表滚动
        if (dx < 8 || Math.abs(dx) <= Math.abs(dy)) {
          return
        }
        gesture.active = true
        // 确认是向右滑打开抽屉之后才收键盘：向左、向上、向下滑动都不收
        const active = document.activeElement
        if (
          active instanceof HTMLElement &&
          (active.tagName === 'TEXTAREA' || active.tagName === 'INPUT')
        ) {
          active.blur()
          ;(
            window as unknown as { AndroidBridge?: { hideKeyboard?: () => void } }
          ).AndroidBridge?.hideKeyboard?.()
        }
        document.body.classList.add('dsh-dragging', 'dsh-drawer-open', 'dsh-drawer-dragging')
        drawer.style.transition = 'none'
      }
      const width = drawer.offsetWidth || 280
      // 钳在 [0, width]：手指反向（向左）时不能把抽屉/主界面拖出屏幕
      gesture.dx = Math.min(Math.max(dx, 0), width)
      drawer.style.transform = `translateX(${-width + gesture.dx}px)`
      const progress = gesture.dx / width
      document.documentElement.style.setProperty('--drawer-progress', String(progress))
      document.documentElement.style.setProperty('--drawer-mask', String(progress))
    }

    const onEnd = () => {
      document.body.classList.remove('dsh-drawer-prewarm')
      if (!gesture.active) {
        return
      }
      gesture.active = false
      const width = drawer.offsetWidth || 280
      const elapsed = Math.max(Date.now() - gesture.startTime, 1)
      const velocity = gesture.dx / elapsed
      drawer.style.transition = ''
      drawer.style.transform = ''
      document.documentElement.style.removeProperty('--drawer-progress')
      document.documentElement.style.removeProperty('--drawer-mask')
      if (gesture.dx > width * 0.65 || velocity > 0.3) {
        document.body.classList.add('dsh-drawer-open')
        openMobileSider()
        // 等 React 加上 .drawerLayerOpen 后再撤临时类，避免空一帧
        window.requestAnimationFrame(() => {
          document.body.classList.remove('dsh-dragging', 'dsh-drawer-dragging')
        })
      } else {
        document.body.classList.remove('dsh-dragging', 'dsh-drawer-dragging')
        document.body.classList.remove('dsh-drawer-open')
      }
    }

    document.addEventListener('touchstart', onStart, { passive: true })
    document.addEventListener('touchmove', onMove, { passive: true })
    document.addEventListener('touchend', onEnd)
    document.addEventListener('touchcancel', onEnd)
    return () => {
      document.removeEventListener('touchstart', onStart)
      document.removeEventListener('touchmove', onMove)
      document.removeEventListener('touchend', onEnd)
      document.removeEventListener('touchcancel', onEnd)
    }
  }, [open])

  // 常驻不卸载：抽屉关掉再打开时，搜索列表的滚动位置和结果都还在，不会先跳回顶部再闪回来
  return (
    <div className={clsx(styles.drawerLayer, open && styles.drawerLayerOpen)}>
      <div className={styles.drawerMask} onClick={closeMobileSider} />
      <div ref={drawerRef} className={styles.drawer}>
        <Sider mobile />
      </div>
    </div>
  )
}
