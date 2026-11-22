package com.linyan.deepseek

import android.Manifest
import android.annotation.SuppressLint
import android.app.Dialog
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.content.pm.PackageManager
import android.content.res.Configuration
import android.graphics.Color
import android.graphics.drawable.ColorDrawable
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.provider.DocumentsContract
import android.provider.MediaStore
import android.util.Log
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.Window
import android.view.inputmethod.InputMethodManager
import android.webkit.ConsoleMessage
import android.webkit.JavascriptInterface
import android.webkit.MimeTypeMap
import android.webkit.PermissionRequest
import android.webkit.RenderProcessGoneDetail
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.TextView
import android.widget.Toast
import androidx.activity.OnBackPressedCallback
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import androidx.core.view.WindowCompat
import androidx.webkit.WebViewAssetLoader
import java.io.File

/**
 * DeepSeek 网页版的安卓壳子。
 *
 * 页面本身（官方 chat-demo 的构建产物）全部在 assets/www 里，壳子只补网页在
 * WebView 里做不到或默认不生效的几件事：
 *   1. 用 https://appassets.androidplatform.net/ 这个安全来源提供本地资源
 *      （file:// 下 localStorage、录音、IndexedDB 都会被限制）
 *   2. <input type="file"> 的文件选择器，不转发就没有任何反应
 *   3. 语音输入需要的麦克风权限（getUserMedia）
 *   4. 聊天记录导出：blob: 下载在 WebView 里不支持，改由原生写进「下载」目录
 *   5. 站外链接交给系统浏览器打开
 *   6. 物理返回键
 */
class MainActivity : AppCompatActivity() {

    private lateinit var webView: BackAwareWebView
    private lateinit var errorBox: View
    private lateinit var errorText: TextView
    private lateinit var statusBox: View
    private lateinit var statusText: TextView
    private lateinit var downloadWriter: DownloadWriter

    private var filePathCallback: ValueCallback<Array<Uri>>? = null
    private var pendingPermission: PermissionRequest? = null
    /** 网页发起选择文件时带的参数（多选、accept 类型） */
    private var chooserParams: WebChromeClient.FileChooserParams? = null
    private var sourceDialog: Dialog? = null
    /** 拍照写到这个 URI，回来时直接交给网页 */
    private var pendingCaptureUri: Uri? = null
    /** 从链接下载好的归档：网页下次打开「导入文件」选择器时直接返回它 */
    private var pendingArchiveUri: Uri? = null
    /** 同一时刻只跑一个归档下载 */
    private var archiveDownloading = false

    /** 把下载进度/结果送回网页；网页侧对应 window.__dsArchiveProgress 等回调 */
    private fun runInPage(script: String) {
        runOnUiThread {
            runCatching { webView.evaluateJavascript(script, null) }
        }
    }

    private fun notifyArchiveProgress(downloaded: Long, total: Long) {
        runInPage("window.__dsArchiveProgress&&window.__dsArchiveProgress($downloaded,$total)")
    }

    private fun notifyArchiveReady(bytes: Long) {
        runInPage("window.__dsArchiveReady&&window.__dsArchiveReady($bytes)")
    }

    private fun notifyArchiveFailed(message: String) {
        val escaped = message.replace("\\", "\\\\").replace("'", "\\'").replace("\n", " ")
        runInPage("window.__dsArchiveFailed&&window.__dsArchiveFailed('$escaped')")
    }
    /** 页面是否已经加载完成；用于启动看门狗判断白屏 */
    private var pageFinished = false
    /** 网页是否已经报告自己挂载完成（缺省就一直显示原生的加载/诊断文字） */
    private var webReady = false
    private val startupHandler = Handler(Looper.getMainLooper())
    private val startupWatchdog = Runnable { showDiagnostic("页面在 12 秒内没有加载完成") }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        webView = findViewById(R.id.webview)
        // 键盘打开时返回键走 onKeyPreIme，在这里交给网页处理
        webView.onBackPreIme = {
            Log.d("DSH-DEBUG", "[native] back pre-ime")
            webView.evaluateJavascript("window.__dsBack ? window.__dsBack() : false") { result ->
                if (result?.trim('"') != "true") {
                    if (webView.canGoBack()) {
                        webView.goBack()
                    } else {
                        finish()
                    }
                }
            }
        }
        errorBox = findViewById(R.id.errorBox)
        errorText = findViewById(R.id.errorText)
        statusBox = findViewById(R.id.statusBox)
        statusText = findViewById(R.id.statusText)
        // 先给个「正在加载」的底，WebView 全白时也不会让人以为是死机
        statusText.text = "正在加载…（v${runCatching { packageManager.getPackageInfo(packageName, 0).versionName }.getOrNull() ?: "?"}）"
        findViewById<Button>(R.id.reloadButton).setOnClickListener {
            errorBox.visibility = View.GONE
            webView.loadUrl(APP_URL)
        }

        downloadWriter = DownloadWriter(this)
        restoreExportFolder()
        configureWebView()
        // 启动时先按系统深浅色涂一次，页面加载完成后由网页同步成实际主题色
        val night = (resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK) ==
            Configuration.UI_MODE_NIGHT_YES
        applySystemBarColor(
            ContextCompat.getColor(
                this,
                if (night) R.color.window_background_dark else R.color.window_background_light
            )
        )
        // 只有 debuggable 包开放 WebView 远程调试；正式包关掉，
        // 否则任何能连 adb 的人都能读走 localStorage 里的 API Key
        if (applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE != 0) {
            WebView.setWebContentsDebuggingEnabled(true)
        }
        webView.addJavascriptInterface(Bridge(), "AndroidBridge")
        webView.loadUrl("$APP_URL?v=${BuildConfig.BUILD_STAMP}")
        // 老内核上网页可能一个字都跑不起来，那边连错误都显示不了；
        // 这里在原生侧兜一层，超时就先把 WebView 版本和 UA 摊在屏幕上。
        startupHandler.postDelayed(startupWatchdog, 12000)

        // Android 13+ 的返回手势走 OnBackInvoked，旧的 onBackPressed 回调收不到
        if (android.os.Build.VERSION.SDK_INT >= 33) {
            onBackInvokedDispatcher.registerOnBackInvokedCallback(
                android.window.OnBackInvokedDispatcher.PRIORITY_DEFAULT
            ) {
                Log.d("DSH-DEBUG", "[native] back invoked")
                webView.evaluateJavascript(
                    "window.__dsBack ? window.__dsBack() : false"
                ) { result ->
                    if (result?.trim('"') != "true") {
                        if (webView.canGoBack()) {
                            webView.goBack()
                        } else {
                            finish()
                        }
                    }
                }
            }
        }
        onBackPressedDispatcher.addCallback(
            this,
            object : OnBackPressedCallback(true) {
                override fun handleOnBackPressed() {
                    Log.d("DSH-DEBUG", "[native] back received")
                    // 先让网页决定：设置、搜索页、抽屉要逐级退出
                    webView.evaluateJavascript(
                        "window.__dsBack ? window.__dsBack() : false"
                    ) { result ->
                        if (result?.trim('"') == "true") {
                            return@evaluateJavascript
                        }
                        if (webView.canGoBack()) {
                            webView.goBack()
                        } else {
                            finish()
                        }
                    }
                }
            }
        )
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun configureWebView() {
        val settings = webView.settings
        settings.javaScriptEnabled = true
        settings.domStorageEnabled = true
        settings.databaseEnabled = true
        // Web Audio（朗读 TTS）不点屏幕也要能出声
        settings.mediaPlaybackRequiresUserGesture = false
        settings.allowFileAccess = false
        settings.allowContentAccess = false
        settings.loadsImagesAutomatically = true
        settings.cacheMode = WebSettings.LOAD_DEFAULT
        settings.useWideViewPort = true
        settings.loadWithOverviewMode = true
        // 忽略系统字体缩放，避免聊天布局被撑坏
        settings.textZoom = 100
        webView.setBackgroundColor(
            ContextCompat.getColor(this, R.color.window_background)
        )

        val assetLoader = WebViewAssetLoader.Builder()
            .setDomain(ASSET_DOMAIN)
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()

        webView.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(
                view: WebView,
                request: WebResourceRequest
            ): WebResourceResponse? = assetLoader.shouldInterceptRequest(request.url)

            override fun shouldOverrideUrlLoading(
                view: WebView,
                request: WebResourceRequest
            ): Boolean {
                val url = request.url
                if (url.host == ASSET_DOMAIN) {
                    return false
                }
                // 引用来源、Markdown 里的链接交给系统浏览器
                return try {
                    startActivity(Intent(Intent.ACTION_VIEW, url))
                    true
                } catch (error: Exception) {
                    true
                }
            }

            override fun onPageFinished(view: WebView, url: String) {
                pageFinished = true
                startupHandler.removeCallbacks(startupWatchdog)
                errorBox.visibility = View.GONE
                // 文档加载完不等于应用跑起来：给网页 3 秒报告自己挂载完成
                startupHandler.postDelayed({
                    if (!webReady) {
                        showDiagnostic("页面已加载，但应用没有启动（JS 未能运行）")
                    }
                }, 3000)
            }

            override fun onReceivedError(
                view: WebView,
                request: WebResourceRequest,
                error: WebResourceError
            ) {
                if (request.isForMainFrame) {
                    startupHandler.removeCallbacks(startupWatchdog)
                    showDiagnostic("页面加载失败：${error.errorCode} ${error.description}")
                }
            }

            /** 渲染进程崩了（老内核内存不足很常见）：不能留一片白，把原因写出来 */
            override fun onRenderProcessGone(
                view: WebView,
                detail: RenderProcessGoneDetail
            ): Boolean {
                startupHandler.removeCallbacks(startupWatchdog)
                showDiagnostic(
                    if (detail.didCrash()) "WebView 渲染进程崩溃" else "WebView 渲染进程被系统回收"
                )
                return true
            }
        }

        webView.webChromeClient = object : WebChromeClient() {
            // 不转发这个回调，网页里的附件上传按钮点了没反应
            override fun onShowFileChooser(
                view: WebView,
                callback: ValueCallback<Array<Uri>>,
                params: FileChooserParams
            ): Boolean {
                // 从链接下载好的归档：这次选择器直接交回它，不再弹系统文件框
                val archive = pendingArchiveUri
                if (archive != null && params.acceptTypes.any { it.contains("zip") }) {
                    pendingArchiveUri = null
                    filePathCallback?.onReceiveValue(null)
                    callback.onReceiveValue(arrayOf(archive))
                    return true
                }
                filePathCallback?.onReceiveValue(null)
                filePathCallback = callback
                chooserParams = params
                if (wantsSourceSheet(params.acceptTypes)) {
                    showSourceSheet()
                } else {
                    launchFiles()
                }
                return true
            }

            override fun onPermissionRequest(request: PermissionRequest) {
                handlePermissionRequest(request)
            }

            override fun onConsoleMessage(message: ConsoleMessage): Boolean {
                Log.d(
                    "DeepSeekWeb",
                    "${message.message()} @${message.lineNumber()} ${message.sourceId()}"
                )
                return true
            }
        }
    }

    /**
     * 原生侧诊断：网页那边白屏时连错误都吐不出来（老内核可能连 JS 都跑不起来），
     * 这里把应用版本、WebView 内核版本、UA 一起摊在屏幕上，用户截图即可定位。
     */
    private fun showDiagnostic(reason: String) {
        val appVersion = runCatching {
            packageManager.getPackageInfo(packageName, 0).versionName
        }.getOrNull() ?: "?"
        val ua = runCatching { webView.settings.userAgentString }.getOrNull() ?: "?"
        errorText.text = buildString {
            append(reason)
            append("\n应用版本：")
            append(appVersion)
            append("\nWebView：")
            append(describeWebViewPackage())
            append("\nUA：")
            append(ua)
        }
        errorBox.visibility = View.VISIBLE
    }

    /** 当前 WebView 内核来自哪个包、什么版本（荣耀/华为机上通常不是 com.google.android.webview） */
    private fun describeWebViewPackage(): String =
        runCatching { WebView.getCurrentWebViewPackage() }.getOrNull()
            ?.let { "${it.packageName} ${it.versionName}" }
            ?: "未知"

    /** 记下用户选的导出目录，并立刻生效 */
    private fun saveExportFolder(tree: Uri) {
        val name = runCatching {
            DocumentsContract.getTreeDocumentId(tree).substringAfterLast(':').ifBlank {
                tree.lastPathSegment ?: ""
            }
        }.getOrDefault("")
        getSharedPreferences(PREFS, MODE_PRIVATE).edit()
            .putString(KEY_EXPORT_FOLDER, tree.toString())
            .putString(KEY_EXPORT_FOLDER_NAME, name)
            .apply()
        downloadWriter.setTreeUri(tree)
    }

    /** 启动时恢复上次选的目录；授权被系统回收就退回系统「下载」 */
    private fun restoreExportFolder() {
        val saved = getSharedPreferences(PREFS, MODE_PRIVATE).getString(KEY_EXPORT_FOLDER, null)
            ?: return
        val tree = Uri.parse(saved)
        val stillAllowed = contentResolver.persistedUriPermissions
            .any { it.uri == tree && it.isWritePermission }
        if (stillAllowed) {
            downloadWriter.setTreeUri(tree)
        }
    }

    /** 网页要显示的当前保存位置；空字符串表示系统「下载」 */
    private fun readExportFolderName(): String =
        getSharedPreferences(PREFS, MODE_PRIVATE).getString(KEY_EXPORT_FOLDER_NAME, "") ?: ""

    /** 附件才给「拍照 / 相册 / 文件」三选；聊天记录导入那种只收 ZIP 的直接走文件选择器 */
    private fun wantsSourceSheet(acceptTypes: Array<String>): Boolean {
        val joined = acceptTypes.joinToString(",").lowercase()
        if (joined.isBlank()) {
            return true
        }
        val hasImage = IMAGE_ACCEPT_HINTS.any { joined.contains(it) }
        return !(joined.contains("zip") && !hasImage)
    }

    /** 底部弹出「拍照 / 相册 / 文件」，选完再拉起对应界面 */
    private fun showSourceSheet() {
        val dialog = Dialog(this)
        dialog.requestWindowFeature(Window.FEATURE_NO_TITLE)
        dialog.setContentView(R.layout.dialog_pick_source)
        dialog.setCanceledOnTouchOutside(true)
        dialog.setOnCancelListener { cancelFileChooser() }
        dialog.window?.apply {
            setBackgroundDrawable(ColorDrawable(Color.TRANSPARENT))
            setLayout(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
            setGravity(Gravity.BOTTOM)
        }
        dialog.findViewById<View>(R.id.optionCamera).setOnClickListener {
            dialog.dismiss()
            launchCamera()
        }
        dialog.findViewById<View>(R.id.optionGallery).setOnClickListener {
            dialog.dismiss()
            launchGallery()
        }
        dialog.findViewById<View>(R.id.optionFiles).setOnClickListener {
            dialog.dismiss()
            launchFiles()
        }
        sourceDialog = dialog
        dialog.show()
    }

    /** 拍照：写进缓存目录，再把 FileProvider URI 交给系统相机 */
    private fun launchCamera() {
        val dir = File(cacheDir, "capture").apply { mkdirs() }
        val photo = File(dir, "photo-${System.currentTimeMillis()}.jpg")
        pendingCaptureUri = try {
            FileProvider.getUriForFile(this, "$packageName.fileprovider", photo)
        } catch (error: Exception) {
            null
        }
        val output = pendingCaptureUri
        if (output == null) {
            toast(R.string.open_failed)
            cancelFileChooser()
            return
        }
        val intent = Intent(MediaStore.ACTION_IMAGE_CAPTURE).apply {
            putExtra(MediaStore.EXTRA_OUTPUT, output)
            addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION or Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
        try {
            startActivityForResult(intent, CAMERA_REQUEST)
        } catch (error: Exception) {
            pendingCaptureUri = null
            toast(R.string.no_camera)
            cancelFileChooser()
        }
    }

    /** 从相册结果里收集选中的 URI：单选在 data，多选在 ClipData */
    private fun collectResultUris(data: Intent?): List<Uri> {
        if (data == null) {
            return emptyList()
        }
        val clip = data.clipData
        if (clip != null && clip.itemCount > 0) {
            return (0 until clip.itemCount).mapNotNull { clip.getItemAt(it).uri }
        }
        return listOfNotNull(data.data)
    }

    /**
     * 把相册返回的 content URI 复制成应用缓存里的普通文件，并按 MIME 补上真实扩展名。
     * 老 WebView 读不懂 content://media/picker/... 这类 URI，复制后它就只需读文件。
     */
    private fun materializeImages(uris: List<Uri>): Array<Uri> {
        if (uris.isEmpty()) {
            return emptyArray()
        }
        val dir = File(cacheDir, "picked").apply { mkdirs() }
        val stamp = System.currentTimeMillis()
        val result = ArrayList<Uri>(uris.size)
        uris.forEachIndexed { index, uri ->
            val mime = try {
                contentResolver.getType(uri)
            } catch (error: Exception) {
                null
            }
            val ext = mime?.let { MimeTypeMap.getSingleton().getExtensionFromMimeType(it) } ?: "jpg"
            val target = File(dir, "pick-$stamp-$index.$ext")
            val ok = try {
                contentResolver.openInputStream(uri)?.use { input ->
                    target.outputStream().use { output -> input.copyTo(output) }
                }
                target.length() > 0
            } catch (error: Exception) {
                false
            }
            if (ok) {
                // 必须回 content://（FileProvider）：WebView 关掉了 allowFileAccess，file:// 会被拒
                result.add(
                    FileProvider.getUriForFile(
                        this,
                        "$packageName.fileprovider",
                        target
                    )
                )
            } else {
                target.delete()
            }
        }
        return result.toTypedArray()
    }

    /** 相册：Android 13 起用系统相册选择器，低版本退回图片类型的内容选择 */
    private fun launchGallery() {
        val multiple = chooserParams?.mode == WebChromeClient.FileChooserParams.MODE_OPEN_MULTIPLE
        val intent = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            Intent(MediaStore.ACTION_PICK_IMAGES).apply {
                type = "image/*"
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                if (multiple) {
                    putExtra(MediaStore.EXTRA_PICK_IMAGES_MAX, GALLERY_PICK_LIMIT)
                }
            }
        } else {
            Intent(Intent.ACTION_GET_CONTENT).apply {
                addCategory(Intent.CATEGORY_OPENABLE)
                type = "image/*"
                putExtra(Intent.EXTRA_ALLOW_MULTIPLE, multiple)
            }
        }
        try {
            startActivityForResult(intent, GALLERY_REQUEST)
        } catch (error: Exception) {
            // 没有相册应用时退回通用文件选择
            launchFiles()
        }
    }

    /** 文件：按网页给的 accept 过滤 */
    private fun launchFiles() {
        val params = chooserParams
        val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE)
            type = "*/*"
            putExtra(
                Intent.EXTRA_ALLOW_MULTIPLE,
                params?.mode == WebChromeClient.FileChooserParams.MODE_OPEN_MULTIPLE
            )
            if (params != null) {
                putExtra(Intent.EXTRA_MIME_TYPES, normalizeMimeTypes(params.acceptTypes))
            }
        }
        try {
            startActivityForResult(
                Intent.createChooser(intent, getString(R.string.pick_file)),
                FILE_CHOOSER_REQUEST
            )
        } catch (error: Exception) {
            toast(R.string.open_failed)
            cancelFileChooser()
        }
    }

    /** 用户取消了选择：通知网页没有拿到文件，并清掉挂起的回调 */
    private fun cancelFileChooser() {
        val callback = filePathCallback
        filePathCallback = null
        chooserParams = null
        pendingCaptureUri = null
        callback?.onReceiveValue(null)
    }

    private fun toast(messageRes: Int) {
        Toast.makeText(this, messageRes, Toast.LENGTH_SHORT).show()
    }

    /** accept 里既有 MIME 也有扩展名，系统选择器只认 MIME */
    private fun normalizeMimeTypes(acceptTypes: Array<String>): Array<String> {
        val mimeTypes = acceptTypes
            .flatMap { it.split(',') }
            .map { it.substringBefore(';').trim() }
            .filter { it.contains('/') && !it.startsWith('.') }
            .distinct()
        return if (mimeTypes.isEmpty()) arrayOf("*/*") else mimeTypes.toTypedArray()
    }

    /** 只有语音输入需要麦克风，其他权限一律拒绝 */
    private fun handlePermissionRequest(request: PermissionRequest) {
        if (!request.resources.contains(PermissionRequest.RESOURCE_AUDIO_CAPTURE)) {
            request.deny()
            return
        }
        val granted = ContextCompat.checkSelfPermission(
            this,
            Manifest.permission.RECORD_AUDIO
        ) == PackageManager.PERMISSION_GRANTED
        if (granted) {
            request.grant(arrayOf(PermissionRequest.RESOURCE_AUDIO_CAPTURE))
            return
        }
        pendingPermission = request
        ActivityCompat.requestPermissions(
            this,
            arrayOf(Manifest.permission.RECORD_AUDIO),
            AUDIO_PERMISSION_REQUEST
        )
    }

    override fun onRequestPermissionsResult(
        requestCode: Int,
        permissions: Array<out String>,
        grantResults: IntArray
    ) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode != AUDIO_PERMISSION_REQUEST) {
            return
        }
        val request = pendingPermission
        pendingPermission = null
        if (grantResults.isNotEmpty() && grantResults[0] == PackageManager.PERMISSION_GRANTED) {
            request?.grant(arrayOf(PermissionRequest.RESOURCE_AUDIO_CAPTURE))
        } else {
            request?.deny()
        }
    }

    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        when (requestCode) {
            GALLERY_REQUEST -> {
                val callback = filePathCallback
                filePathCallback = null
                chooserParams = null
                // 相册（ACTION_PICK_IMAGES）返回的是 content://media/picker/... ，
                // 老 WebView 读不懂这类 URI，拿到的文件没有名字也没有内容，
                // 表现为「选了图既不显示缩略图也发不出去」。这里先复制成自己的缓存文件，
                // 用带正确扩展名的 file:// 交回去，内核就只需读普通文件。
                val uris = collectResultUris(data)
                val copied = if (resultCode == RESULT_OK) materializeImages(uris) else emptyArray()
                callback?.onReceiveValue(if (copied.isEmpty()) null else copied)
                return
            }

            FILE_CHOOSER_REQUEST -> {
                val callback = filePathCallback
                filePathCallback = null
                chooserParams = null
                callback?.onReceiveValue(
                    WebChromeClient.FileChooserParams.parseResult(resultCode, data)
                )
                return
            }

            FOLDER_REQUEST -> {
                val tree = data?.data
                if (resultCode == RESULT_OK && tree != null) {
                    try {
                        contentResolver.takePersistableUriPermission(
                            tree,
                            Intent.FLAG_GRANT_READ_URI_PERMISSION or
                                Intent.FLAG_GRANT_WRITE_URI_PERMISSION
                        )
                    } catch (error: Exception) {
                        // 个别文件管理应用不给持久授权，本次仍可用，下次要重选
                    }
                    saveExportFolder(tree)
                    toast(R.string.export_folder_saved)
                }
                return
            }

            CAMERA_REQUEST -> {                val callback = filePathCallback
                filePathCallback = null
                chooserParams = null
                val photo = pendingCaptureUri
                pendingCaptureUri = null
                // 拍照时 data 里没有 Uri，结果在 EXTRA_OUTPUT 指定的文件里
                callback?.onReceiveValue(
                    if (resultCode == RESULT_OK && photo != null) arrayOf(photo) else null
                )
                return
            }
        }
        @Suppress("DEPRECATION")
        super.onActivityResult(requestCode, resultCode, data)
    }

    /**
     * 系统栏跟随网页背景色。
     *
     * 顶部那条黑边的成因：全面屏机器的挖孔/刘海默认不参与布局，系统会把应用整体
     * 下移并把这块涂黑。主题里已经用 windowLayoutInDisplayCutoutMode=shortEdges
     * 让窗口铺进去，这里只要把「窗口底色」也设成页面色，挖孔区和状态栏后面就都是
     * 页面的颜色了。键盘由清单里的 adjustResize 负责，不要在这里改内边距，
     * 否则 WebView 的视口不缩、输入框会被键盘盖住。
     */
    private fun applySystemBarColor(color: Int) {
        window.statusBarColor = Color.TRANSPARENT
        window.navigationBarColor = Color.TRANSPARENT
        window.setBackgroundDrawable(ColorDrawable(color))
        webView.setBackgroundColor(color)
        val lightIcons = isLightColor(color)
        WindowCompat.getInsetsController(window, window.decorView).apply {
            isAppearanceLightStatusBars = lightIcons
            isAppearanceLightNavigationBars = lightIcons
        }
    }

    /** 浅色背景配深色图标，深色背景配浅色图标 */
    private fun isLightColor(color: Int): Boolean {
        val red = Color.red(color) / 255.0
        val green = Color.green(color) / 255.0
        val blue = Color.blue(color) / 255.0
        return 0.299 * red + 0.587 * green + 0.114 * blue > 0.6
    }

    /** 网页侧 download.ts 调用的原生保存通道 */
    private inner class Bridge {
        /** 网页挂载完成：隐藏原生的「正在加载」状态层 */
        @JavascriptInterface
        fun notifyReady() {            webReady = true
            runOnUiThread {
                statusBox.visibility = View.GONE
                statusText.text = ""
            }
        }

        /** 网页切换深浅色时调用，参数为页面背景色的 #RRGGBB */
        @JavascriptInterface
        fun setSystemBarColor(color: String) {
            // 能调到这个方法就说明网页的 JS 确实在跑，顺手把状态层收掉，
            // 避免 notifyReady 因为时序问题没赶上导致误报「应用没有启动」
            webReady = true
            runOnUiThread {
                if (statusBox.visibility == View.VISIBLE) {
                    statusBox.visibility = View.GONE
                    statusText.text = ""
                }
            }
            val parsed = try {
                Color.parseColor(color)
            } catch (error: Exception) {
                return
            }
            runOnUiThread { applySystemBarColor(parsed) }
        }

        /** 临时调试通道：网页把诊断信息写进 logcat */
        @JavascriptInterface
        fun debugLog(message: String) {
            Log.e("DSH-DEBUG", message)
        }

        /** 网页里点侧栏等操作时，清掉 WebView 里残留的文字选择和系统工具条 */
        @JavascriptInterface
        fun clearSelection() {
            runOnUiThread {
                webView.evaluateJavascript(
                    "window.getSelection && window.getSelection().removeAllRanges()",
                    null,
                )
            }
        }

        /** 读取系统剪贴板文本，供设置页的「粘贴」按钮使用 */
        @JavascriptInterface
        fun readClipboard(): String {
            val clipboard = getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
            val clip = clipboard.primaryClip ?: return ""
            if (clip.itemCount == 0) {
                return ""
            }
            return clip.getItemAt(0).coerceToText(this@MainActivity)?.toString() ?: ""
        }

        /** 收起软键盘：网页下滑手势里只 blur 输入框，WebView 不一定能收掉键盘 */
        @JavascriptInterface
        fun hideKeyboard() {
            runOnUiThread {
                val imm = getSystemService(Context.INPUT_METHOD_SERVICE) as InputMethodManager
                imm.hideSoftInputFromWindow(webView.windowToken, 0)
            }
        }

        @JavascriptInterface
        fun beginFile(name: String): Boolean = downloadWriter.begin(name)

        /**
         * 从链接下载归档：原生下载不受 CORS 限制，能跟随重定向，
         * 进度与结果通过 window.__dsArchive* 回调网页。
         */
        @JavascriptInterface
        fun downloadArchive(url: String): Boolean {
            if (!url.startsWith("https://") && !url.startsWith("http://")) {
                return false
            }
            if (archiveDownloading) {
                return false
            }
            archiveDownloading = true
            Thread {
                var connection: java.net.HttpURLConnection? = null
                try {
                    val dir = File(cacheDir, "archives").apply { mkdirs() }
                    val target = File(dir, "import-${System.currentTimeMillis()}.zip")
                    connection = (java.net.URL(url).openConnection() as java.net.HttpURLConnection).apply {
                        instanceFollowRedirects = true
                        connectTimeout = 20_000
                        readTimeout = 60_000
                        setRequestProperty("User-Agent", "Mozilla/5.0 (Linux; Android) DeepSeekCE")
                    }
                    connection.connect()
                    val code = connection.responseCode
                    if (code !in 200..299) {
                        notifyArchiveFailed("HTTP $code")
                        return@Thread
                    }
                    val total = connection.contentLengthLong
                    var downloaded = 0L
                    var reportedAt = 0L
                    connection.inputStream.use { input ->
                        java.io.FileOutputStream(target).use { output ->
                            val buffer = ByteArray(64 * 1024)
                            while (true) {
                                val read = input.read(buffer)
                                if (read <= 0) break
                                output.write(buffer, 0, read)
                                downloaded += read
                                if (downloaded - reportedAt >= 1024 * 1024) {
                                    reportedAt = downloaded
                                    notifyArchiveProgress(downloaded, total)
                                }
                            }
                        }
                    }
                    notifyArchiveProgress(downloaded, if (total > 0) total else downloaded)
                    pendingArchiveUri =
                        FileProvider.getUriForFile(
                            this@MainActivity,
                            "$packageName.fileprovider",
                            target
                        )
                    notifyArchiveReady(downloaded)
                } catch (error: Exception) {
                    notifyArchiveFailed(error.message ?: error.javaClass.simpleName)
                } finally {
                    runCatching { connection?.disconnect() }
                    archiveDownloading = false
                }
            }.start()
            return true
        }

        /** 下载完成后，由网页在真实点击里调用，打开「导入文件」选择器拿到这个文件 */
        @JavascriptInterface
        fun hasPendingArchive(): Boolean = pendingArchiveUri != null

        /** 打开系统文件夹选择器，让用户指定导出文件的保存位置 */
        @JavascriptInterface
        fun chooseExportFolder(): Boolean {
            val intent = Intent(Intent.ACTION_OPEN_DOCUMENT_TREE).apply {
                addFlags(
                    Intent.FLAG_GRANT_READ_URI_PERMISSION or
                        Intent.FLAG_GRANT_WRITE_URI_PERMISSION or
                        Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION
                )
            }
            return try {
                runOnUiThread { startActivityForResult(intent, FOLDER_REQUEST) }
                true
            } catch (error: Exception) {
                false
            }
        }

        /** 当前选定的保存目录名；空字符串表示系统「下载」 */
        @JavascriptInterface
        fun exportFolderName(): String = readExportFolderName()

        /** 恢复默认保存位置：清掉用户选的目录，退回系统「下载」 */
        @JavascriptInterface
        fun resetExportFolder(): Boolean {
            getSharedPreferences(PREFS, MODE_PRIVATE).edit()
                .remove(KEY_EXPORT_FOLDER)
                .remove(KEY_EXPORT_FOLDER_NAME)
                .apply()
            runOnUiThread { downloadWriter.setTreeUri(null) }
            return true
        }
        @JavascriptInterface
        fun appendFileChunk(base64: String): Boolean = downloadWriter.append(base64)

        @JavascriptInterface
        fun endFile(): Boolean {
            val saved = downloadWriter.end()
            runOnUiThread {
                Toast.makeText(
                    this@MainActivity,
                    if (saved) R.string.saved_to_downloads else R.string.save_failed,
                    Toast.LENGTH_SHORT
                ).show()
            }
            return saved
        }
    }

    override fun onPause() {
        super.onPause()
        webView.onPause()
    }

    override fun onResume() {
        super.onResume()
        webView.onResume()
    }

    override fun onDestroy() {
        sourceDialog?.dismiss()
        sourceDialog = null
        webView.loadUrl("about:blank")
        webView.removeAllViews()
        (webView.parent as? ViewGroup)?.removeView(webView)
        webView.destroy()
        super.onDestroy()
    }

    companion object {
        private const val ASSET_DOMAIN = "appassets.androidplatform.net"
        private const val APP_URL = "https://$ASSET_DOMAIN/assets/www/index.html"
        private const val FILE_CHOOSER_REQUEST = 1001
        private const val AUDIO_PERMISSION_REQUEST = 1002
        private const val CAMERA_REQUEST = 1003
        private const val GALLERY_REQUEST = 1004
        private const val FOLDER_REQUEST = 1005
        /** 保存导出目录用的 SharedPreferences */
        private const val PREFS = "deepseek-shell"
        private const val KEY_EXPORT_FOLDER = "exportFolder"
        private const val KEY_EXPORT_FOLDER_NAME = "exportFolderName"
        private const val GALLERY_PICK_LIMIT = 10
        /** accept 里出现这些字样就认为是要传图片，此时才给「拍照 / 相册」入口 */
        private val IMAGE_ACCEPT_HINTS = listOf(".png", ".jpg", ".jpeg", ".webp", ".heic", "image/")
    }
}
