# 非官方 DeepSeek 网页 / 安卓客户端

> ⚠️ **本项目为非官方项目**，与杭州深度求索人工智能基础技术研究有限公司（DeepSeek）无隶属、合作或背书关系。
> 本仓库基于官方 MIT 开源的 [deepseek-ai/chat-demo](https://github.com/deepseek-ai/chat-demo) 改造而来，
> 需要自备 `api.deepseek.com` 的 API Key，数据只保存在你自己的设备上。
> 详见 [NOTICE.md](NOTICE.md)。

官方开源 demo 那套 1:1 的网页界面和功能全部保留，Key 用你自己的 `api.deepseek.com` 密钥，数据只存在本地。

---

## 📥 下载

<table>
<tr>
<td align="center" width="170">
<img src="docs/apk-qr.png" width="150" alt="手机扫码安装"><br>
<sub>手机扫码安装</sub>
</td>
<td>
<h3><a href="../../releases/latest">⬇ 下载最新版（安卓 APK）</a></h3>
<code>10.3 MB</code> · Android 10+（API 29 起）· 直接覆盖安装，聊天记录不丢<br>
<sub>桌面图标名字是 <b>DeepSeek CE</b>（Community Edition / 非官方社区版）</sub>
</td>
</tr>
</table>

> 装的时候如果手机管家拦「未知来源应用」，选「继续安装」即可。本 APK 用 debug 证书签名，不走应用商店分发。

### 🌐 网页版

| 方式 | 地址 | 说明 |
| --- | --- | --- |
| **在线使用** | [shilinyanya.github.io/deepseek-ce](https://shilinyanya.github.io/deepseek-ce/) | 点开就用，免安装 |
| **离线包** | [Releases 页面下载](../../releases/latest)（1.8 MB） | 解压后双击 `index.html`，纯静态、不需要服务器 |

### 💻 源码

| 方式 | 地址 |
| --- | --- |
| 打包下载 | [Download ZIP](https://github.com/shilinyanya/deepseek-ce/archive/refs/heads/main.zip)（GitHub 自动生成，永远是最新代码） |
| 克隆 | `git clone git@github.com:shilinyanya/deepseek-ce.git` |

---

## 🔑 第一次用要做什么

装好 / 打开后，去 [`platform.deepseek.com`](https://platform.deepseek.com) 申请一把 API Key，然后：

> **设置 → 数据管理 → 填 API Key**

Key 只存在你自己的设备上（浏览器 localStorage / 应用本地存储），**不经过任何中转服务器**，
请求直接打到 `api.deepseek.com`。

---

## 🔒 隐私与安全

这个项目从头到尾**没有服务器** —— 没有中转、没有埋点、没有账号体系。

| 项目 | 实际情况 |
| --- | --- |
| API Key | 只存你自己的设备上（浏览器 localStorage / 应用本地存储），不上传 |
| 聊天记录 | 存本地（IndexedDB / 应用私有目录），导出要你自己点 |
| 中转服务器 | **没有**。请求直连 `api.deepseek.com` |
| 数据统计 / 埋点 | **没有** |
| 代码可审计 | 前端逻辑全在 [`chat-demo/src/`](chat-demo/src)，任你翻 |

### APK 申请的权限（只有这三个）

| 权限 | 用途 |
| --- | --- |
| `INTERNET` | 访问 `api.deepseek.com` |
| `RECORD_AUDIO` | 语音输入 |
| `MODIFY_AUDIO_SETTINGS` | 朗读时的音频输出 |

**没有**定位、通讯录、短信、相机、存储、电话状态这些权限。

> 拍照走系统相机 App（`ACTION_IMAGE_CAPTURE` + FileProvider），所以不需要 `CAMERA` 权限；
> 导出文件走 `MediaStore`，所以不需要存储权限。

### 其他

- `usesCleartextTraffic="false"` —— 强制 HTTPS，不允许明文 HTTP
- APK 用 **debug 证书**签名，不是应用商店分发的正式版本，安装前请自行核对下载来源
- 不放心？直接抓包确认请求只发往 `api.deepseek.com`

---

## ⚠️ 使用前提

**需要能正常访问 GitHub 的网络环境。** 项目和它的在线版（GitHub Pages）都托管在 GitHub 上，
网络不通的话连下载这一步都走不到。

---

## 目录结构

```
chat-demo/                 官方开源前端的源码（已改：多模型 + 系统提示词 + 原生保存通道）
  dist/                    构建产物，纯静态，可直接双击 index.html 或丢到任意静态服务器
android/                   安卓套壳工程（Kotlin + WebViewAssetLoader）
  app/src/main/assets/www/ 构建产物副本（打 APK 时打包进去）
tools/                     本地预览与自动化验证脚本
docs/                      仓库用图（APK 下载二维码）

DeepSeek-CE-X.Y.Z.apk     安装包（**不进仓库**，每次发版挂到 Releases）
DeepSeek-CE-X.Y.Z-web.zip 网页版离线包（**不进仓库**，同样挂 Releases）
```

## Web 版

### 直接用

```powershell
node tools/serve-dist.mjs chat-demo/dist 8091
# 浏览器打开 http://127.0.0.1:8091
```

也可以直接把 `chat-demo/dist` 整个目录丢给 Nginx / GitHub Pages / Vercel 等静态托管。

### 开发

```bash
cd chat-demo
pnpm install
pnpm dev          # http://localhost:8090
pnpm build        # 产物在 dist/
pnpm type         # TypeScript 检查
pnpm lint         # oxlint
```

构建脚本是 POSIX 写法（`rm -rf dist && NODE_ENV=production rspack build`），
Windows 下请用 WSL/Git Bash 或把命令换成 `rspack build --mode production`。

### 接自己的 API

打开「设置 → 数据管理」填入 API Key（`platform.deepseek.com` 申请），
Key 存在浏览器 localStorage，会话和附件存在 IndexedDB，**不经过任何中转服务器**。

请求直接打到：

| 用途 | 接口 |
| --- | --- |
| 对话（流式） | `POST https://api.deepseek.com/anthropic/v1/messages` |
| 附件上传 | `POST https://api.deepseek.com/anthropic/v1/files` |
| Key 校验 | `GET https://api.deepseek.com/models` |
| 语音听写 / 朗读 | `api/speech` 相关接口 |

> 想换成自己的中转站或本地部署：改 `rspack.config.ts` 里的 `apiOrigin` 后重新构建，
> 例如 `createConfig({ apiOrigin: 'https://your-gateway.example.com' })`。接入方需支持
> Anthropic 兼容的 Messages / Files API，以及 `deepseek_web_search`、`deepseek_read_url`、
> `latest_reminder` 这些扩展，联网搜索和读链接才会有结果。

## 相比官方 demo 的改动

1. **多模型切换**：设置 → 通用设置 → 对话模型，可在 `V4.1 Flash` 与 `V4-Pro` 之间切换，
   对之后发出的消息生效；每条回答都会记录自己用的模型。
2. **自定义系统提示词**：设置 → 通用设置 → 系统提示词。留空时回落到官方默认身份说明
   （`该助手为DeepSeek，由深度求索公司创造。`）。
3. **原生保存通道**：聊天记录导出的 ZIP 在安卓壳子里改为写入系统「下载」目录
   （WebView 不支持 `blob:` 下载）；浏览器里仍是普通下载。
4. **品牌鲸鱼**：新对话页加了官方鲸鱼 logo（`WhaleLogo.tsx`，官方 logo 路径的单色写法，
   颜色取 `--dsw-alias-brand-primary`）；安卓桌面图标换成「蓝底白鲸」——前景图由
   [tools/whale-icon.html](tools/whale-icon.html) 用无头浏览器渲染成 432px PNG
   （`res/drawable-xxxhdpi/ic_launcher_foreground.png`），比手写 Android 矢量路径更保险。
5. **动态模型列表**：设置 → 通用设置 → 对话模型右侧的刷新按钮会调 `GET /models`
   （不产生费用），把你这把 Key 真实可用的模型并进选择器，新发布的模型点一下就能选到。
   官方返回的 `name` 直接作为展示名；内置的 `deepseek-flash` / `deepseek-v4-pro`
   仍用本地文案。列表存在 localStorage，刷新失败不会丢掉已有选项。
   注意：`/models` 返回的是「能调用的模型 id」，比网页上说的「最新模型」更准——
   官方新模型上线后接口里出现就能刷出来。
6. **侧边栏升级**：加了搜索框（标题 + 正文都能搜，正文命中显示上下文片段）、
   置顶分组（会话菜单里置顶/取消置顶，独立分组可折叠）、多选模式
   （标题栏「选择对话」+ 已选数量，列表项圆形勾选；底部「置顶 / 取消置顶、导出、删除」，
   每个操作都有确认弹窗）。会话标题永远显示在官方名 `DeepSeek` 下，
   不再是 "API 使用 demo"。
7. **界面语言四选一**：简体中文 / 繁體中文 / 日本語 / English。
   首次打开按浏览器语言自动选（`zh-Hant/zh-HK` → 繁中，`ja` → 日文），之后跟随设置。
   切换语言同时改 `<html lang>`（CJK 字形依赖它，日文和繁中才不会串成简体字形）。
8. **字体大小**：设置里四档（小 / 标准 / 大 / 特大，0.9 / 1 / 1.15 / 1.3）。
   用根元素 `zoom` 缩放整个界面（含弹窗），不是只放大正文字号；
   四档实测都无横向溢出、输入框始终在视口内。

   踩坑记录：`zoom` 不改变 `vh` / `innerHeight` 这类**物理像素**的读数，而手机上
   `.frame` 是 `position: fixed` + `height: var(--app-viewport-height, 100dvh)`，
   直接套用会被 zoom 再乘一次，底部侧边栏的「设置」被挤出屏幕、点不到。
   现在 `preferences.ts` 会同时写一个 `--ds-zoom`，所有用视口单位算尺寸的地方都写成
   `calc(... / var(--ds-zoom, 1))` 折回来。手机视口（390×844）下四档均实测：
   「设置」在屏幕内且 `elementFromPoint` 能命中；真机（zoom 1.3）也复验过。
9. **自动朗读**：顶栏喇叭按钮（手机端在「+」左边，桌面端在会话标题右侧）+
   设置里的同一开关。开启后每条回答生成完自动朗读，关闭立即停止朗读。
   只在「本次刚生成完、且用户还停在这个会话」时触发，翻历史或切会话不会误读。
10. **被上游中断时不再删内容**（2.1）：服务端用 `stop_reason: refusal` 收尾时，
   原来会把已经流到屏幕上的思考与正文整块丢弃，只留一句固定答复；
   现在这些内容照常留在原地，另加一条「服务端在这里中断了这次生成」的提示，
   重新生成也不再被禁用。拒绝轮次依然**不回传上下文**（`isUsableReply`），
   导入/导出同步保留正文，不再重复追加模板。
11. **联网工具需要 high 档扩展模式**：`deepseek_web_search` / `deepseek_read_url`
   依赖请求里的 `safety_check: { level: 'high' }`（官方网页端同款）。现在默认就发
   high 档（`store.ts` 里的 `SAFETY_CHECK = { level: 'high' }`），联网搜索和读链接因此可用；
   代价是内容审核档位更高。想要严格审核优先、放弃联网工具，把常量改回 `null` 即可。
12. **导入大归档不再像卡死**（2.2）：导入历史对话时弹出「正在导入，请勿退出」遮罩，
    带进度条、`已处理 n / N 个条目` 和百分比；中央目录读完之前显示「正在读取归档…」，
    导入期间设置弹窗不可关闭。

    性能上改了三处：ZIP 中央目录一次读入（原来是逐条目读，1624 个条目≈5000 次
    `file.slice()`；安卓 WebView 的 `content://` 底层每次切片都要过一遍 ContentResolver，
    逐条读会把「读取归档」拖成十几分钟）、本地文件头改成单窗口读、图片攒批写 IndexedDB。

    实测同一份 660 MB 归档（1012 个会话、609 张图、1624 个条目）：安卓模拟器从
    「11 分钟以上没有任何进度」变成全程有进度；桌面端 76.8 秒 → 51.8 秒。
13. **白屏兜底**（2.2）：整个应用外面套了 ErrorBoundary。渲染期一旦抛异常，
    不再只剩一片白，而是显示「页面出现异常」+ 可折叠的错误堆栈 + 重新加载按钮，
    本地数据不动。

> ⚠️ 已知限制：官方 API 文档写明联网搜索 / 读链接 / 文档图片解析这套工具能力目前只在
> `deepseek-flash`（V4.1-Flash）上提供，`V4-Pro` 尚未支持。所以切到 V4-Pro 时，
> 把「智能搜索」也打开可能拿不到搜索结果或直接报错。需要联网搜索时用 Flash。


## 安卓 APK

**要装的文件：到 [Releases](../../releases/latest) 下载最新的 `DeepSeek-CE-x.y.z.apk`**。
直接覆盖安装，数据不会丢。

应用名是 **DeepSeek CE**（CE = Community Edition，非官方社区版）；包名保持 `com.linyan.deepseek`
不变，所以能直接覆盖升级，不会变成两个 App。

装完核对版本：长按桌面图标 → 应用信息 → 版本号，或安装时系统弹窗里显示的版本。

每次有新改动，`android/app/build.gradle.kts` 里的 `versionCode` / `versionName` 会一起往上加，
根目录的 APK 文件名也跟着改，避免分不清装的是哪一版。

```powershell
. E:\AndroidDev\env.ps1          # ANDROID_HOME / GRADLE_USER_HOME / JAVA_HOME
cd android
.\gradlew.bat assembleRelease    # 产物：app/build/outputs/apk/release/app-release.apk
adb install -r app\build\outputs\apk\release\app-release.apk
```

改了网页之后要先把新产物同步进 assets，再重新打包：

```powershell
cd chat-demo; pnpm build
robocopy chat-demo\dist android\app\src\main\assets\www /MIR
```

壳子做的事：`https://appassets.androidplatform.net/` 安全来源提供本地页面（`file://` 下录音、
IndexedDB 会被限制）、转发 `<input type="file">` 选择器、授权麦克风、站外链接交给系统浏览器、
物理返回键、导出文件落盘。

### 附件按来源选：拍照 / 相册 / 文件

点输入框旁的回形针不再直接跳文件管理器，而是先弹一个底部面板：

| 选项 | 走什么 |
| --- | --- |
| 拍照 | `ACTION_IMAGE_CAPTURE` + FileProvider（照片先落 `cacheDir/capture/`，不用相机权限） |
| 相册 | Android 13+ 用系统相册选择器 `ACTION_PICK_IMAGES`，低版本用 `ACTION_GET_CONTENT`(image/*) |
| 文件 | `ACTION_OPEN_DOCUMENT`，按网页给的 accept 过滤 |

网页侧一行代码都没改：面板选完照样把 Uri 交给原来的 `<input type="file">`，
附件上传、图片理解、拖拽预览全部沿用原逻辑。

只有「接收图片」的输入才会弹面板——设置里导入聊天记录那种只收 ZIP 的输入会直接走文件选择器
（判断依据是 accept 里有没有图片扩展名）。


### 顶部那条「黑边」是怎么消掉的

不是网页适配问题。全面屏手机的挖孔/刘海区默认不参与应用布局，系统会把窗口整体下移，
再把那条区域涂成状态栏颜色（AppCompat 默认取 `colorPrimaryDark`，所以是一条深灰）。

现在做法：

1. 主题里 `android:windowLayoutInDisplayCutoutMode=shortEdges`，让窗口铺进挖孔区；
2. 状态栏 / 导航栏设为透明，窗口底色跟着网页背景色走；
3. 网页 `theme.ts` 每次切换主题都会把实际的背景色通过 `AndroidBridge.setSystemBarColor()`
   推给原生，原生据此改窗口底色并按明暗切换状态栏图标颜色。

所以浅色、深色、跟随系统三种情况下，顶部都不会再出现一条异色边。
键盘仍走清单里的 `adjustResize`（不要改成给 WebView 加内边距，那样网页视口不缩，
输入框会被键盘盖住）。


`minSdk 29`（Android 10+），`targetSdk 34`，包名 `com.linyan.deepseek`，用 debug 证书签名
（自己用够了；要上架换成自己的 keystore）。

## 功能清单

- 多会话、自动起标题、重命名、删除；编辑提问、重新生成、切换回答分支
- 流式输出、深度思考、智能搜索、链接阅读与来源引用、停止与续写
- 多选会话：置顶/取消置顶、导出选中会话、批量删除（均带确认）
- 附件上传（含拖拽、粘贴）、图片理解、文档版面解析
- 语音输入（实时频谱）与回复朗读（海星 / 暗潮两档音色）
- Markdown、代码高亮与复制、KaTeX 公式、Mermaid 图表
- 简体中文 / 繁體中文 / 日本語 / English、浅色 / 深色 / 跟随系统、移动端布局
- 位置与时间上下文、历史记录 ZIP 导入导出（导入可取消、导出有进度和终止）、
  导出目录可选并支持恢复默认、一键清空
- 实验性：自定义联网模型（当前模型不支持工具时用指定模型检索）、标题生成二选一
  （官方新接口 / 回退额外请求）、手动压缩上下文与压缩进度提示

## 验证脚本

```powershell
# 无头 Edge + CDP，验证设置界面与发送链路
node tools/verify-web.mjs
# 抓真实请求体，确认 model / system 字段
node tools/verify-request.mjs
```

## 许可

网页部分沿用官方 MIT 许可，构建产物里的 `LICENSE` 请一并保留。第三方依赖遵循各自许可。
