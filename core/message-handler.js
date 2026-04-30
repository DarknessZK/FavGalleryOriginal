// ==========================================
// FavGallery - 消息处理器
// 职责：处理来自 Content Script 的所有消息（用户信息、文件夹选择、列表加载等）
// ==========================================
import { createLogger, logToUI } from '../utils/logger.js';

const logger = createLogger('MessageHandler');

class MessageHandler {
    constructor(app) {
        this.app = app;
    }

    /**
     * 设置消息监听器
     */
    setup() {
        window.addEventListener('message', (event) => {
            if (!event.data || event.data.source !== 'content') return;

            // ✅ 忽略 DatabaseProxy 的内部响应消息
            if (event.data.type && event.data.type.startsWith('DB_RESPONSE_')) {
                return;
            }

            logger.info('📨 收到消息:', event.data.type);

            switch (event.data.type) {
                case 'USER_INFO':
                    this.app.handleUserInfo(event.data.data);
                    break;

                case 'FOLDER_SELECTED':
                    this.app.handleFolderSelected(event.data);
                    break;

                case 'LIKED_WORKS_LOADED':
                    this.app.handleLikedWorksLoaded(event.data.works, event.data.total);
                    break;

                case 'LIKED_WORKS_PROGRESS':
                    this.app.handleLikedWorksProgress(event.data.currentCount, event.data.totalCount);
                    break;

                case 'LIKED_WORKS_ERROR':
                    this.app.handleLikedWorksError(event.data.error);
                    break;

                case 'CLEAR_LIKED_LIST':
                    this.app.clearLikedList();
                    break;

                case 'LOAD_DATA_START':
                    this.app.handleLoadDataStart(event.data.listType);
                    break;

                // ✅ 下载结果消息
                case 'DOWNLOAD_SUCCESS':
                    this.app.handleDownloadSuccess(event.data);
                    break;

                case 'DOWNLOAD_FAILED':
                    this.app.handleDownloadFailed(event.data);
                    break;
                
                // ✅ 批量下载结果消息
                case 'BATCH_DOWNLOAD_ITEM_START':  // ✅ 新增：单个作品开始下载
                    this.app.handleBatchDownloadItemStart(event.data);
                    break;
                
                // ✅ UI 日志消息
                case 'UI_LOG':
                    logToUI(event.data.level, event.data.message);
                    break;
                
                case 'BATCH_DOWNLOAD_PROGRESS':
                    if (this.app.currentBatchListType) {
                        this.app.updateBatchDownloadProgress(
                            event.data.progress,
                            event.data.progress.total,
                            this.app.currentBatchListType
                        );
                    }
                    break;
                
                case 'BATCH_DOWNLOAD_COMPLETE':
                    this.app.handleBatchDownloadComplete(event.data);
                    break;
                
                case 'BATCH_DOWNLOAD_ERROR':
                    this.app.handleBatchDownloadError(event.data);
                    break;

                default:
                    logger.warn('⚠️ 未知消息类型:', event.data.type);
            }
        });

        logger.info('✅ 消息监听器已设置');
    }
}

export { MessageHandler };
