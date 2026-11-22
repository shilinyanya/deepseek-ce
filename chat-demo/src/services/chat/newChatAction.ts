import { newChat, useChatStore } from './store.js'
import { showToast } from '../../components/base/toastState.js'

/** 新建对话：已经在新对话界面时给一下震动和提示，不再重复切换 */
export const startNewChat = () => {
  if (useChatStore.getState().activeId === null) {
    // 官方在这里是很轻的一下反馈，20ms 足够
    navigator.vibrate?.(20)
    showToast({ key: 'alreadyNewChat' })
    return
  }
  newChat()
}
