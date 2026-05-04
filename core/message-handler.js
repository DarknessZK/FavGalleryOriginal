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

                // ✅ 恢复状态消息
                case 'RESTORE_STARTING':
                    this.app.handleRestoreStarting(event.data.message);
                    break;

                case 'RESTORE_PROGRESS':
                    this.app.handleRestoreProgress(event.data);
                    break;

                case 'RESTORE_COMPLETED':
                    this.app.handleRestoreCompleted(event.data);
                    break;

                case 'LIKED_WORKS_LOADED':
                    this.app.handleLikedWorksLoaded(event.data.works, event.data.total);
                    break;

                case 'LIKED_WORKS_PROGRESS':
                    this.app.handleLikedWorksProgress(event.data.currentCount, event.data.totalCount);
                    break;

                // ✅ 收藏列表进度消息
                case 'COLLECT_WORKS_PROGRESS':
                    this.app.handleCollectWorksProgress(event.data.currentCount, event.data.totalCount);
                    break;

                case 'LIKED_WORKS_ERROR':
                    this.app.handleLikedWorksError(event.data.error);
                    break;

                // ✅ 关注列表加载完成
                case 'FOLLOWING_AUTHORS_LOADED':
                    logger.info(`👥 收到关注列表: ${event.data.authors.length} 个作者`);
                    this.app.handleFollowingAuthorsLoaded(event.data.authors, event.data.total);
                    break;

                // ✅ 关注列表加载进度
                case 'FOLLOWING_AUTHORS_PROGRESS':
                    this.app.handleFollowingAuthorsProgress(event.data.currentCount, event.data.totalCount);
                    break;

                // ✅ 关注列表加载错误
                case 'FOLLOWING_AUTHORS_ERROR':
                    this.app.handleFollowingAuthorsError(event.data.error);
                    break;

                case 'CLEAR_LIKED_LIST':
                    this.app.clearLikedList();
                    break;
                
                // ✅ 清空收藏列表
                case 'CLEAR_BOOKMARKED_LIST':
                    this.app.clearBookmarkedList();
                    break;

                case 'LOAD_DATA_START':
                    this.app.handleLoadDataStart(event.data.listType);
                    break;

                // ✅ 收藏夹列表加载完成
                case 'COLLECTS_LIST_LOADED':
                    logger.info(`📋 收到收藏夹列表: ${event.data.collects.length} 个`);
                    
                    // ✅ UI 日志
                    logToUI('info', `✅ 已加载 ${event.data.collects.length} 个收藏夹`);
                    
                    this.app.initCollectsSelector(event.data.collects);
                    
                    // ✅ 恢复所有控制按钮
                    this.app.uiStateManager.enableAllControlButtons();
                    
                    // ✅ 恢复作品按钮
                    this.app.uiStateManager.enableAllWorkDownloadButtons();
                    break;
                
                // ✅ 收藏夹列表加载错误
                case 'COLLECTS_LIST_ERROR':
                    logger.error('❌ 收藏夹列表加载失败:', event.data.error);
                    logToUI('error', `❌ 加载收藏夹列表失败: ${event.data.error}`);
                    
                    // ✅ 恢复所有控制按钮
                    this.app.uiStateManager.enableAllControlButtons();
                    
                    // ✅ 恢复作品按钮
                    this.app.uiStateManager.enableAllWorkDownloadButtons();
                    break;
                
                // ✅ 收藏夹作品加载完成
                case 'COLLECT_WORKS_LOADED':
                    logger.info(`🎬 收到收藏夹作品: ${event.data.works.length} 个`);
                    this.app.handleCollectWorksLoaded(event.data.works, event.data.total);
                    break;
                
                // ✅ 收藏夹作品加载错误
                case 'COLLECT_WORKS_ERROR':
                    this.app.handleCollectWorksError(event.data.error);
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
                    // ✅ 从 downloadHandler 获取当前批量下载类型
                    const downloadState = this.app.downloadHandler.getDownloadState();
                    if (downloadState.currentBatchListType) {
                        this.app.updateBatchDownloadProgress(
                            event.data.progress,
                            event.data.progress.total,
                            downloadState.currentBatchListType
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
