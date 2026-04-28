// ==========================================
// FavGallery - Background Service Worker
// 职责：处理后台任务（消息转发等）
// ==========================================

console.log('[Background] Service Worker 已启动');

// ==========================================
// 消息监听器 - 仅负责转发消息
// ==========================================
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log('[Background] 📨 收到消息:', message.type);

    // 根据消息类型转发到相应的处理器
    // 目前主要是 Content Script 和 Sidebar 之间的通信
    
    // 默认返回成功
    sendResponse({ success: true });
    
    // 返回 true 表示异步响应
    return true;
});

console.log('[Background] ✅ 消息监听器已设置');
