import * as db from '../db.js'
import type { Session } from '../types.js'
import { BackupError, fail } from './errors.js'
import type { SessionIndexEntry } from './format.js'
import { INDEX_PATH, MANIFEST_PATH, USER_PATH, parseSessionPath, sessionFilesDir } from './paths.js'
import { checkManifest, readSessionFile, readSessionIndex } from './schema.js'
import { toLocalSession, type LocalSession } from './toLocal.js'
import {
  ArchiveError,
  isZipFile,
  readArchive,
  readEntry,
  skipEntry,
  type ArchiveEntry,
  type ArchiveProgress,
} from './zipReader.js'

/** 从原件字节补充图片 MIME；无法识别时为空字符串，图片身份仍由归档的 is_image 决定。 */
const imageType = (bytes: Uint8Array): string => {
  const startsWith = (...prefix: number[]) => prefix.every((byte, index) => bytes[index] === byte)
  const header = new TextDecoder('ascii').decode(bytes.subarray(0, 12))
  if (startsWith(0xff, 0xd8, 0xff)) {
    return 'image/jpeg'
  }
  if (startsWith(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) {
    return 'image/png'
  }
  if (header.startsWith('GIF87a') || header.startsWith('GIF89a')) {
    return 'image/gif'
  }
  if (header.startsWith('RIFF') && header.slice(8, 12) === 'WEBP') {
    return 'image/webp'
  }
  if (startsWith(0x42, 0x4d)) {
    return 'image/bmp'
  }
  if (startsWith(0x49, 0x49, 0x2a, 0) || startsWith(0x4d, 0x4d, 0, 0x2a)) {
    return 'image/tiff'
  }
  if (header.slice(4, 8) === 'ftyp' && ['avif', 'avis'].includes(header.slice(8, 12))) {
    return 'image/avif'
  }
  return ''
}

const readJson = async (entry: ArchiveEntry): Promise<unknown> => {
  const text = await (await readEntry(entry)).text()
  try {
    return JSON.parse(text)
  } catch {
    return fail('backupInvalidJson')
  }
}

/**
 * 检查 ZIP 格式、首个 manifest 条目及格式版本。
 * 校验失败时保留正在生成的回答和现有暂存数据。
 */
export const checkArchiveFormat = async (file: File): Promise<void> => {
  if (!(await isZipFile(file))) {
    fail('backupUnrecognized')
  }
  try {
    for await (const entry of readArchive(file)) {
      if (entry.path !== MANIFEST_PATH) {
        fail('backupUnrecognized')
      }
      checkManifest(await readJson(entry))
      return
    }
  } catch (error) {
    throw error instanceof ArchiveError ? new BackupError('backupIncomplete') : error
  }
  fail('backupUnrecognized')
}

/**
 * 流式导入：manifest → user（不导入）→ 全部会话 JSON → index → 全部图片。
 * 也支持会话与图片交错排列、index 位于末尾的条目顺序。
 * 会话读完立即暂存，只保留图片路径映射；图片全部读完后逐会话回填 MIME，不改变图片身份。
 * 写入导入暂存存储；调用方负责先清空暂存，成功后替换正式数据，失败时清理暂存。
 */
/** 图片攒批写入的上限：单批不超过这么多个文件，也不超过这么多字节。 */
const IMAGE_BATCH_FILES = 24
const IMAGE_BATCH_BYTES = 32 * 1024 * 1024

export const importArchive = async (
  file: File,
  onProgress?: ArchiveProgress,
  signal?: AbortSignal
): Promise<void> => {
  if (!(await isZipFile(file))) {
    fail('backupUnrecognized')
  }
  const imported = new Set<string>()
  const images = new Map<string, string>()
  /** 已保存的原件：文件 ID → MIME。同一图片出现在多个会话目录时只保存一次。 */
  const stored = new Map<string, string>()
  let manifest = false
  let index: SessionIndexEntry[] | undefined
  let currentSessionId: string | undefined
  /** 待写入暂存的图片；每张图单独开事务在手机上会慢一个数量级，攒批提交。 */
  let pending: { id: string; blob: Blob }[] = []
  let pendingBytes = 0

  const flushImages = async () => {
    if (pending.length === 0) {
      return
    }
    const batch = pending
    pending = []
    pendingBytes = 0
    await db.saveStagingFiles(batch)
  }

  const saveImage = async (entry: ArchiveEntry, id: string) => {
    if (stored.has(id)) {
      await skipEntry(entry)
      return
    }
    const data = await readEntry(entry)
    const type = imageType(new Uint8Array(await data.slice(0, 16).arrayBuffer()))
    pending.push({ id, blob: new Blob([data], { type }) })
    pendingBytes += data.size
    stored.set(id, type)
    if (pending.length >= IMAGE_BATCH_FILES || pendingBytes >= IMAGE_BATCH_BYTES) {
      await flushImages()
    }
  }

  try {
    for await (const entry of readArchive(file, onProgress)) {
      if (signal?.aborted) {
        throw new DOMException('Import aborted', 'AbortError')
      }
      const { path } = entry
      const sessionId = parseSessionPath(path)
      if (!manifest) {
        if (path !== MANIFEST_PATH) {
          fail('backupUnrecognized')
        }
        checkManifest(await readJson(entry))
        manifest = true
      } else if (path === USER_PATH && !index && imported.size === 0) {
        // 账号信息（已脱敏）不导入；文件可能缺失。
        await skipEntry(entry)
      } else if (sessionId !== null && !index) {
        const local = toLocalSession(readSessionFile(await readJson(entry)))
        if (local.session.id !== sessionId || imported.has(sessionId)) {
          fail('backupIncomplete')
        }
        imported.add(sessionId)
        currentSessionId = sessionId
        for (const [imagePath, id] of local.images) {
          images.set(imagePath, id)
        }
        await db.addStagingSession(local.session)
      } else if (path === INDEX_PATH && !index) {
        index = readSessionIndex(await readJson(entry))
      } else if (
        index
          ? imported.has(/^chat_sessions\/([^/]+)_files\//.exec(path)?.[1] ?? '')
          : currentSessionId && path.startsWith(sessionFilesDir(currentSessionId))
      ) {
        // 没有被引用的条目不保存，引用了但缺失的图片只展示文件名。
        const id = images.get(path)
        await (id === undefined ? skipEntry(entry) : saveImage(entry, id))
      } else {
        fail('backupIncomplete')
      }
    }
  } catch (error) {
    throw error instanceof ArchiveError ? new BackupError('backupIncomplete') : error
  }
  await flushImages()
  if (!manifest) {
    fail('backupUnrecognized')
  }
  // index 只列出成功写出的会话，与会话文件一一对应。
  const listed = new Set(index?.map((entry) => entry.id))
  if (
    !index ||
    listed.size !== index.length ||
    listed.size !== imported.size ||
    [...imported].some((id) => !listed.has(id))
  ) {
    fail('backupIncomplete')
  }
  await db.updateStagingFileTypes(stored)
}

/** 单会话导入的产物：已转换好的本地会话，以及要和它一起保存的图片原件。 */
export type SingleSessionArchive = {
  session: Session
  /** 图片原件沿用归档里的文件 ID，会话内的附件引用就是按这个 ID 找原件的。 */
  files: { id: string; blob: Blob }[]
}

/** 识别出的图片 MIME 回填到引用该原件的附件上；图片身份仍由归档的 is_image 决定。 */
const withImageTypes = (session: Session, originals: ReadonlyMap<string, Blob>): Session => ({
  ...session,
  messages: session.messages.map((message) => {
    if (message.role !== 'user') {
      return message
    }
    const files = message.files.map((file) => {
      const original = originals.get(file.id)
      return original === undefined ? file : { ...file, mimeType: original.type }
    })
    return files.every((file, index) => file === message.files[index])
      ? message
      : { ...message, files }
  }),
})

/**
 * 单会话导入：读出归档里的一个会话，会话与图片的校验、转换与全量导入完全一致，
 * 但结果只留在内存里交给调用方合并，不写暂存、不替换正式数据。
 * 出现第二个会话文件或索引列出多个会话，说明这是全量归档：拒绝并提示改用全量导入，
 * 避免「以为只加了一个对话，结果多出一堆」的误操作。
 */
export const importSingleSession = async (
  file: File,
  onProgress?: ArchiveProgress,
  signal?: AbortSignal
): Promise<SingleSessionArchive> => {
  if (!(await isZipFile(file))) {
    fail('backupUnrecognized')
  }
  let manifest = false
  let local: LocalSession | undefined
  let index: SessionIndexEntry[] | undefined
  /** 图片原件：文件 ID → 带 MIME 的 Blob */
  const originals = new Map<string, Blob>()
  try {
    for await (const entry of readArchive(file, onProgress)) {
      if (signal?.aborted) {
        throw new DOMException('Import aborted', 'AbortError')
      }
      const { path } = entry
      const sessionId = parseSessionPath(path)
      if (!manifest) {
        if (path !== MANIFEST_PATH) {
          fail('backupUnrecognized')
        }
        checkManifest(await readJson(entry))
        manifest = true
      } else if (path === USER_PATH && !index && !local) {
        // 账号信息（已脱敏）不导入；文件可能缺失。
        await skipEntry(entry)
      } else if (sessionId !== null && !index) {
        if (local) {
          fail('backupMultipleSessions')
        }
        const candidate = toLocalSession(readSessionFile(await readJson(entry)))
        if (candidate.session.id !== sessionId) {
          fail('backupIncomplete')
        }
        local = candidate
      } else if (path === INDEX_PATH && !index) {
        index = readSessionIndex(await readJson(entry))
      } else if (local && path.startsWith(sessionFilesDir(local.session.id))) {
        // 没有被引用的条目同样读完做校验，但不保留。
        const id = local.images.get(path)
        if (id === undefined) {
          await skipEntry(entry)
        } else {
          const data = await readEntry(entry)
          const type = imageType(new Uint8Array(await data.slice(0, 16).arrayBuffer()))
          originals.set(id, new Blob([data], { type }))
        }
      } else {
        fail('backupIncomplete')
      }
    }
  } catch (error) {
    throw error instanceof ArchiveError ? new BackupError('backupIncomplete') : error
  }
  if (!manifest || !local) {
    return fail('backupUnrecognized')
  }
  // 索引必须恰好列出这一个会话，与全量导入的对应关系要求一致。
  if (!index || index.length === 0) {
    return fail('backupIncomplete')
  }
  if (index.length > 1) {
    return fail('backupMultipleSessions')
  }
  if (index[0].id !== local.session.id) {
    return fail('backupIncomplete')
  }
  return {
    session: withImageTypes(local.session, originals),
    files: [...originals].map(([id, blob]) => ({ id, blob })),
  }
}
