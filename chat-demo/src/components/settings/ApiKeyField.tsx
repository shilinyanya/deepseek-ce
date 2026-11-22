import { useRef, useState } from 'react'
import { IconEditOutline16, IconTrashOutline16 } from '../base/icons.js'
import { setApiKey, useSettings } from '../../services/settings.js'
import { useIsMobile } from '../../app/viewport.js'
import { IconButton } from '../base/IconButton.js'
import { useApiKeyForm } from './useApiKeyForm.js'
import { useTranslate } from '../../i18n/index.js'
import styles from './Settings.module.css'

/** API Key 的编辑状态：输入框与移动端底部的「确定」按钮共用 */
export const useApiKeyEditor = () => {
  const apiKey = useSettings((state) => state.apiKey)
  const [editing, setEditing] = useState(false)
  const form = useApiKeyForm(() => setEditing(false))
  return { apiKey, editing, setEditing, form, showInput: !apiKey || editing }
}

type ApiKeyEditor = ReturnType<typeof useApiKeyEditor>

/** API Key：保存后只显示掩码，点编辑按钮才能重新输入 */
export const ApiKeyField = ({ editor }: { editor: ApiKeyEditor }) => {
  const t = useTranslate()
  const isMobile = useIsMobile()
  const { apiKey, editing, setEditing, form, showInput } = editor
  const inputRef = useRef<HTMLInputElement>(null)

  /** 从系统剪贴板粘贴 API Key：优先走原生桥接，浏览器里退回异步剪贴板接口 */
  const pasteApiKey = () => {
    const bridge = (
      window as unknown as { AndroidBridge?: { readClipboard?: () => string } }
    ).AndroidBridge
    let text = ''
    try {
      text = bridge?.readClipboard?.() ?? ''
    } catch {
      text = ''
    }
    if (text.trim()) {
      // 只填内容，不聚焦输入框（避免自动弹出键盘）
      form.setValue(text.trim())
      return
    }
    void navigator.clipboard
      ?.readText()
      .then((value) => {
        form.setValue(value.trim())
      })
      .catch(() => {})
  }

  return (
    <div className={styles.cell}>
      <div className={styles.apiKey}>
        <div className={styles.label}>{t('apiKeyStart')}</div>
        {apiKey && !editing ? (
          <div className={styles.apiKeySaved}>
            <span className={styles.apiKeyMask}>{'*'.repeat(apiKey.length)}</span>
            <IconButton
              tone="primary"
              icon={<IconEditOutline16 />}
              tooltip={t('apiKeyEdit')}
              onClick={() => setEditing(true)}
            />
            <IconButton
              tone="primary"
              icon={<IconTrashOutline16 />}
              tooltip={t('apiKeyClear')}
              onClick={() => {
                setApiKey(null)
                setEditing(true)
              }}
            />
          </div>
        ) : (
          <div className={styles.apiKeyInput}>
            <input
              ref={inputRef}
              type="password"
              placeholder={t('apiKeyPlaceholder')}
              autoComplete="off"
              spellCheck={false}
              // 移动端打开设置时不弹键盘，点编辑后才聚焦
              autoFocus={!isMobile || editing}
              value={form.value}
              onChange={(event) => form.setValue(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                  void form.submit()
                }
              }}
              onBlur={() => {
                // 修改时没输入就离开，回到已保存的状态
                if (apiKey && !form.value.trim()) {
                  setEditing(false)
                }
              }}
            />
            {!isMobile && form.value.trim() ? (
              <>
                <span className={styles.divider} />
                <button
                  type="button"
                  className={styles.confirm}
                  disabled={form.verifying}
                  // 保持输入框焦点
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => void form.submit()}
                >
                  {form.verifying ? t('apiKeyVerifying') : t('confirm')}
                </button>
              </>
            ) : null}
            {isMobile ? (
              <button
                type="button"
                className={styles.pasteButton}
                // 保持输入框焦点
                onMouseDown={(event) => event.preventDefault()}
                onClick={pasteApiKey}
              >
                {t('apiKeyPaste')}
              </button>
            ) : null}
          </div>
        )}
        {showInput && form.error ? <div className={styles.error}>{form.error}</div> : null}
      </div>
    </div>
  )
}

/** 移动端：输入 API Key 时在选项下方显示整行「确定」 */
export const ApiKeyConfirm = ({ editor: { showInput, form } }: { editor: ApiKeyEditor }) => {
  const t = useTranslate()
  return showInput && form.value.trim() ? (
    <button
      type="button"
      className={styles.mobileConfirm}
      disabled={form.verifying}
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => void form.submit()}
    >
      {form.verifying ? t('apiKeyVerifying') : t('confirm')}
    </button>
  ) : null
}
