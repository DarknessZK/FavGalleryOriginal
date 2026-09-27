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
        window.addEventListener('message', async (event) => {
            if (!event.data || event.data.source !== 'content') return;

            // ✅ 忽略 DatabaseProxy 的内部响应消息
            if (event.data.type && event.data.type.startsWith('DB_RESPONSE_')) {
                return;
            }

            // ✅ 高频消息不输出“收到消息”日志，防止日志洪泛
            const silentTypes = ['BATCH_DOWNLOAD_PROGRESS', 'AUTHOR_WORK_PROGRESS', 'LIKED_WORKS_PROGRESS', 'FOLLOWING_AUTHORS_PROGRESS', 'COLLECT_WORKS_PROGRESS', 'UI_LOG'];
            if (!silentTypes.includes(event.data.type)) {
                logger.info('📨 收到消息:', event.data.type);
            }

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
                // 发送源有两套字段名：main.js 批量循环发 current/total（带 collectName），
                // data-fetcher._loadList 通用进度发 currentCount/totalCount（只带 collectId，消费端反查名称），
                // 两者均兼容
                case 'COLLECT_WORKS_PROGRESS':
                    this.app.handleCollectWorksProgress(
                        event.data.collectName,
                        event.data.current ?? event.data.currentCount,
                        event.data.total ?? event.data.totalCount,
                        event.data.collectId
                    );
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
                    // ✅ Content 侧转发的 error 级日志同步弹错误边界红条
                    if (event.data.level === 'error') {
                        this.app._showErrorBanner(event.data.message);
                    }
                    break;

                // ✅ 配置面板：加载结果回填 / 保存结果
                case 'USER_CONFIG_LOADED':
                    this.app.configPanel.handleLoaded(event.data);
                    break;

                case 'SAVE_USER_CONFIG_RESULT':
                    this.app.configPanel.handleSaveResult(event.data);
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
                    logger.info(`[MessageHandler] 收到 BATCH_DOWNLOAD_COMPLETE: batchId=${event.data.batchId}, stopped=${event.data.stopped}`);
                    await this.app.handleBatchDownloadComplete(event.data);
                    break;
                
                case 'BATCH_DOWNLOAD_ERROR':
                    await this.app.handleBatchDownloadError(event.data);
                    break;
                
                // ✅ 作者下载状态查询响应
                case 'AUTHOR_STATUS_RESPONSE':
                    // 由 AuthorDownloadManager 处理，这里不处理
                    break;

                // ✅ 作者下载状态批量响应（实时计算校正「已存 x/y」，含钻取/单卡保存的下载）
                case 'AUTHORS_STATUS_BATCH_RESPONSE':
                    if (this.app.authorDownloadManager) {
                        this.app.authorDownloadManager.applyAuthorStatuses(event.data.statuses);
                    }
                    break;
                
                // ✅ 作者作品钻取（API 实时拉取，按 uid 匹配当前目标，过期消息由视图内部丢弃）
                case 'AUTHOR_WORKS_PROGRESS':
                    this.app.authorWorksView.handleProgress(event.data);
                    break;

                case 'AUTHOR_WORKS_LOADED':
                    this.app.authorWorksView.handleLoaded(event.data);
                    break;

                case 'AUTHOR_WORKS_ERROR':
                    this.app.authorWorksView.handleError(event.data);
                    break;

                // ✅ 作者作品总数通知
                case 'AUTHOR_WORKS_COUNT':
                    if (this.app.authorDownloadManager) {
                        await this.app.authorDownloadManager.handleAuthorWorksCount(
                            event.data.uid,
                            event.data.count,
                            event.data.skippedCount || 0
                        );
                    }
                    break;
                
                // ✅ 作者作品下载进度
                case 'AUTHOR_WORK_PROGRESS':
                    if (this.app.authorDownloadManager) {
                        await this.app.authorDownloadManager.workCompleted(
                            event.data.uid,
                            event.data.success
                        );
                    }
                    break;

                default:
                    logger.warn('⚠️ 未知消息类型:', event.data.type);
            }
        });

        logger.info('✅ 消息监听器已设置');
    }
}

export { MessageHandler };
