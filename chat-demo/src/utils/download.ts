/**
 * 文件保存：浏览器里走 blob URL + <a download>，
 * 安卓壳子里交给原生写进系统「下载」目录（WebView 不支持 blob 下载）。
 */

/** 安卓壳子通过 addJavascriptInterface 注入的原生通道 */
type NativeBridge = {
  beginFile?: (name: string) => boolean
  appendFileChunk?: (base64: string) => boolean
  endFile?: () => boolean
  /** 打开系统文件夹选择器；返回是否成功拉起 */
  chooseExportFolder?: () => boolean
  /** 当前选定的保存目录名；空字符串表示系统「下载」 */
  exportFolderName?: () => string
  /** 恢复默认保存位置（系统「下载」） */
  resetExportFolder?: () => boolean
}

const getNativeBridge = (): NativeBridge | null => {
  const bridge = (window as unknown as { AndroidBridge?: NativeBridge }).AndroidBridge
  return bridge && typeof bridge.beginFile === 'function' ? bridge : null
}

/** 单次传给原生的原始字节数；base64 后约 87 KB，避免跨语言传超长字符串 */
const CHUNK_SIZE = 64 * 1024

const toBase64 = (bytes: Uint8Array): string => {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return btoa(binary)
}

const saveNatively = async (bridge: NativeBridge, blob: Blob, name: string): Promise<boolean> => {
  if (!bridge.beginFile?.(name)) {
    return false
  }
  const bytes = new Uint8Array(await blob.arrayBuffer())
  for (let offset = 0; offset < bytes.length; offset += CHUNK_SIZE) {
    if (!bridge.appendFileChunk?.(toBase64(bytes.subarray(offset, offset + CHUNK_SIZE)))) {
      return false
    }
  }
  return bridge.endFile?.() ?? false
}

/**
 * 保存一个文件。
 * 返回 'native' 表示安卓壳子已写入下载目录，'browser' 表示浏览器已开始下载，'failed' 表示写入失败。
 */
export const saveBlob = async (
  blob: Blob,
  name: string
): Promise<'native' | 'browser' | 'failed'> => {
  const bridge = getNativeBridge()
  if (bridge) {
    return (await saveNatively(bridge, blob, name)) ? 'native' : 'failed'
  }
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
  return 'browser'
}

/** 当前平台是否支持「选择导出目录」（只有安卓壳子有） */
export const canChooseExportFolder = (): boolean =>
  typeof getNativeBridge()?.chooseExportFolder === 'function'

/** 当前保存位置的名字；空字符串表示系统「下载」目录 */
export const currentExportFolder = (): string => {
  try {
    return getNativeBridge()?.exportFolderName?.() ?? ''
  } catch {
    return ''
  }
}

/** 是否支持「恢复默认保存位置」 */
export const canResetExportFolder = (): boolean =>
  typeof getNativeBridge()?.resetExportFolder === 'function'

/** 恢复默认保存位置：清掉用户选的目录，退回系统「下载」 */
export const resetExportFolder = (): boolean => {
  try {
    return getNativeBridge()?.resetExportFolder?.() ?? false
  } catch {
    return false
  }
}

/** 拉起系统文件夹选择器；返回是否成功拉起（结果通过 onActivityResult 落盘，页面无需等待） */
export const chooseExportFolder = (): boolean => {
  try {
    return getNativeBridge()?.chooseExportFolder?.() ?? false
  } catch {
    return false
  }
}
