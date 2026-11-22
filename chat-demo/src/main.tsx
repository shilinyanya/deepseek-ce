// 必须排在其它 import 之前：老 WebView 缺的 API 要在任何模块执行前补上
import './app/compat.js'
import { createRoot } from 'react-dom/client'
import { App } from './app/App.js'
import { setupPreferences } from './app/preferences.js'
import { setupTheme } from './app/theme.js'
import { ErrorBoundary } from './components/base/ErrorBoundary.js'
import { ensureKatex } from './services/markdown/katex.js'
import { setupAutoRead } from './services/speech/autoRead.js'
import './app/theme.css'
import './app/global.css'

ensureKatex()
setupPreferences()
setupTheme()
setupAutoRead()

createRoot(document.getElementById('root') as HTMLElement).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>
)

// 告诉安卓壳子「页面真的跑起来了」，原生那边据此收起「正在加载 / 没能启动」的状态层。
// 浏览器里没有这个桥，可选调用即可。
;(
  window as unknown as { AndroidBridge?: { notifyReady?: () => void } }
).AndroidBridge?.notifyReady?.()

// 系统返回键：设置 / 搜索页 / 抽屉逐级退出，处理不了才让原生退出应用
import { closeSettings, useSettingsDialog } from './components/settings/settingsDialogState.js'
import { closeMobileSider, useMobileSider } from './components/sider/mobileSiderState.js'
import { useSessionSearch } from './services/chat/searchState.js'

;(
  window as unknown as { __dsBack?: () => boolean }
).__dsBack = () => {
  if (useSettingsDialog.getState().open) {
    closeSettings()
    return true
  }
  const search = useSessionSearch.getState()
  if (search.searchFocused) {
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur()
    }
    // 退出全屏搜索页：回到侧栏列表，清空输入并移除焦点；再按一次才关抽屉
    useSessionSearch.setState({ query: '', searchFocused: false, restoreSearch: false })
    return true
  }
  if (useMobileSider.getState().open) {
    closeMobileSider()
    return true
  }
  return false
}
