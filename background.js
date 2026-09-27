// ==========================================
// FavGallery - Background Service Worker
// 职责：后台常驻任务；实现「打开本地库」B+ 方案——
//      静默捕获离线页（FavGallery.html）的 file:// 绝对路径，
//      并在侧边栏请求时一键「聚焦已开标签 / 新建标签打开」。
//
// 原理：File System Access API 只给文件夹名、拿不到绝对路径；但用户一旦
//      手动双击打开离线页，它就是浏览器里一个 file:// 标签页，其 tab.url
//      天然含绝对路径。扩展用 tabs 权限 + 「允许访问文件网址」反查 tab.url
//      即可自动获知路径，无需用户手输。之后即可用 chrome.tabs.create 打开。
// ==========================================

console.log('[Background] Service Worker 已启动');

// 离线页入口文件名（与 config/constants.js 的 CONFIG.FILE_SYSTEM.OFFLINE_ENTRY_HTML 保持一致；
// background 为 classic service worker，无法 import 模块，故此处以常量硬编码）
const OFFLINE_ENTRY_HTML = 'FavGallery.html';
// 存储键：已捕获的离线页 file:// 绝对 URL
const OFFLINE_URL_KEY = 'offlineLibraryFileUrl';

/**
 * 判断某 URL 是否为离线页入口（file:// 且以 /FavGallery.html 结尾）
 * @param {string} url
 * @returns {boolean}
 */
function isOfflineEntryUrl(url) {
    return typeof url === 'string'
        && url.startsWith('file://')
        && url.endsWith('/' + OFFLINE_ENTRY_HTML);
}

/**
 * 查询扩展是否已获得「允许访问文件网址」授权
 * @returns {Promise<boolean>}
 */
function getFileSchemeAccess() {
    return new Promise((resolve) => {
        try {
            chrome.extension.isAllowedFileSchemeAccess((allowed) => {
                resolve(!!allowed);
            });
        } catch (err) {
            console.warn('[Background] ⚠️ 查询文件访问授权失败:', err && err.message);
            resolve(false);
        }
    });
}

/**
 * 在所有标签页里查找离线页入口标签（读 file:// url 需 tabs 权限 + 文件授权）
 * @returns {Promise<chrome.tabs.Tab|null>}
 */
async function findOfflineTab() {
    const tabs = await chrome.tabs.query({});
    return tabs.find((t) => isOfflineEntryUrl(t.url)) || null;
}

/**
 * 扫描已打开标签页，若发现离线页入口则持久化其绝对路径
 * @returns {Promise<string|null>} 捕获到的 URL
 */
async function captureOfflineUrl() {
    const tab = await findOfflineTab();
    if (tab && tab.url) {
        await chrome.storage.local.set({ [OFFLINE_URL_KEY]: tab.url });
        console.log('[Background] 📍 已捕获离线页路径:', tab.url);
        return tab.url;
    }
    return null;
}

// ==========================================
// 静默捕获：只要离线页被打开（本次会话或此前），就记住它的绝对路径
// ==========================================

// 标签页地址/加载状态变化时命中入口即捕获
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    const url = changeInfo.url || tab.url;
    if (isOfflineEntryUrl(url)) {
        chrome.storage.local.set({ [OFFLINE_URL_KEY]: url });
        console.log('[Background] 📍 onUpdated 捕获离线页路径:', url);
    }
});

// 安装 / 浏览器启动时，扫描一次当前已打开的标签页做兜底捕获
chrome.runtime.onInstalled.addListener(() => { captureOfflineUrl(); });
chrome.runtime.onStartup.addListener(() => { captureOfflineUrl(); });

// ==========================================
// 消息处理：打开 / 探测离线库
// ==========================================

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    const type = message && message.type;

    if (type === 'OPEN_OFFLINE_LIBRARY') {
        handleOpenOfflineLibrary()
            .then(sendResponse)
            .catch((err) => sendResponse({ ok: false, reason: 'error', message: String(err) }));
        return true; // 异步响应
    }

    if (type === 'PROBE_OFFLINE_LIBRARY') {
        handleProbeOfflineLibrary()
            .then(sendResponse)
            .catch((err) => sendResponse({ ok: false, message: String(err) }));
        return true;
    }

    // 其它消息：默认转发成功（保持既有行为）
    sendResponse({ success: true });
    return true;
});

/**
 * 打开或聚焦离线页
 * @returns {Promise<object>} { ok, action } 或 { ok:false, reason }
 */
async function handleOpenOfflineLibrary() {
    // 1) 已有打开的离线页标签 → 直接聚焦（不依赖新建，最稳）
    const existing = await findOfflineTab();
    if (existing) {
        await chrome.tabs.update(existing.id, { active: true });
        if (existing.windowId != null) {
            try { await chrome.windows.update(existing.windowId, { focused: true }); } catch (e) { /* 忽略 */ }
        }
        return { ok: true, action: 'focused', url: existing.url };
    }

    // 2) 无已开标签 → 用记住的路径新建标签打开（开 file:// 需「允许访问文件网址」）
    const stored = await chrome.storage.local.get(OFFLINE_URL_KEY);
    const url = stored && stored[OFFLINE_URL_KEY];
    const fileAccess = await getFileSchemeAccess();

    if (url) {
        if (!fileAccess) {
            // 有路径但未授权：开 file:// 会被浏览器拦截 → 回「需授权」引导
            return { ok: false, reason: 'need-file-access', url };
        }
        await chrome.tabs.create({ url });
        return { ok: true, action: 'created', url };
    }

    // 3) 连路径都没有：从没成功打开过离线页（种子缺失）→ 回手动引导
    return { ok: false, reason: 'no-path', fileAccess };
}

/**
 * 探测当前状态（不打开），供侧边栏提前启用按钮 / 文案使用
 * @returns {Promise<object>}
 */
async function handleProbeOfflineLibrary() {
    const stored = await chrome.storage.local.get(OFFLINE_URL_KEY);
    const url = stored && stored[OFFLINE_URL_KEY];
    const fileAccess = await getFileSchemeAccess();
    return { ok: true, hasPath: !!url, url: url || null, fileAccess };
}

console.log('[Background] ✅ 监听器已设置（含离线页路径捕获）');

// ==========================================
// ✅ 错误边界（轻量）：仅 console 记录，不做恢复
// background 为 classic service worker，无法 import error-boundary 模块
// ==========================================
self.addEventListener('error', (event) => {
    console.error('[Background] ❌ 未捕获错误:', event.error || event.message);
});
self.addEventListener('unhandledrejection', (event) => {
    console.error('[Background] ❌ 未处理 Promise rejection:', event.reason);
});
