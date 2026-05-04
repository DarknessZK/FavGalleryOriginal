// ==========================================
// FavGallery - 数据库代理（Sidebar 端）
// 职责：通过消息通信访问 Content Script 的数据库
// ==========================================

import { createLogger } from '../../utils/logger.js';

const logger = createLogger('DatabaseProxy');

class DatabaseProxy {
    constructor() {
        // Sidebar 运行在 iframe 中，parent 是 Content Script 的 window
        this.targetWindow = window.parent;
        this.messageId = 0;
        this.pendingRequests = new Map();
        
        // 监听来自 Content Script 的响应
        window.addEventListener('message', (event) => {
            if (!event.data || event.data.source !== 'content') return;
            
            // 处理数据库响应
            if (event.data.type && event.data.type.startsWith('DB_RESPONSE_')) {
                this.handleResponse(event.data);
            }
        });
        
        logger.info('✅ DatabaseProxy 已初始化');
    }

    /**
     * 获取已下载的作品 ID 列表
     * @returns {Promise<Array<string>>} 作品 ID 列表
     */
    async getDownloadedWorkIds() {
        return this.sendRequest('GET_DOWNLOADED_WORK_IDS');
    }

    /**
     * 发送请求到 Content Script
     * @param {string} requestType - 请求类型
     * @param {Object} data - 请求数据
     * @returns {Promise<any>} 响应数据
     * @private
     */
    sendRequest(requestType, data = {}) {
        return new Promise((resolve, reject) => {
            const messageId = ++this.messageId;
            
            // 设置超时（5 秒）
            const timeoutId = setTimeout(() => {
                this.pendingRequests.delete(messageId);
                logger.error(`❌ 请求超时: ${requestType}`);
                reject(new Error(`请求超时: ${requestType}`));
            }, 5000);
            
            // 保存 pending 请求
            this.pendingRequests.set(messageId, {
                resolve,
                reject,
                timeoutId
            });
            
            // 发送消息
            logger.info(`📤 发送请求: ${requestType} (ID: ${messageId})`);
            this.targetWindow.postMessage({
                source: 'sidebar',
                type: requestType,
                messageId,
                data
            }, '*');
        });
    }

    /**
     * 处理来自 Content Script 的响应
     * @param {Object} responseData - 响应数据
     * @private
     */
    handleResponse(responseData) {
        const { messageId, success, data, error } = responseData;
        
        const pending = this.pendingRequests.get(messageId);
        if (!pending) {
            logger.warn(`⚠️ 未找到对应的请求: ${messageId}`);
            return;
        }
        
        // 清除超时
        clearTimeout(pending.timeoutId);
        this.pendingRequests.delete(messageId);
        
        if (success) {
            logger.info(`📥 收到响应: ${messageId}, 数据长度: ${Array.isArray(data) ? data.length : 'N/A'}`);
            pending.resolve(data);
        } else {
            logger.error(`❌ 请求失败: ${messageId}`, error);
            pending.reject(new Error(error || '未知错误'));
        }
    }
}

// 导出单例
export const databaseProxy = new DatabaseProxy();
export default databaseProxy;
