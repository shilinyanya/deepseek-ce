import clsx from 'clsx'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  IconDarkOutline16,
  IconDataOutline16,
  IconDownloadOutline16,
  IconFollowsystemOutline16,
  IconLightOutline16,
  IconRefreshOutline16,
  IconSettingsOutline16,
  IconUploadOutline14,
} from '../base/icons.js'
import {
  BackupError,
  clearHistory,
  exportHistory,
  importHistory,
  importSession,
} from '../../services/chat/backup.js'
import { useIsMobile } from '../../app/viewport.js'
import { useChatStore } from '../../services/chat/store.js'
import { formatSize } from '../../services/attachments.js'
import { regionCodes, getRegionName, provinces } from '../../services/location.js'
import {
  isChineseBrowser,
  mergeModels,
  setFontSize,
  setLocale,
  setLocation,
  setModel,
  setModels,
  setDefaultPromptPreset,
  addPromptPreset,
  updatePromptPreset,
  removePromptPreset,
  DEFAULT_PRESET_ID,
  setThemePreference,
  setTtsVoice,
  useSettings,
  setManualCompress,
  setNetworkModel,
  setNetworkModelEnabled,
  setTitleByExtraRequest,
  setTitleMode,
  setRelayEnabled,
  setRelayConfig,
  setSessionOrganizer,
  type FontSizeKey,
  type Locale,
  type ThemePreference,
} from '../../services/settings.js'
import type { ChatModel, ModelInfo } from '../../services/api/types.js'
import { listModels } from '../../services/api/client.js'
import { IconButton } from '../base/IconButton.js'
import { useTranslate, type TranslationKey, type TranslationMessage } from '../../i18n/index.js'
import { Button } from '../base/Button.js'
import { Modal } from '../base/Modal.js'
import { Select } from '../base/Select.js'
import { Switch } from '../base/Switch.js'
import { askRelayEnable } from '../base/RelayConfirmDialog.js'
import {
  canImportFromUrl,
  downloadArchive,
  openPendingArchiveImport,
} from '../../services/native/archiveImport.js'
import { showToast } from '../base/toastState.js'
import {
  saveBlob,
  canChooseExportFolder,
  chooseExportFolder,
  resetExportFolder,
  currentExportFolder,
} from '../../utils/download.js'
import { ApiKeyConfirm, ApiKeyField, useApiKeyEditor } from './ApiKeyField.js'
import { AutoReadToggle } from '../speech/AutoReadToggle.js'
import { closeSettings, useSettingsDialog, type SettingsSection } from './settingsDialogState.js'
import styles from './Settings.module.css'

/**
 * 设置弹窗：分「通用设置」（主题、语言、朗读音色、位置）与「数据管理」（API Key、导入、导出、删除）。
 * 桌面端为居中弹窗、左侧导航；移动端为底部弹层、导航横排在内容上方
 */
export const SettingsDialog = () => {
  const open = useSettingsDialog((state) => state.open)
  const closing = useSettingsDialog((state) => state.closing)
  return open ? <SettingsContent closing={closing} /> : null
}

const sections: { value: SettingsSection; label: TranslationKey; icon: ReactNode }[] = [
  {
    value: 'general',
    label: 'settingDialogAsideGeneralOptionLabel',
    icon: <IconSettingsOutline16 />,
  },
  { value: 'data', label: 'settingDialogAsideDataOptionLabel', icon: <IconDataOutline16 /> },
]

const SettingsContent = ({ closing = false }: { closing?: boolean }) => {
  const t = useTranslate()
  const isMobile = useIsMobile()
  // 打开时按调用方指定的分组选中，之后在弹窗内切换
  const [section, setSection] = useState(() => useSettingsDialog.getState().section)
  // 切换分组不丢失正在输入的 API Key 与导入状态
  const apiKeyEditor = useApiKeyEditor()
  const historyImport = useHistoryImport()
  const singleImport = useHistoryImportSingle()
  const historyDelete = useHistoryDelete()
  const replacingHistory = useChatStore((state) => state.importingHistory)
  const historyBusy =
    historyImport.busy || singleImport.busy || historyDelete.busy || replacingHistory
  return (
    <>
      <Modal
        title={t('settings')}
        closable
        className={styles.dialog}
        closing={closing}
        style={{
          transition: 'transform 0.15s cubic-bezier(0.4, 0, 1, 1)',
          transform: closing ? 'translateX(100%)' : 'translateX(0)',
        }}
        mainClassName={styles.dialogMain}
        onClose={() => {
          if (!historyDelete.busy && !historyImport.busy && !singleImport.busy) {
            closeSettings()
          }
        }}
      >
        <div role="tablist" className={styles.navigation}>
          {sections.map((item) => (
            <button
              key={item.value}
              type="button"
              role="tab"
              aria-selected={section === item.value}
              className={clsx(styles.navItem, section === item.value && styles.navItemActive)}
              onClick={() => setSection(item.value)}
            >
              {item.icon}
              {t(item.label)}
            </button>
          ))}
        </div>
        <div role="tabpanel" className={styles.content}>
          {section === 'general' ? (
            <>
              <ThemeSetting />
              <ModelSetting />
              <LocaleSetting />
              <FontSizeSetting />
              <TtsVoiceSetting />
              <AutoReadSetting />
              <SystemPromptSetting />
              <LocationSetting />
              <MoreSettings />
            </>
          ) : (
            <>
              <ApiKeyField editor={apiKeyEditor} />
              <ImportHistory historyImport={historyImport} disabled={historyBusy} />
              <ImportFromUrl disabled={historyBusy} />
              <ImportSingleSession singleImport={singleImport} disabled={historyBusy} />
              <ExportHistory disabled={historyBusy} />
              <ExportFolderSetting />
              <SettingCell
                label={t('deleteAllSessions')}
                status={null}
                action={
                  <Button
                    variant="dangerOutlined"
                    size="m"
                    className={styles.cellButton}
                    disabled={historyBusy}
                    onClick={historyDelete.open}
                  >
                    {t('delete')}
                  </Button>
                }
              />
              {isMobile ? <ApiKeyConfirm editor={apiKeyEditor} /> : null}
            </>
          )}
          {t('settingsAbout') ? (
            <div
              style={{
                marginTop: 8,
                paddingTop: 12,
                borderTop: '1px solid var(--dsw-alias-border-l2)',
                fontSize: 12,
                lineHeight: 1.6,
                color: 'var(--dsw-alias-label-tertiary)',
                textAlign: 'center',
                whiteSpace: 'pre-line',
              }}
            >
              {t('settingsAbout')}
            </div>
          ) : null}
        </div>
      </Modal>
      {historyImport.file ? <ImportConfirm historyImport={historyImport} /> : null}
      {historyImport.busy ? (
        <ImportProgress progress={historyImport.progress} onCancel={historyImport.abort} />
      ) : null}
      {singleImport.busy ? (
        <ImportProgress progress={singleImport.progress} onCancel={singleImport.abort} />
      ) : null}
      {historyDelete.opened ? <DeleteAllConfirm historyDelete={historyDelete} /> : null}
    </>
  )
}

/** 删除确认保留在设置之上；失败可重试，成功只关闭确认弹窗。 */
const DeleteAllConfirm = ({
  historyDelete,
}: {
  historyDelete: ReturnType<typeof useHistoryDelete>
}) => {
  const t = useTranslate()
  return (
    <Modal
      title={t('deleteAllSessionsModalTitle')}
      className={styles.deleteConfirm}
      onClose={historyDelete.cancel}
      footer={
        <div className={styles.deleteActions} aria-busy={historyDelete.busy}>
          <Button
            variant="outlined"
            autoFocus
            disabled={historyDelete.busy}
            onClick={historyDelete.cancel}
          >
            {t('cancel')}
          </Button>
          <Button
            variant="danger"
            disabled={historyDelete.busy}
            onClick={() => void historyDelete.confirm()}
          >
            {t(historyDelete.busy ? 'historyDeleting' : 'deleteAllSessions')}
          </Button>
        </div>
      }
    >
      {t('deleteAllSessionsModalDescription')}
    </Modal>
  )
}

const useHistoryDelete = () => {
  const [opened, setOpened] = useState(false)
  const [busy, setBusy] = useState(false)
  const deleting = useRef(false)

  const confirm = async () => {
    if (deleting.current) {
      return
    }
    deleting.current = true
    setBusy(true)
    try {
      await clearHistory()
      setOpened(false)
      showToast({ key: 'historyDeleted' })
    } catch {
      showToast({ key: 'historyDeleteFailed', type: 'error' })
    } finally {
      deleting.current = false
      setBusy(false)
    }
  }

  return {
    opened,
    busy,
    open: () => setOpened(true),
    cancel: () => {
      if (!deleting.current) {
        setOpened(false)
      }
    },
    confirm,
  }
}

const LocationSetting = () => {
  const t = useTranslate()
  const locale = useSettings((state) => state.locale)
  const location = useSettings((state) => state.location)
  const province =
    location?.region === 'CN'
      ? provinces.find((item) => item.code === location.province)
      : undefined

  return (
    <SettingCell
      label={t('settingsLocation')}
      status={null}
      className={styles.locationCell}
      action={
        <div className={styles.locationSelectors}>
          {isChineseBrowser() ? (
            <>
              <Select
                ariaLabel={t('settingsLocationProvince')}
                className={styles.provinceSelect}
                value={province?.code ?? ''}
                placeholder={t('settingsLocationProvince')}
                options={provinces.map((item) => ({ value: item.code, label: item.name }))}
                onChange={(value) => {
                  if (value !== province?.code) {
                    setLocation({ region: 'CN', province: value })
                  }
                }}
              />
              <Select
                ariaLabel={t('settingsLocationCity')}
                className={styles.citySelect}
                value={province ? (location?.city ?? '') : ''}
                disabled={!province?.cities.length}
                placeholder={t('settingsLocationCity')}
                options={
                  province?.cities.map((item) => ({ value: item.code, label: item.name })) ?? []
                }
                onChange={(value) => {
                  if (province) {
                    setLocation({ region: 'CN', province: province.code, city: value })
                  }
                }}
              />
            </>
          ) : (
            <Select
              ariaLabel={t('settingsLocationRegion')}
              className={styles.regionSelect}
              value={location?.region ?? ''}
              placeholder={t('settingsLocationRegion')}
              options={regionCodes
                .map((code) => ({ value: code, label: getRegionName(code, locale) }))
                .sort((a, b) => a.label.localeCompare(b.label, locale))}
              onChange={(value) => setLocation({ region: value })}
            />
          )}
          {location ? (
            <button
              type="button"
              className={styles.locationReset}
              onClick={() => setLocation(null)}
            >
              {t('settingsLocationReset')}
            </button>
          ) : null}
        </div>
      }
    />
  )
}

const LocaleSetting = () => {
  const t = useTranslate()
  const locale = useSettings((state) => state.locale)
  return (
    <SettingCell
      label={t('settingsLocalePreference')}
      status={null}
      action={
        <Select<Locale>
          ariaLabel={t('settingsLocalePreference')}
          value={locale}
          options={[
            { value: 'zh-CN', label: t('settingsLocaleZhCN'), lang: 'zh-CN' },
            { value: 'zh-TW', label: t('settingsLocaleZhTW'), lang: 'zh-Hant' },
            { value: 'ja-JP', label: t('settingsLocaleJaJP'), lang: 'ja' },
            { value: 'en-US', label: t('settingsLocaleEnUS'), lang: 'en' },
          ]}
          onChange={setLocale}
        />
      }
    />
  )
}

/** 字号档位；缩放的是整个界面（含弹窗），不是只放大正文字号 */
const fontSizeOptions: { value: FontSizeKey; label: TranslationKey }[] = [
  { value: 'small', label: 'settingsFontSizeSmall' },
  { value: 'standard', label: 'settingsFontSizeStandard' },
  { value: 'large', label: 'settingsFontSizeLarge' },
  { value: 'xlarge', label: 'settingsFontSizeExtraLarge' },
]

const FontSizeSetting = () => {
  const t = useTranslate()
  const fontSize = useSettings((state) => state.fontSize)
  return (
    <SettingCell
      label={t('settingsFontSize')}
      description={t('settingsFontSizeDescription')}
      status={null}
      action={
        <Select<FontSizeKey>
          ariaLabel={t('settingsFontSize')}
          value={fontSize}
          options={fontSizeOptions.map((item) => ({ value: item.value, label: t(item.label) }))}
          onChange={setFontSize}
        />
      }
    />
  )
}

/** 自动朗读：和顶部栏那个喇叭按钮共用一个开关 */
const AutoReadSetting = () => {
  const t = useTranslate()
  return (
    <SettingCell
      label={t('settingsAutoRead')}
      description={t('settingsAutoReadDescription')}
      status={null}
      action={<AutoReadToggle size="m" />}
    />
  )
}

/** 朗读音色：stella（海星，女声）/ tide（暗潮，男声） */
const TtsVoiceSetting = () => {
  const t = useTranslate()
  const ttsVoice = useSettings((state) => state.ttsVoice)
  return (
    <SettingCell
      label={t('settingsTtsVoice')}
      status={null}
      action={
        <Select
          ariaLabel={t('settingsTtsVoice')}
          value={ttsVoice}
          options={[
            { value: 'stella', label: t('settingsTtsVoiceStella') },
            { value: 'tide', label: t('settingsTtsVoiceTide') },
          ]}
          onChange={setTtsVoice}
        />
      }
    />
  )
}

/**
 * 对话模型。内置的两个用本地文案，其余用官方 /models 返回的展示名（没有再退回 id）。
 * 右侧刷新按钮会联网拉最新模型列表，新发布的模型点一下就能选到。
 */
const ModelSetting = () => {
  const t = useTranslate()
  const model = useSettings((state) => state.model)
  const models = useSettings((state) => state.models)
  const apiKey = useSettings((state) => state.apiKey)
  const [refreshing, setRefreshing] = useState(false)

  // 名称以接口返回为准：官方改版后这里自动跟着变，不用改代码
  const labelOf = (item: ModelInfo) => item.name ?? item.id

  const refresh = async () => {
    if (refreshing) {
      return
    }
    if (!apiKey) {
      showToast({ key: 'settingsModelRefreshNoKey', type: 'error' })
      return
    }
    setRefreshing(true)
    try {
      const fetched = await listModels(apiKey)
      if (fetched.length === 0) {
        showToast({ key: 'settingsModelRefreshEmpty', type: 'error' })
        return
      }
      const merged = mergeModels(models, fetched)
      setModels(merged)
      // 原来选的模型如果已经下线，落到第一个可用模型上
      if (!merged.some((item) => item.id === model)) {
        setModel(merged[0].id)
      }
      showToast({ key: 'settingsModelRefreshed', params: { count: fetched.length } })
    } catch {
      showToast({ key: 'settingsModelRefreshFailed', type: 'error' })
    } finally {
      setRefreshing(false)
    }
  }

  return (
    <div className={styles.stackedCell}>
      <div className={styles.text}>
        <div className={styles.label}>{t('settingsModel')}</div>
        <div className={styles.description}>{t('settingsModelDescription')}</div>
      </div>
      <div className={styles.stackedRow}>
        <Select<ChatModel>
          ariaLabel={t('settingsModel')}
          className={styles.modelSelectWide}
          value={model}
          options={models.map((item) => ({ value: item.id, label: labelOf(item) }))}
          onChange={setModel}
        />
        <IconButton
          icon={<IconRefreshOutline16 />}
          tooltip={t('settingsModelRefresh')}
          disabled={refreshing}
          onClick={() => void refresh()}
        />
      </div>
    </div>
  )
}

/** 联网模型：先开开关，开启后才选择；选项来自联网刷新后的模型列表 */
const NetworkModelSetting = () => {
  const t = useTranslate()
  const enabled = useSettings((state) => state.networkModelEnabled)
  const networkModel = useSettings((state) => state.networkModel)
  const models = useSettings((state) => state.models)
  const apiKey = useSettings((state) => state.apiKey)
  const [refreshing, setRefreshing] = useState(false)

  // 名称以接口返回为准
  const labelOf = (item: ModelInfo) => item.name ?? item.id

  const refresh = async () => {
    if (refreshing) {
      return
    }
    if (!apiKey) {
      showToast({ key: 'settingsModelRefreshNoKey', type: 'error' })
      return
    }
    setRefreshing(true)
    try {
      const fetched = await listModels(apiKey)
      if (fetched.length === 0) {
        showToast({ key: 'settingsModelRefreshEmpty', type: 'error' })
        return
      }
      const merged = mergeModels(models, fetched)
      setModels(merged)
      if (!merged.some((item) => item.id === networkModel)) {
        setNetworkModel(merged[0].id)
      }
      showToast({ key: 'settingsModelRefreshed', params: { count: fetched.length } })
    } catch {
      showToast({ key: 'settingsModelRefreshFailed', type: 'error' })
    } finally {
      setRefreshing(false)
    }
  }

  return (
    <div className={styles.stackedCell}>
      <div className={styles.text}>
        <div className={styles.label}>{t('settingsNetworkModelEnabled')}</div>
        <div className={styles.description}>{t('settingsNetworkModelEnabledDescription')}</div>
      </div>
      <div className={styles.stackedRow}>
        <Switch
          checked={enabled}
          ariaLabel={t('settingsNetworkModelEnabled')}
          onChange={(checked) => {
            setNetworkModelEnabled(checked)
            showToast({ key: checked ? 'settingsNetworkModelOn' : 'settingsNetworkModelOff' })
          }}
        />
        {enabled ? (
          <>
            <Select<ChatModel>
              ariaLabel={t('settingsNetworkModel')}
              className={styles.modelSelectWide}
              value={networkModel}
              options={models.map((item) => ({ value: item.id, label: labelOf(item) }))}
              onChange={setNetworkModel}
            />
            <IconButton
              icon={<IconRefreshOutline16 />}
              tooltip={t('settingsModelRefresh')}
              disabled={refreshing}
              onClick={() => void refresh()}
            />
          </>
        ) : null}
      </div>
    </div>
  )
}

/** 系统提示词：多套预设，可切换 / 新建 / 改名 / 删除；「默认」留空时回落到官方身份说明 */
const SystemPromptSetting = () => {
  const t = useTranslate()
  const presets = useSettings((state) => state.promptPresets)
  const defaultId = useSettings((state) => state.defaultPromptPresetId)
  const current = presets.find((item) => item.id === defaultId) ?? presets[0]
  const presetName = (id: string, name: string) =>
    id === DEFAULT_PRESET_ID ? t('promptPresetDefault') : name || t('promptPresetUntitled')
  const [renaming, setRenaming] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  return (
    <div className={styles.cell}>
      <div className={styles.label}>{t('settingsSystemPrompt')}</div>
      <div className={styles.description}>{t('settingsSystemPromptDescription')}</div>
      <div className={styles.promptRow}>
        {renaming ? (
          <input
            autoFocus
            value={current.name}
            placeholder={t('promptPresetNamePlaceholder')}
            onChange={(event) => updatePromptPreset(current.id, { name: event.target.value })}
            onBlur={() => setRenaming(false)}
            className={styles.promptSelect}
            style={{ height: 36, borderRadius: 10, padding: '0 10px' }}
          />
        ) : (
          <Select
            ariaLabel={t('settingsSystemPrompt')}
            className={styles.promptSelect}
            value={current.id}
            options={presets.map((item) => ({
              value: item.id,
              label: presetName(item.id, item.name),
            }))}
            onChange={(value) => setDefaultPromptPreset(value)}
          />
        )}
      </div>
      <div className={styles.promptActions}>
        {current.id === DEFAULT_PRESET_ID ? null : (
          <Button
            variant="outlined"
            size="m"
            className={styles.cellButton}
            onClick={() => setRenaming(true)}
          >
            {t('promptPresetRename')}
          </Button>
        )}
        <Button
          variant="outlined"
          size="m"
          className={styles.cellButton}
          onClick={() => {
            const taken = (name: string) => presets.some((item) => item.name === name)
            let name = t('promptPresetUntitled')
            let index = 2
            while (taken(name)) {
              name = `${t('promptPresetUntitled')}${index}`
              index += 1
            }
            const id = addPromptPreset(name)
            setDefaultPromptPreset(id)
            setRenaming(true)
          }}
        >
          {t('promptPresetNew')}
        </Button>
        {current.id === DEFAULT_PRESET_ID ? null : (
          <Button
            variant="dangerOutlined"
            size="m"
            className={styles.cellButton}
            onClick={() => setConfirmDelete(true)}
          >
            {t('promptPresetDelete')}
          </Button>
        )}
      </div>
      {confirmDelete ? (
        <Modal
          title={t('promptPresetDeleteConfirm')}
          className={styles.confirmDialog}
          closable
          onClose={() => setConfirmDelete(false)}
          footer={
            <>
              <Button variant="outlined" size="m" onClick={() => setConfirmDelete(false)}>
                {t('cancel')}
              </Button>
              <Button
                variant="dangerOutlined"
                size="m"
                onClick={() => {
                  removePromptPreset(current.id)
                  setConfirmDelete(false)
                }}
              >
                {t('delete')}
              </Button>
            </>
          }
        >
          <div style={{ textAlign: 'center', fontWeight: 600 }}>{presetName(current.id, current.name)}</div>
        </Modal>
      ) : null}
      <textarea
        className={styles.systemPrompt}
        rows={4}
        spellCheck={false}
        value={current.content}
        placeholder={t('settingsSystemPromptPlaceholder')}
        onChange={(event) => updatePromptPreset(current.id, { content: event.target.value })}
      />
    </div>
  )
}

/** 覆盖导入的二次确认，叠在设置弹窗上 */
const ImportConfirm = ({
  historyImport,
}: {
  historyImport: ReturnType<typeof useHistoryImport>
}) => {
  const t = useTranslate()
  return (
    <Modal
      title={t('historyImportConfirmTitle')}
      className={styles.importConfirm}
      onClose={historyImport.cancel}
      footer={
        <>
          <Button variant="outlined" size="m" autoFocus onClick={historyImport.cancel}>
            {t('cancel')}
          </Button>
          <Button variant="dangerOutlined" size="m" onClick={() => void historyImport.confirm()}>
            {t('historyImportConfirm')}
          </Button>
        </>
      }
    >
      <div className={styles.importConfirmText}>{t('historyImportConfirmDescription')}</div>
    </Modal>
  )
}

const themeOptions: { value: ThemePreference; label: TranslationKey; icon: ReactNode }[] = [
  {
    value: 'light',
    label: 'avatarMenuSettingsDialogThemeSelectLightOption',
    icon: <IconLightOutline16 />,
  },
  {
    value: 'dark',
    label: 'avatarMenuSettingsDialogThemeSelectDarkOption',
    icon: <IconDarkOutline16 />,
  },
  {
    value: 'system',
    label: 'avatarMenuSettingsDialogThemeSelectSystemOption',
    icon: <IconFollowsystemOutline16 />,
  },
]

/**
 * 主题项：标题下方浅色 / 深色 / 跟随系统三个选块。
 * 与下方语言选项连续排列。
 */
const ThemeSetting = () => {
  const t = useTranslate()
  const themePreference = useSettings((state) => state.themePreference)
  const label = t('avatarMenuSettingsDialogThemeItemLabel')
  return (
    <div className={styles.theme}>
      {label}
      <div role="radiogroup" aria-label={label} className={styles.themeOptions}>
        {themeOptions.map((option) => (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={themePreference === option.value}
            className={clsx(
              styles.themeOption,
              themePreference === option.value && styles.themeOptionSelected
            )}
            onClick={() => setThemePreference(option.value)}
          >
            {option.icon}
            {t(option.label)}
          </button>
        ))}
      </div>
    </div>
  )
}

/** `reason` 为失败原因的文案 key，展示时按当前语言翻译后填入 `message` 参数。 */
type Status = (TranslationMessage & { error?: boolean; reason?: TranslationKey }) | null

/** 导出失败附带原因：预期的错误用对应文案作原因，其他错误用错误信息。 */
const errorStatus = (key: TranslationKey, error: unknown): Status => ({
  key,
  ...(error instanceof BackupError
    ? { reason: error.key }
    : { params: { message: error instanceof Error ? error.message : String(error) } }),
  error: true,
})

/**
 * 从链接导入：原生下载不受 CORS 限制，下载完成后由用户点一下导入
 * （文件选择器必须由用户手势触发，下载是异步的，回来时手势已失效）。
 */
const ImportFromUrl = ({ disabled }: { disabled: boolean }) => {
  const t = useTranslate()
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [percent, setPercent] = useState<number | null>(null)
  const [ready, setReady] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  if (!canImportFromUrl()) {
    return null
  }

  const start = async () => {
    const target = url.trim()
    if (!/^https?:\/\//i.test(target)) {
      setError(t('importFromUrlInvalid'))
      return
    }
    setBusy(true)
    setError(null)
    setReady(null)
    setPercent(0)
    try {
      const bytes = await downloadArchive(target, {
        onProgress: (downloaded, total) => {
          setPercent(total > 0 ? Math.min(100, Math.round((downloaded / total) * 100)) : null)
        },
      })
      setReady(bytes)
    } catch (failure) {
      setError(
        t('importFromUrlFailed', {
          message: failure instanceof Error ? failure.message : String(failure),
        })
      )
    } finally {
      setBusy(false)
      setPercent(null)
    }
  }

  return (
    <div className={clsx(styles.cell, styles.row)}>
      <div className={styles.text}>
        <div className={styles.label}>{t('importFromUrl')}</div>
        <div className={styles.description}>
          {error ??
            (ready !== null
              ? t('importFromUrlReady', { size: formatSize(ready) })
              : t('importFromUrlDescription'))}
        </div>
      </div>
      <div className={styles.actions}>
        {ready !== null ? (
          <Button size="m" onClick={() => openPendingArchiveImport()}>
            {t('importFromUrlImport')}
          </Button>
        ) : (
          <input
            className={styles.apiKeyInput}
            value={url}
            placeholder={t('importFromUrlPlaceholder')}
            spellCheck={false}
            autoComplete="off"
            disabled={busy || disabled}
            onChange={(event) => setUrl(event.target.value)}
          />
        )}
        {ready === null ? (
          <Button size="m" variant="outlined" disabled={busy || disabled} onClick={() => void start()}>
            {busy
              ? t('importFromUrlDownloading', { percent: percent === null ? '…' : String(percent) })
              : t('importFromUrlDownload')}
          </Button>
        ) : null}
      </div>
    </div>
  )
}
/**
 * 「更多」：大部分人用不到、但偶尔需要的选项放这里。
 * 目前有：开启手动压缩上下文、自定义模型（中转站）、会话整理模式（实验）。
 */
const MoreSettings = () => {
  const organizer = useSettings((state) => state.sessionOrganizer)
  const t = useTranslate()
  const manualCompress = useSettings((state) => state.manualCompress)
  const titleMode = useSettings((state) => state.titleMode)
  return (
    <>
      <div className={styles.groupTitle}>{t('settingsMore')}</div>
      <NetworkModelSetting />
      <SettingCell
        label={t('settingsTitleMode')}
        description={t('settingsTitleModeDescription')}
        status={null}
        action={
          <div className={styles.titleModeRow}>
            <button
              type="button"
              className={clsx(styles.titleModeButton, titleMode === 'server' && styles.titleModeActive)}
              onClick={() => {
                setTitleMode('server')
                showToast({ key: 'settingsTitleModeServerOn' })
              }}
            >
              {t('settingsTitleModeServer')}
            </button>
            <button
              type="button"
              className={clsx(styles.titleModeButton, titleMode === 'extra' && styles.titleModeActive)}
              onClick={() => {
                setTitleMode('extra')
                showToast({ key: 'settingsTitleModeExtraOn' })
              }}
            >
              {t('settingsTitleModeExtra')}
            </button>
          </div>
        }
      />
      <SettingCell
        label={t('settingsManualCompress')}
        description={t('settingsManualCompressDescription')}
        status={null}
        action={
          <Switch
            checked={manualCompress}
            ariaLabel={t('settingsManualCompress')}
            onChange={(checked) => {
              setManualCompress(checked)
              showToast({ key: checked ? 'manualCompressEnabled' : 'manualCompressDisabled' })
            }}
          />
        }
      />
      <SettingCell
        label={t('settingsSessionGroups')}
        description={t('settingsSessionGroupsDescription')}
        status={null}
        action={
          <Switch
            checked={organizer}
            ariaLabel={t('settingsSessionGroups')}
            onChange={(checked) => {
              setSessionOrganizer(checked)
              showToast({ key: checked ? 'sessionGroupsEnabled' : 'sessionGroupsDisabled' })
            }}
          />
        }
      />
      <RelaySettings />
    </>
  )
}

/** 自定义模型（中转站）：开关 + 地址 / Key / 模型名 */
const RelaySettings = () => {
  const t = useTranslate()
  const enabled = useSettings((state) => state.relayEnabled)
  const relayBaseUrl = useSettings((state) => state.relayBaseUrl)
  const relayApiKey = useSettings((state) => state.relayApiKey)
  const relayModel = useSettings((state) => state.relayModel)
  const fields: {
    key: 'relayBaseUrl' | 'relayApiKey' | 'relayModel'
    label: string
    placeholder: string
    hint?: string
    value: string
  }[] = [
    {
      key: 'relayBaseUrl',
      label: t('settingsRelayBaseUrl'),
      placeholder: t('settingsRelayBaseUrlPlaceholder'),
      hint: t('settingsRelayBaseUrlHint'),
      value: relayBaseUrl,
    },
    {
      key: 'relayApiKey',
      label: t('settingsRelayApiKey'),
      placeholder: t('settingsRelayApiKeyPlaceholder'),
      value: relayApiKey,
    },
    {
      key: 'relayModel',
      label: t('settingsRelayModel'),
      placeholder: t('settingsRelayModelPlaceholder'),
      value: relayModel,
    },
  ]
  return (
    <>
      <SettingCell
        label={t('settingsRelay')}
        description={t('settingsRelayDescription')}
        status={null}
        action={
          <Switch
            checked={enabled}
            ariaLabel={t('settingsRelay')}
            onChange={(checked) => {
              if (!checked) {
                setRelayEnabled(false)
                showToast({ key: 'relayDisabled' })
                return
              }
              const state = useSettings.getState()
              if (!state.relayBaseUrl.trim() || !state.relayModel.trim()) {
                showToast({ key: 'settingsRelayIncomplete', type: 'error' })
                return
              }
              void askRelayEnable().then((confirmed) => {
                if (confirmed) {
                  setRelayEnabled(true)
                  showToast({ key: 'relayEnabled' })
                }
              })
            }}
          />
        }
      />
      {fields.map((field) => (
        <div key={field.key} className={clsx(styles.cell, styles.row)}>
          <div className={styles.text}>
            <div className={styles.label}>{field.label}</div>
            {field.hint ? <div className={styles.description}>{field.hint}</div> : null}
          </div>
          <input
            className={styles.apiKeyInput}
            value={field.value}
            placeholder={field.placeholder}
            spellCheck={false}
            autoComplete="off"
            onChange={(event) => setRelayConfig({ [field.key]: event.target.value })}
          />
        </div>
      ))}
    </>
  )
}

const SettingCell = ({  label,
  description,
  status,
  action,
  className,
}: {
  label: string
  description?: string
  status: Status
  action: ReactNode
  className?: string
}) => {
  const t = useTranslate()
  return (
    <div className={clsx(styles.cell, styles.row, className)}>
      <div className={styles.text}>
        <div className={styles.label}>{label}</div>
        {status || description ? (
          <div className={clsx(styles.description, status?.error && styles.error)}>
            {status
              ? t(status.key, status.reason ? { message: t(status.reason) } : status.params)
              : description}
          </div>
        ) : null}
      </div>
      {action}
    </div>
  )
}

/** 选文件后先提示覆盖；确认后才检查文件并执行导入，任何错误都提示导入失败。 */
const useHistoryImport = () => {
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<Status>(null)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const importing = useRef(false)
  const abortRef = useRef<AbortController | null>(null)

  const confirm = async () => {
    if (!file || importing.current) {
      return
    }
    importing.current = true
    const controller = new AbortController()
    abortRef.current = controller
    setFile(null)
    setBusy(true)
    setStatus(null)
    setProgress(null)
    try {
      // 大归档（几百 MB、上千条会话与图片）要写很久，逐条目回报进度。
      // 但每个条目都 setState 会触发一次渲染，几千个条目时白白拖慢导入：
      // 这里按 60ms 节流，只在真正要显示新进度时才更新。
      let lastPaint = 0
      const count = await importHistory(
        file,
        (done, total) => {
          const now = performance.now()
          if (now - lastPaint < 60 && done !== total) {
            return
          }
          lastPaint = now
          setProgress({ done, total })
        },
        controller.signal
      )
      setStatus({ key: count === 1 ? 'historyImportedOne' : 'historyImported', params: { count } })
    } catch {
      // 用户主动取消：不算失败，直接收起进度
      setStatus(controller.signal.aborted ? null : { key: 'historyImportFailed', error: true })
    } finally {
      importing.current = false
      abortRef.current = null
      setBusy(false)
      setProgress(null)
    }
  }

  return {
    file,
    busy,
    status,
    progress,
    select: setFile,
    cancel: () => setFile(null),
    abort: () => abortRef.current?.abort(),
    confirm,
  }
}

/**
 * 单会话导入（合并）：选好文件就直接读，不再二次确认——它只往列表里加一个对话，
 * 不覆盖任何已有数据，失败了原有记录也原样保留。
 */
const useHistoryImportSingle = () => {
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<Status>(null)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const importing = useRef(false)
  const abortRef = useRef<AbortController | null>(null)

  const start = async (file: File) => {
    if (importing.current) {
      return
    }
    importing.current = true
    const controller = new AbortController()
    abortRef.current = controller
    setBusy(true)
    setStatus(null)
    setProgress(null)
    try {
      // 进度按归档条目数走，和全量导入同一个回调形状；同样按 60ms 节流
      let lastPaint = 0
      await importSession(
        file,
        (done, total) => {
          const now = performance.now()
          if (now - lastPaint < 60 && done !== total) {
            return
          }
          lastPaint = now
          setProgress({ done, total })
        },
        controller.signal
      )
      setStatus({ key: 'historyImportedOne' })
    } catch (error) {
      setStatus(
        controller.signal.aborted ? null : errorStatus('historyImportSingleFailed', error)
      )
    } finally {
      importing.current = false
      abortRef.current = null
      setBusy(false)
      setProgress(null)
    }
  }

  return { busy, status, progress, start, abort: () => abortRef.current?.abort() }
}

/**
 * 导入期间的遮罩提示：归档越大写得越久，明确告知不能退出，
 * 并用条目进度条替代“什么都没发生”的卡死观感。
 */
const ImportProgress = ({
  progress,
  onCancel,
}: {
  progress: { done: number; total: number } | null
  onCancel?: () => void
}) => {
  const t = useTranslate()
  const ready = !!progress && progress.total > 0
  const percent = ready ? Math.round((progress.done / progress.total) * 100) : 0
  return (
    <Modal
      title={t('historyImportingTitle')}
      onClose={() => {}}
      footer={
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {ready ? <span style={{ fontSize: 14, opacity: 0.7 }}>{percent}%</span> : null}
          {onCancel ? (
            <Button variant="outlined" size="m" onClick={onCancel}>
              {t('cancel')}
            </Button>
          ) : null}
        </div>
      }
    >
      <div style={{ fontSize: 14, lineHeight: 1.7, opacity: 0.75 }}>
        {t('historyImportingDescription')}
      </div>
      {/* 中央目录还没读完时不假装有进度：给一条跑动的条带 + 「正在读取归档」 */}
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={ready ? percent : undefined}
        style={{
          height: 6,
          margin: '16px 0 10px',
          borderRadius: 999,
          overflow: 'hidden',
          background: 'rgba(127,127,127,0.2)',
        }}
      >
        <div
          style={{
            width: ready ? `${percent}%` : '35%',
            height: '100%',
            borderRadius: 999,
            background: 'var(--dsw-alias-brand-primary, #4d6bfe)',
            transition: ready ? 'width 200ms linear' : undefined,
            animation: ready ? undefined : 'dswImportIndeterminate 1.2s ease-in-out infinite',
          }}
        />
      </div>
      <div style={{ fontSize: 13, opacity: 0.6 }} data-import-progress>
        {ready
          ? t('historyImportingProgress', { done: progress.done, total: progress.total })
          : t('historyImportPreparing')}
      </div>
      <style>{`@keyframes dswImportIndeterminate {
        0% { transform: translateX(-100%); }
        100% { transform: translateX(300%); }
      }`}</style>
    </Modal>
  )
}

/** 导入 = 覆盖：用选中文件替换本地全部会话与附件。 */
const ImportHistory = ({
  historyImport,
  disabled,
}: {
  historyImport: ReturnType<typeof useHistoryImport>
  disabled: boolean
}) => {
  const t = useTranslate()
  const inputRef = useRef<HTMLInputElement>(null)

  return (
    <SettingCell
      label={t('historyImport')}
      description={t('historyImportDescription')}
      status={historyImport.status}
      action={
        <>
          <Button
            variant="outlined"
            size="m"
            className={clsx(styles.cellButton, styles.uploadButton)}
            disabled={disabled}
            onClick={() => inputRef.current?.click()}
          >
            <IconUploadOutline14 />
            {t('upload')}
          </Button>
          <input
            ref={inputRef}
            type="file"
            accept=".zip,application/zip,application/x-zip-compressed"
            data-role="history-import-input"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0]
              event.target.value = ''
              if (file) {
                historyImport.select(file)
              }
            }}
          />
        </>
      }
    />
  )
}

/**
 * 导入单个对话 = 合并：把归档里的一个对话并进现有列表，不覆盖其他对话；
 * 同一个文件导入两次会得到两个对话（和官方行为一致）。
 */
const ImportSingleSession = ({
  singleImport,
  disabled,
}: {
  singleImport: ReturnType<typeof useHistoryImportSingle>
  disabled: boolean
}) => {
  const t = useTranslate()
  const inputRef = useRef<HTMLInputElement>(null)

  return (
    <SettingCell
      label={t('historyImportSingle')}
      description={t('historyImportSingleDescription')}
      status={singleImport.status}
      action={
        <>
          <Button
            variant="outlined"
            size="m"
            className={clsx(styles.cellButton, styles.uploadButton)}
            disabled={disabled}
            onClick={() => inputRef.current?.click()}
          >
            <IconUploadOutline14 />
            {t('upload')}
          </Button>
          <input
            ref={inputRef}
            type="file"
            accept=".zip,application/zip,application/x-zip-compressed"
            data-role="history-import-input"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0]
              event.target.value = ''
              if (file) {
                void singleImport.start(file)
              }
            }}
          />
        </>
      }
    />
  )
}

/** 将全部会话及图片导出为 ZIP 文件并下载 */
/** 导出文件的保存位置；只有安卓壳子支持自选目录，浏览器里不显示这一行 */
const ExportFolderSetting = () => {
  const t = useTranslate()
  const [folder, setFolder] = useState(() => currentExportFolder())
  useEffect(() => {
    // 从系统选择器回到网页时刷新显示的目录名
    const sync = () => setFolder(currentExportFolder())
    window.addEventListener('focus', sync)
    document.addEventListener('visibilitychange', sync)
    return () => {
      window.removeEventListener('focus', sync)
      document.removeEventListener('visibilitychange', sync)
    }
  }, [])
  if (!canChooseExportFolder()) {
    return null
  }
  return (
    <SettingCell
      label={t('exportFolderLabel')}
      description={folder ? t('exportFolderChosen', { name: folder }) : t('exportFolderDefault')}
      status={null}
      action={
        <div className={styles.folderActions}>
          <Button
            variant="outlined"
            size="m"
            className={styles.cellButton}
            onClick={() => {
              chooseExportFolder()
            }}
          >
            {t('exportFolderChoose')}
          </Button>
          {folder ? (
            <Button
              variant="outlined"
              size="m"
              className={styles.cellButton}
              onClick={() => {
                if (resetExportFolder()) {
                  setFolder('')
                }
              }}
            >
              {t('exportFolderReset')}
            </Button>
          ) : null}
        </div>
      }
    />
  )
}


const ExportHistory = ({ disabled }: { disabled: boolean }) => {
  const t = useTranslate()
  const empty = useChatStore((state) => state.sessions.length === 0)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [status, setStatus] = useState<Status>(null)
  const abortRef = useRef<AbortController | null>(null)

  const onExport = async () => {
    setBusy(true)
    setStatus(null)
    setProgress(null)
    const controller = new AbortController()
    abortRef.current = controller
    try {
      const { name, blob } = await exportHistory(
        (done, total) => setProgress({ done, total }),
        controller.signal
      )
      const target = await saveBlob(blob, name)
      if (target === 'native') {
        showToast({ key: 'historyExportSaved' })
      } else if (target === 'failed') {
        setStatus({ key: 'historyExportFailed', error: true })
      }
    } catch (error) {
      // 用户主动终止：不算失败
      setStatus(controller.signal.aborted ? null : errorStatus('historyExportFailed', error))
    } finally {
      abortRef.current = null
      setBusy(false)
      setProgress(null)
    }
  }

  return (
    <>
      <SettingCell
        label={t('exportAllLabel')}
        description={t('historyExportDescription')}
        status={status}
        action={
          <Button
            variant="outlined"
            size="m"
            className={styles.cellButton}
            disabled={disabled || busy || empty}
            onClick={() => void onExport()}
          >
            <IconDownloadOutline16 />
            {t('exportAllDownload')}
          </Button>
        }
      />
      {busy ? (
        <ExportProgress progress={progress} onCancel={() => abortRef.current?.abort()} />
      ) : null}
    </>
  )
}

/** 导出进度：和导入共用同一套样式，带一个终止按钮 */
const ExportProgress = ({
  progress,
  onCancel,
}: {
  progress: { done: number; total: number } | null
  onCancel: () => void
}) => {
  const t = useTranslate()
  const ready = !!progress && progress.total > 0
  const percent = ready ? Math.round((progress.done / progress.total) * 100) : 0
  return (
    <Modal
      title={t('historyExportingTitle')}
      onClose={() => {}}
      footer={
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {ready ? <span style={{ fontSize: 14, opacity: 0.7 }}>{percent}%</span> : null}
          <Button variant="outlined" size="m" onClick={onCancel}>
            {t('cancel')}
          </Button>
        </div>
      }
    >
      <div style={{ fontSize: 14, lineHeight: 1.7, opacity: 0.75 }}>
        {t('historyExportingDescription')}
      </div>
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={ready ? percent : undefined}
        style={{
          height: 6,
          margin: '16px 0 10px',
          borderRadius: 999,
          overflow: 'hidden',
          background: 'rgba(127,127,127,0.2)',
        }}
      >
        <div
          style={{
            width: ready ? `${percent}%` : '35%',
            height: '100%',
            borderRadius: 999,
            background: 'var(--dsw-alias-brand-primary)',
            transition: 'width 0.2s ease',
          }}
        />
      </div>
    </Modal>
  )
}
