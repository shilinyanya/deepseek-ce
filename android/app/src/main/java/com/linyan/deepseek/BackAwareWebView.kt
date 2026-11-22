package com.linyan.deepseek

import android.content.Context
import android.util.AttributeSet
import android.view.KeyEvent
import android.webkit.WebView

/**
 * 键盘打开时，返回键会先走 onKeyPreIme（输入法之前的那一层），
 * 系统的 onBackPressed / OnBackInvoked 收不到。这里把它接过来交给网页处理。
 */
class BackAwareWebView(context: Context, attrs: AttributeSet?) : WebView(context, attrs) {
    /** 由 MainActivity 注入：处理一次返回（内部决定是关闭弹层还是退出应用） */
    var onBackPreIme: (() -> Unit)? = null

    override fun onKeyPreIme(keyCode: Int, event: KeyEvent): Boolean {
        if (keyCode == KeyEvent.KEYCODE_BACK && event.action == KeyEvent.ACTION_UP) {
            val handler = onBackPreIme
            if (handler != null) {
                handler()
                return true
            }
        }
        return super.onKeyPreIme(keyCode, event)
    }
}
