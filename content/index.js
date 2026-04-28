// ==========================================
// FavGallery - Content Script 入口
// 职责：动态注入 main.js 到页面
// ==========================================

(function() {
    'use strict';

    console.log('[FavGallery] ✅ Index script loaded');

    // 等待 DOM 就绪
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    function init() {
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

        // 添加到页面
        document.head.appendChild(script);

        console.log('[FavGallery] ✅ Module script injected');
    }
})();

