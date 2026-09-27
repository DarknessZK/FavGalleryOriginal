// ==========================================
// FavGallery - Content Script 入口
// 职责：动态注入 main.js 到页面
// ==========================================

(function() {
    'use strict';

    console.log('[FavGallery] ✅ Index script loaded');

    // ✅ 入口自身错误兜底（传统脚本无法 import error-boundary 模块）
    window.addEventListener('error', (event) => {
        console.error('[FavGallery] ❌ 注入层异常（引导：重载扩展后刷新页面）:', event.error || event.message);
    });
    window.addEventListener('unhandledrejection', (event) => {
        console.error('[FavGallery] ❌ 注入层未处理 Promise 异常（引导：重载扩展后刷新页面）:', event.reason);
    });

    // 等待 DOM 就绪
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    function init() {
        try {
            // 获取扩展信息
            const extensionId = chrome.runtime.id;
            const sidebarUrl = chrome.runtime.getURL('ui/html/sidebar.html');

            console.log('[FavGallery] Extension info:', { extensionId, sidebarUrl });

            // 创建 module 脚本标签
            const script = document.createElement('script');
            script.type = 'module';
            script.src = chrome.runtime.getURL('content/main.js') +
                '?ext_id=' + encodeURIComponent(extensionId) +
                '&sidebar=' + encodeURIComponent(sidebarUrl);
            script.id = 'favgallery-script-tag';

            // ✅ module 链加载失败（如 WAR 漏登记）→ 明确提示引导重载扩展
            script.onerror = () => {
                console.error('[FavGallery] ❌ 注入失败：main.js 模块链加载出错。请到 chrome://extensions 重新加载扩展后刷新本页面');
            };

            // 添加到页面
            document.head.appendChild(script);

            console.log('[FavGallery] ✅ Module script injected');
        } catch (err) {
            console.error('[FavGallery] ❌ 注入失败:', err, '。请到 chrome://extensions 重新加载扩展后刷新本页面');
        }
    }
})();

