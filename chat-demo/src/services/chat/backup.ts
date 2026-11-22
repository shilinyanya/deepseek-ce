import { translate } from '../../i18n/index.js'
import { formatDate } from '../../utils/format.js'
import { createId } from '../../utils/id.js'
import * as db from './db.js'
import { addImportedSession, replaceHistory, useChatStore } from './store.js'
import type { Session } from './types.js'

export { BackupError } from './history/errors.js'

// 导入、导出与全部删除串行处理，避免读取归档时数据被清空或两个替换事务交错。
let backupQueue: Promise<unknown> = Promise.resolve()

const enqueueBackup = <T>(run: () => Promise<T>): Promise<T> => {
  const task = backupQueue.then(run)
  backupQueue = task.catch(() => {})
  return task
}

const backupFileName = (date: Date) => `deepseek_data-${formatDate(date)}.zip`

/**
 * 标题转文件名片段：路径分隔符、Windows 保留字符与控制字符换成下划线；
 * 按码点截断，避免把代理对切成半个字符；结尾的点和空格在 Windows 上会被文件系统吞掉。
 */
const safeFileNamePart = (value: string) => {
  const cleaned = value
    .normalize('NFC')
    .replace(/[\p{Cc}/\\:*?"<>|]/gu, '_')
    .replace(/\s+/g, ' ')
    .trim()
  return [...cleaned]
    .slice(0, 40)
    .join('')
    .replace(/[.\s]+$/, '')
}

/** 单个会话的导出文件名：deepseek_data-{日期}-{标题}.zip；标题为空（新对话）时只用日期。 */
const sessionFileName = (date: Date, title: string) => {
  const base = `deepseek_data-${formatDate(date)}`
  const suffix = safeFileNamePart(title)
  return suffix ? `${base}-${suffix}.zip` : `${base}.zip`
}

/** 导出为历史会话导出格式的 ZIP，可再次导入。 */
export const exportHistory = (
  onProgress?: (done: number, total: number) => void,
  signal?: AbortSignal
): Promise<{ name: string; blob: Blob }> =>
  enqueueBackup(async () => {
    // 列表和已加载内容保留导出开始时的快照；未打开的会话逐条读取，不填满详情缓存。
    const { sessions, sessionCache } = useChatStore.getState()
    let done = 0
    async function* readSessions(): AsyncGenerator<Session> {
      for (const summary of sessions) {
        if (signal?.aborted) {
          throw new DOMException('Export aborted', 'AbortError')
        }
        const session = Object.hasOwn(sessionCache, summary.id)
          ? sessionCache[summary.id]
          : await db.loadSession(summary.id)
        if (!session) {
          throw new Error(`History session disappeared during export: ${summary.id}`)
        }
        done += 1
        onProgress?.(done, sessions.length)
        // 详情读取期间可能重命名，归档标题与开始时的列表保持一致。
        yield { ...session, ...summary }
      }
    }
    const { exportArchive } = await import('./history/exportArchive.js')
    const now = new Date()
    const blob = await exportArchive(readSessions())
    return { name: backupFileName(now), blob }
  })

/**
 * 导出单个会话：与全量导出共用同一个队列和归档结构
 * （manifest → 该会话的 JSON → 只含这一条的索引 → 该会话的图片原件），产物可被导入器直接读回。
 */
export const exportSession = (sessionId: string): Promise<{ name: string; blob: Blob }> =>
  enqueueBackup(async () => {
    // 与全量导出一样，标题以列表为准；未打开的会话直接读库，不填满详情缓存。
    const { sessions, sessionCache } = useChatStore.getState()
    const session = Object.hasOwn(sessionCache, sessionId)
      ? sessionCache[sessionId]
      : await db.loadSession(sessionId)
    if (!session) {
      throw new Error(`History session disappeared during export: ${sessionId}`)
    }
    const summary = sessions.find((item) => item.id === sessionId)
    const snapshot: Session = summary ? { ...session, ...summary } : session
    const { exportArchive } = await import('./history/exportArchive.js')
    const blob = await exportArchive([snapshot])
    return { name: sessionFileName(new Date(), snapshot.title), blob }
  })

/**
 * 确认覆盖后调用：先检查 ZIP 格式与版本，校验失败时保留正在生成的回答；
 * 通过后从 ZIP 流式写入暂存，成功才替换原有会话与图片原件。返回导入的会话数。
 */
export const importHistory = (
  file: File,
  onProgress?: (done: number, total: number) => void,
  signal?: AbortSignal
): Promise<number> =>
  enqueueBackup(async () => {
    const { checkArchiveFormat, importArchive } = await import('./history/importArchive.js')
    await checkArchiveFormat(file)
    return replaceHistory(() => importArchive(file, onProgress, signal))
  })

/**
 * 合并导入单个会话：只把这个对话追加到现有列表，其他对话与附件一律不动，
 * 同一个文件导入两次会得到两个对话。全程走同一个队列，不会和全量与全量删除交错。
 * 归档里有多于一个对话时拒绝并提示改用全量导入。
 */
export const importSession = (
  file: File,
  onProgress?: (done: number, total: number) => void,
  signal?: AbortSignal
): Promise<number> =>
  enqueueBackup(async () => {
    const { checkArchiveFormat, importSingleSession } = await import('./history/importArchive.js')
    await checkArchiveFormat(file)
    const { session, files } = await importSingleSession(file, onProgress, signal)
    // 会话 ID 必须换新，否则会覆盖归档来源里同 ID 的已有会话；消息 ID 只在本会话内使用，保留原样。
    const imported: Session = {
      ...session,
      id: createId(),
      title: session.title.trim() || translate('importedSessionTitle'),
    }
    await db.saveSession(imported, files)
    addImportedSession(imported)
    return 1
  })

/** 确认删除后调用：以空历史原子替换全部本地会话与附件，保留 API Key 和其他设置。 */
export const clearHistory = (): Promise<void> =>
  enqueueBackup(async () => {
    await replaceHistory(async () => {})
  })
