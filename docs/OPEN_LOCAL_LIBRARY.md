# FavGallery「打开本地库」功能设计文档（B+ 自动捕获）

> **定位**：本文档描述侧边栏「📂 打开本地库」按钮——一键打开用户文件夹中的离线浏览页 `FavGallery.html` 的完整机制。
>
> **状态**：✅ 已实现（v1.1，2026-09-26：B+ 一键打开落地后，移除了引导卡内已无用的「复制文件名」按钮及剪贴板兜底）
>
> **关联文档**：入口页本体见 [OFFLINE_COLLECTION_VIEWER.md](./OFFLINE_COLLECTION_VIEWER.md)

---

## 一、问题背景：为什么"直接打开"很难

三个硬约束叠加（均为浏览器/Chrome 设计限制，非本项目代码缺陷）：

1. **拿不到绝对路径**：选文件夹走 File System Access API（`showDirectoryPicker`），`FileSystemDirectoryHandle` 只暴露 `handle.name`（末级文件夹名），**永远不给** `F:\...\folder` 这样的绝对路径（隐私设计）。
2. **离线页强依赖 `file://` 目录语义**：`FavGallery.html` 的 CSS/JS、数据分片（`loadScript` 相对路径）、媒体（`img/video.src` 相对路径）全部按**相对路径**引用，只有页面地址是 `file:///绝对目录/` 才能解析。用 `blob:`/`data:` URL 打开没有目录 base，全部资源解析失败 → 白屏；"自包含单文件内联"对海量懒加载媒体不成立。
3. **Chrome 118+ 打开 `file://` 需手动授权**：扩展用 `chrome.tabs.create` 导航到 `file://` 必须用户在 `chrome://extensions` 详情页手动开启**「允许访问文件网址」**；可用 `chrome.extension.isAllowedFileSchemeAccess()` 检测。`manifest` 里写 `file:///*` host 权限**不能**替代该手动开关。

> 结论：**"能通过 handle 读文件" ≠ "能在浏览器里打开文件"**。能写的（FS Access）不给路径；知道路径的前提（file:// 有目录 base）恰恰需要我们已拥有路径。

## 二、B+ 核心洞察：从已打开的标签页反查绝对路径

用户一旦手动双击打开离线页，它就是浏览器里的一个标签页，其 `tab.url` 天然就是 `file:///绝对目录/FavGallery.html`——**绝对路径不需要用户提供，扩展可以反查**。

官方依据（chrome.tabs 文档）：

> *"File URLs may be captured only if the extension has been granted file access."*

即读取 `file://` 标签页 URL 需两个条件：**`tabs` 权限 + 「允许访问文件网址」**（本项目均已满足/引导）。

不可用的替代通信途径（曾逐一评估否决）：file:// 页面不会注入我们的 content script；`externally_connectable` 不支持 `file://`；file:// 页与扩展不同源、无共享存储。唯一合法通道就是扩展侧主动反查 `tabs.query` / `tabs.onUpdated`。

## 三、实现

| 文件 | 职责 |
|------|------|
| `manifest.json` | `permissions` 增加 `"tabs"` |
| `background.js` | **捕获**：`tabs.onUpdated` 命中 `file:///…/FavGallery.html` 即写 `chrome.storage.local['offlineLibraryFileUrl']`；`onInstalled`/`onStartup` 用 `tabs.query({})` 扫描已开标签兜底。**消息**：`OPEN_OFFLINE_LIBRARY`（① 有已开标签 → `tabs.update` 聚焦 + 窗口前置；② 有缓存 URL 且已授权 → `tabs.create` 打开；③ 都没有 → 回 `{ok:false, reason:'no-path'\|'need-file-access'}`）；`PROBE_OFFLINE_LIBRARY`（回 `{hasPath,url,fileAccess}`，供侧边栏提前启用按钮）。入口文件名因 classic SW 无法 import 而**硬编码常量**，注释标注与 `CONFIG.FILE_SYSTEM.OFFLINE_ENTRY_HTML` 保持同步 |
| `core/event-binder.js` | `bindOpenLibrary()`：点击**先请求一键打开/聚焦**，打不开才 `_showLibraryGuide()` 展开引导卡（区分"种子缺失"与"未开文件授权"两套文案）；`_probeLibrary()` 绑定时探测已记住路径则提前启用按钮并改 title；`_requestOpenLibrary()` 经 `chrome.runtime.sendMessage` 与 background 通信 |
| `ui/ui-state-manager.js` | `enableButtons()` 选择文件夹成功后启用 `#openLibrary` |
| `ui/html/sidebar.html` | `#openLibrary` 按钮（默认 disabled）+ `#openLibraryHint` 引导卡容器 |

> 侧边栏 iframe 是扩展页（`chrome-extension://` 源），可用 `chrome.runtime.sendMessage`；`tabs`/`storage` 逻辑全部收敛在常驻 SW，侧边栏不直接碰 `chrome.tabs`。

## 四、使用流程（两个前置，均一次性）

1. `chrome://extensions` → FavGallery「详情」→ 开启**「允许访问文件网址」**。
2. **首次双击打开一次** `FavGallery.html`（"种子"动作，浏览离线库本来就要做）→ 后台静默捕获并永久记住路径。

之后点「打开本地库」即**一键直达**：离线页开着 → 聚焦该标签；已关闭 → 用记住的路径新标签打开。全程零打字、零记忆路径。

- 未捕获到路径 / 未开授权时，按钮展开引导卡（入口文件名 + 文件夹名 + 双击说明），并对"有路径但被拦"给出开启授权的定向提示。
- **生效方式**：本功能全部是扩展侧文件，改动只需在 `chrome://extensions` **重载扩展**，不涉及离线壳重生成、无 `file://` 缓存问题。

## 五、剪贴板兼容经验（备用）

> 引导卡内曾有过「复制文件名」按钮，因 B+ 下已无实际用途于 v1.1 移除（连带删除 `_copyTextCompat`）。保留以下坑点结论供未来侧边栏如需复制功能时直接采用：侧边栏以跨域 iframe 嵌入抖音页面，父页未委派 `clipboard-write` 时 `navigator.clipboard.writeText` 被 Permissions-Policy 拦截（控制台报 `[Violation] ... crbug.com/414348233`）。可行方案：隐藏 `readonly textarea` + `select()` + `document.execCommand('copy')` 在**用户手势同步调用栈**内复制（不受 Clipboard API 权限策略限制）；再失败则提示用户手动选中按 Ctrl+C。

## 六、已否决方案及理由

| 方案 | 否决理由 |
|------|---------|
| 直接开 `file://`（不知路径） | 拿不到绝对路径（见一） |
| `handle.getFile()` 转 `blob:` URL 打开 | blob 无目录 base，相对资源/数据/媒体全失效白屏 |
| 自包含单文件内联后打开 | 媒体海量且懒加载，无法内联 |
| 写死盘符 C:~L: + 级联选目录 | 扩展无法枚举盘符与任意目录树（无 `listDrives`/路径式 readdir）；"逐级输入子目录名"本质＝手敲完整路径，比粘贴更累。浏览器把所有磁盘浏览能力关在"用户手动选目录"之后，而该动作恰恰不给绝对路径 |
| 扩展在指定盘符自建目录写文件 | 纯扩展没有"按路径字符串建目录+写文件"的 API（FS Access 只认 picker 给的 handle）；能做到的是 Native Messaging，但 NM 需**独立安装注册**，已排除 |
| 用户粘贴一次完整路径（方案 B） | 可行（也要开文件授权），但需用户理解/找到路径；B+ 的"打开一次"种子更自然且零打字，故采纳 B+ |
| 扩展内置查看器用 handle 渲染（方案 C） | 技术成立（handle 可 postMessage 跨上下文、媒体 `createObjectURL`），但需重构离线页取数/媒体层，工程量最大，暂不做 |

## 七、已知限制

- 未开「允许访问文件网址」时：捕获与打开均不可用（引导卡有定向红字提示）。
- 种子缺失（从没双击打开过离线页）时：仍需先手动打开一次，无法凭空获得路径——这是浏览器安全边界，任何纯扩展方案都绕不开。
- 重命名入口文件需**三处同步**：`config/constants.js` 的 `OFFLINE_ENTRY_HTML`、`background.js` 的硬编码常量、本文档。
- `offlineLibraryFileUrl` 存于 `chrome.storage.local`，清除扩展存储后需重新打开一次离线页再捕获。

---

**维护者**：FavGallery 开发团队
