// ==========================================
// FavGallery - 下载处理器
// 职责：处理所有下载相关的业务逻辑（单个下载、批量下载、状态管理、UI更新）
// ==========================================

import { createLogger, logToUI } from '../utils/logger.js';
import { CONFIG } from '../config/constants.js';

const logger = createLogger('DownloadHandler');

class DownloadHandler {
    constructor(app) {
        this.app = app;
        
        // 下载状态
        this.isDownloading = false;
        this.currentBatchId = null;
        this.currentBatchListType = null;
    }

    /**
     * ✅ 点赞列表批量下载（独立入口）
     * @param {Array} workIds - 作品ID数组
     */
    async handleLikedDownload(workIds) {
        if (!workIds || workIds.length === 0) {
            logger.warn('⚠️ 没有选择要下载的作品');
            return;
        }
        
        // 设置状态
        this.isDownloading = true;
        this.currentBatchId = Date.now().toString();
        this.currentBatchListType = 'liked';
        
        // 禁用按钮
        this.app.uiStateManager.disableAllControlButtons();
        this.app.uiStateManager.disableAllWorkDownloadButtons();
        
        // ✅ 启用停止下载按钮
        this.app.uiStateManager.enableStopDownloadButton();
        
        // 调用核心下载逻辑
        await this._executeBatchDownload(workIds, this.app.folderName, this.currentBatchId);
    }

    /**
     * ✅ 收藏列表批量下载（独立入口）
     * @param {Array} workIds - 作品ID数组
     */
    async handleBookmarkedDownload(workIds) {
        if (!workIds || workIds.length === 0) {
            logger.warn('⚠️ 没有选择要下载的作品');
            return;
        }
        
        // 设置状态
        this.isDownloading = true;
        this.currentBatchId = Date.now().toString();
        this.currentBatchListType = 'bookmarked';
        
        // 禁用按钮
        this.app.uiStateManager.disableAllControlButtons();
        this.app.uiStateManager.disableAllWorkDownloadButtons();
        
        // ✅ 启用停止下载按钮
        this.app.uiStateManager.enableStopDownloadButton();
        
        // 调用核心下载逻辑
        await this._executeBatchDownload(workIds, this.app.folderName, this.currentBatchId);
    }

    /**
     * ✅ 作者作品钻取视图批量下载（与点赞/收藏同规格，作品都是真实 workId，直接复用批量管线）
     * @param {Array} workIds - 作品ID数组
     */
    async handleAuthorWorksDownload(workIds) {
        if (!workIds || workIds.length === 0) {
            logger.warn('⚠️ 没有选择要下载的作品');
            return;
        }

        // 设置状态（currentBatchListType='authorWorks' → 进度/完成消息落到 authorWorksStatus，
        // 完成后自动清空 authorWorks 批量选择）
        this.isDownloading = true;
        this.currentBatchId = Date.now().toString();
        this.currentBatchListType = 'authorWorks';

        // 禁用按钮
        this.app.uiStateManager.disableAllControlButtons();
        this.app.uiStateManager.disableAllWorkDownloadButtons();

        // ✅ 启用停止下载按钮
        this.app.uiStateManager.enableStopDownloadButton();

        // 调用核心下载逻辑
        await this._executeBatchDownload(workIds, this.app.folderName, this.currentBatchId);
    }

    /**
     * ✅ 处理作者的批量下载（保存作者所有作品）
     * @param {Array} uids - 作者 UID 数组
     */
    async handleAuthorDownload(uids) {
        try {
            logger.info(`👤 开始下载 ${uids.length} 个作者的所有作品: ${uids.join(', ')}`);
        
            // 1. 检查是否已选择文件夹
            if (!this.app.folderSelected) {
                logger.error('❌ 请先选择文件夹');
                logToUI('error', '❌ 请先点击“选择文件夹”按钮');
                this._showStatusMessage('folderStatus', '❌ 请先点击“选择文件夹”按钮', '#ff4d4f');
                return;
            }
        
            // 2. 检查并发控制
            if (this.isDownloading) {
                logger.warn('⚠️ 已有下载任务在运行');
                logToUI('warning', '⚠️ 已有保存任务在运行，请等待完成或停止后再试');
                return;
            }
        
            // 3. 设置下载状态
            this.isDownloading = true;
            this.currentBatchId = `author_batch_${Date.now()}`;
            this.currentBatchListType = 'following';
        
            // 4. 禁用所有控制按钮
            this.app.uiStateManager.disableAllControlButtons();
            this.app.uiStateManager.disableAllWorkDownloadButtons();
        
            // 5. 启用停止下载按钮
            this.app.uiStateManager.enableStopDownloadButton();
        
            // 6. 依次处理每个作者
            for (let i = 0; i < uids.length; i++) {
                const uid = uids[i];
                        
                // ✅ UI 日志
                logToUI('info', `📥 开始保存第 ${i + 1}/${uids.length} 个作者: ${uid}`);
                this._showStatusMessage('followingStatus', `🚀 正在获取作者 ${i + 1}/${uids.length} 的作品...`, '#1890ff');
        
                // 7. 获取作者信息
                const author = this.app.followingManager.allAuthors.find(a => a.uid === uid);
                if (!author) {
                    logger.warn(`⚠️ 未找到作者: ${uid}，跳过`);
                    logToUI('warning', `⚠️ 未找到作者 ${uid}，跳过`);
                    continue;
                }
        
                // 8. 获取 platformId
                const platformId = author.platformId;
                        
                if (!platformId) {
                    logger.error(`❌ 作者 ${uid} 缺少 platformId，跳过`);
                    logToUI('error', `❌ 作者 ${author.nickname || uid} 数据不完整，跳过`);
                    continue;
                }
        
                // ✅ 9. 查找作者卡片中的下载按钮
                const authorCard = document.querySelector(`.author-item[data-uid="${uid}"]`);
                const downloadBtn = authorCard ? authorCard.querySelector('.download-btn') : null;
                    
                if (!downloadBtn) {
                    logger.warn(`⚠️ 未找到作者 ${uid} 的下载按钮，跳过`);
                    logToUI('warning', `⚠️ 未找到作者 ${author.nickname || uid} 的下载按钮，跳过`);
                    continue;
                }
        
                // ✅ 10. 调用 AuthorDownloadManager 初始化状态跟踪
                this.app.authorDownloadManager.startAuthorDownload(
                    author.uid,
                    platformId,
                    author.nickname,
                    downloadBtn  // ✅ 传递按钮DOM引用
                );
        
                // 11. 发送消息到 Content Script，请求获取作者作品并发起批量下载
                logger.info(`🚀 发送请求到 Content Script: 获取作者 ${author.nickname} (${uid}) 的所有作品`);
                window.parent.postMessage({
                    source: 'sidebar',
                    type: 'DOWNLOAD_AUTHOR_WORKS',
                    uid: author.uid,
                    platformId: platformId,
                    nickname: author.nickname,
                    folderPath: this.app.folderName,
                    batchId: `${this.currentBatchId}_${uid}`  // ✅ 每个作者使用独立的 batchId
                }, '*');
        
                // ✅ 如果不是最后一个作者，添加随机延迟（防封号）
                if (i < uids.length - 1) {
                    const minDelay = CONFIG.DOWNLOAD_CONFIG.group.minDelay;
                    const maxDelay = CONFIG.DOWNLOAD_CONFIG.group.maxDelay;
                    const delay = Math.floor(Math.random() * (maxDelay - minDelay)) + minDelay;
                    logger.info(`⏱️ 等待 ${delay}ms 后处理下一个作者（防封号机制）`);
                    logToUI('info', `⏱️ 等待 ${delay/1000} 秒后处理下一个作者...`);
                            
                    // ✅ 等待延迟期间，允许用户停止
                    await new Promise(resolve => setTimeout(resolve, delay));
                            
                    // ✅ 检查是否被停止
                    if (!this.isDownloading) {
                        logger.info('⏹️ 用户已停止下载');
                        logToUI('info', '⏹️ 已停止批量作者下载');
                        break;
                    }
                }
            }
        
            // ✅ 注意：下载结果将由 message-handler.js 统一处理
            // 调用 handleBatchDownloadComplete、handleBatchDownloadError 等
        
        } catch (error) {
            console.log('[DEBUG] handleAuthorDownload caught error:', error);
            console.trace('[DEBUG] error stack trace');
            logger.error(`❌ 作者下载异常: ${uids}`, error);
            logToUI('error', `❌ 保存作者作品失败: ${error.message}`);
                    
            // ✅ 异常时重置状态
            this.resetDownloadState();
        }
    }

    /**
     * 设置作品下载状态（UI 更新）
     * @param {string} workId - 作品ID
     * @param {string} status - 状态：'waiting' | 'downloading' | 'completed' | 'failed' | 'error'
     * @param {string} message - 消息（可选）
     */
    _setWorkDownloadStatus(workId, status, message = '') {
        const downloadBtn = document.querySelector(`.download-btn[data-work-id="${workId}"]`);
        if (!downloadBtn) return;

        switch (status) {
            case 'waiting':  // ✅ 等待中状态（批量下载时使用）
                downloadBtn.innerHTML = '<span style="display: block; text-align: center;">⏳ 等待中...</span>';
                downloadBtn.style.background = '#d9d9d9';  // 浅灰色
                downloadBtn.disabled = true;
                break;

            case 'downloading':
                // ✅ 清除所有子元素
                downloadBtn.innerHTML = '';

                // ✅ 确保按钮有 position: relative（防止进度条溢出）
                downloadBtn.style.position = 'relative';
                downloadBtn.style.overflow = 'hidden';

                // ✅ 创建进度条容器
                const progressBar = document.createElement('div');
                progressBar.className = 'progress-bar';
                progressBar.style.cssText = `
                    position: absolute;
                    top: 0;
                    left: 0;
                    width: 0%;
                    height: 100%;
                    background: linear-gradient(90deg, #52c41a, #73d13d);
                    transition: width 0.3s ease;
                    z-index: 0;
                `;
                downloadBtn.appendChild(progressBar);

                // ✅ 创建文字容器
                const textSpan = document.createElement('span');
                textSpan.className = 'btn-text';
                textSpan.textContent = '⏳ 保存中...';
                textSpan.style.cssText = `
                    position: relative;
                    z-index: 1;
                    color: white;
                    display: block;
                    text-align: center;
                `;
                downloadBtn.appendChild(textSpan);

                // ✅ 模拟进度增长：0% → 90%（分阶段）
                let currentProgress = 0;
                const simulateProgress = () => {
                    if (currentProgress < 90) {
                        // 前期快，后期慢
                        const increment = currentProgress < 50 ? 3 : 1.5;
                        currentProgress += increment;
                        if (currentProgress > 90) currentProgress = 90;

                        progressBar.style.width = currentProgress + '%';

                        // 继续增长
                        setTimeout(simulateProgress, 400);
                    }
                };

                // 启动模拟进度
                simulateProgress();

                downloadBtn.style.background = '#999';
                downloadBtn.disabled = true;
                break;

            case 'completed':
                downloadBtn.innerHTML = '<span style="display: block; text-align: center;">✅ 已保存</span>';
                downloadBtn.style.background = '#52c41a';
                downloadBtn.style.cursor = 'default';
                downloadBtn.disabled = true;

                // ✅ 禁用对应的复选框
                this._disableWorkCheckbox(workId);
                break;

            case 'failed':
                downloadBtn.innerHTML = '<span style="display: block; text-align: center;">❌ 重试</span>';
                downloadBtn.style.background = '#ff4d4f';
                downloadBtn.style.cursor = 'pointer';
                downloadBtn.disabled = false;
                downloadBtn.title = message;
                break;

            case 'error':
                downloadBtn.innerHTML = '<span style="display: block; text-align: center;">⚠️ 异常</span>';
                downloadBtn.style.background = '#ff7a45';
                downloadBtn.style.cursor = 'pointer';
                downloadBtn.disabled = false;
                downloadBtn.title = message;
                break;
        }
    }

    /**
     * 禁用作品对应的复选框（下载成功后调用）
     * @param {string} workId - 作品ID
     */
    _disableWorkCheckbox(workId) {
        const checkbox = document.querySelector(`.work-checkbox[data-work-id="${workId}"]`);
        if (checkbox) {
            checkbox.disabled = true;
            checkbox.style.opacity = '0.5';
            checkbox.style.cursor = 'not-allowed';
        }
    }

    /**
     * 处理下载成功（由 message-handler.js 调用）
     * @param {Object} data - 消息数据，包含 workId 和 result
     */
    async handleDownloadSuccess(data) {
        const { workId, result } = data;
    
        // ✅ 定位目标 Manager：钻取下载优先用 authorWorksView 的 manager
        //（钻取时 currentActiveTab 仍是 'following'，按 Tab 查找会落空）
        let targetManager;
        if (this.currentBatchListType === 'authorWorks') {
            targetManager = this.app.authorWorksView?.manager;
        } else if (this.app.currentActiveTab === 'liked') {
            targetManager = this.app.likedManager;
        } else if (this.app.currentActiveTab === 'bookmarked') {
            targetManager = this.app.bookmarkedManager;
        } else if (this.app.currentActiveTab === 'following') {
            targetManager = this.app.followingManager;
        } else {
            logger.warn(`⚠️ 未知的标签页类型: ${this.app.currentActiveTab}`);
            return;
        }
    
        // ✅ 从当前列表中找到作品数据
        const allWorks = targetManager.allWorks || [];
        const work = allWorks.find(w => w.workId === workId);
        
        if (!work) {
            logger.warn(`⚠️ 未找到作品数据: ${workId}`);
            return;
        }
        
        // ✅ 获取作品描述用于日志显示
        const workDesc = work.desc ? (work.desc.length > 20 ? work.desc.substring(0, 20) + '...' : work.desc) : '无描述';
        
        logger.info(`✅ 收到下载成功: ${workDesc}`);
        
        // ✅ UI 日志
        logToUI('info', `✅ 下载成功: ${workDesc}`);
        
        // 标记为已下载
        work.isDownloaded = true;
        
        // ✅ Content Script 已经保存到数据库并触发备份，Sidebar 只需更新 UI
        
        // ✅ 更新按钮状态为已完成（会自动禁用复选框）
        this._setWorkDownloadStatus(workId, 'completed');
        
        // ✅ 只更新分页控件状态，不重新渲染整个列表
        targetManager.updatePaginationControls();
        
        // ✅ 只有在非批量下载模式下才重置状态
        // 批量下载时，状态由 BATCH_DOWNLOAD_COMPLETE 消息触发 resetDownloadState()
        if (!this.currentBatchId) {
            this.isDownloading = false;
            // ✅ 恢复所有控制按钮（包括 Tab 切换）
            this.app.uiStateManager.enableAllControlButtons();
        }
    }

    /**
     * 处理下载失败（由 message-handler.js 调用）
     * @param {Object} data - 消息数据，包含 workId 和 error
     */
    handleDownloadFailed(data) {
        const { workId, error } = data;
    
        // ✅ 定位目标 Manager：钻取下载优先用 authorWorksView 的 manager（同 handleDownloadSuccess）
        let targetManager;
        if (this.currentBatchListType === 'authorWorks') {
            targetManager = this.app.authorWorksView?.manager;
        } else if (this.app.currentActiveTab === 'liked') {
            targetManager = this.app.likedManager;
        } else if (this.app.currentActiveTab === 'bookmarked') {
            targetManager = this.app.bookmarkedManager;
        } else if (this.app.currentActiveTab === 'following') {
            targetManager = this.app.followingManager;
        } else {
            logger.warn(`⚠️ 未知的标签页类型: ${this.app.currentActiveTab}`);
            return;
        }
    
        // ✅ 从当前列表中找到作品数据
        const allWorks = targetManager.allWorks || [];
        const work = allWorks.find(w => w.workId === workId);
        
        // ✅ 获取作品描述用于日志显示
        const workDesc = work && work.desc ? (work.desc.length > 20 ? work.desc.substring(0, 20) + '...' : work.desc) : '无描述';
        
        logger.error(`❌ 收到下载失败: ${workDesc}`, error);
        
        // ✅ UI 日志
        logToUI('error', `❌ 下载失败: ${error || '未知错误'}`);
        
        // ✅ 更新按钮状态为失败
        this._setWorkDownloadStatus(workId, 'failed', error || '未知错误');
        
        // ✅ 只有在非批量下载模式下才重置状态
        // 批量下载时，状态由 BATCH_DOWNLOAD_COMPLETE 消息触发 resetDownloadState()
        if (!this.currentBatchId) {
            this.isDownloading = false;
        
            // ✅ 只更新分页控件状态，不影响其他按钮
            targetManager.updatePaginationControls();
            
            // ✅ 恢复所有控制按钮（包括 Tab 切换）
            this.app.uiStateManager.enableAllControlButtons();
        }
    }

    /**
     * ✅ 核心批量下载逻辑（私有方法）
     * 职责：发送消息到 Content Script 执行批量下载
     * @param {Array} workIds - 作品ID列表
     * @param {string} folderPath - 文件夹路径
     * @param {string} batchId - 批次ID
     */
    async _executeBatchDownload(workIds, folderPath, batchId) {
        logger.info(`🚀 发送批量下载请求到 Content Script: ${workIds.length} 个作品`);
        
        window.parent.postMessage({
            source: 'sidebar',
            type: 'BATCH_DOWNLOAD_WORKS',
            workIds: workIds,
            folderPath: folderPath,
            batchId: batchId
        }, '*');
        
        // ✅ 注意：下载结果将由 message-handler.js 统一处理
        // 调用 handleBatchDownloadComplete、handleBatchDownloadError 等
    }
    
    /**
     * 处理停止下载
     * @param {string} listType - 列表类型：'liked' | 'bookmarked' | 'following'
     */
    async handleStopDownload(listType) {
        logger.info(`⏹️ 停止下载: ${listType}`);
        logger.info(`📊 当前下载状态:`, {
            isDownloading: this.isDownloading,
            currentBatchId: this.currentBatchId,
            currentBatchListType: this.currentBatchListType
        });

        // ✅ 检查是否有正在运行的批量下载任务
        if (!this.isDownloading || !this.currentBatchId) {
            logger.warn('⚠️ 没有正在运行的下载任务');
            logToUI('warning', '⚠️ 没有正在运行的保存任务');
            return;
        }

        try {
            // ✅ 立即禁用停止按钮（防止重复点击）
            this.app.uiStateManager.disableStopDownloadButton();

            // ✅ UI 日志
            logToUI('info', '⏹️ 已发送停止请求，等待当前任务完成...');
            this._showStatusMessage(`${listType}Status`, '⏹️ 正在停止...', '#faad14');

            // ✅ 发送消息到 Content Script 停止批量下载
            logger.info(`🚀 发送停止请求到 Content Script: ${this.currentBatchId}`);
            window.parent.postMessage({
                source: 'sidebar',
                type: 'STOP_BATCH_DOWNLOAD',
                batchId: this.currentBatchId
            }, '*');

            // ✅ 注意：实际的停止和状态重置会在收到 BATCH_DOWNLOAD_COMPLETE 消息后由 resetDownloadState() 处理
            logger.info('✅ 停止请求已发送，等待 Content Script 响应...');

        } catch (error) {
            logger.error('❌ 停止下载异常:', error);
            logToUI('error', `❌ 停止失败: ${error.message}`);
            
            // ✅ 异常时也要重置状态
            this.resetDownloadState();
        }
    }

    /**
     * 显示状态消息到 UI
     * @param {string} elementId - 状态元素 ID
     * @param {string} message - 消息内容
     * @param {string} color - 文字颜色
     */
    _showStatusMessage(elementId, message, color = '#666') {
        const statusEl = document.getElementById(elementId);
        logger.info(`📝 尝试显示状态消息:`, {
            elementId,
            found: !!statusEl,
            message,
            color
        });
        if (statusEl) {
            statusEl.innerHTML = `<div style="color: ${color};">${message}</div>`;
            logger.info(`✅ 状态消息已显示: ${elementId}`);
        } else {
            logger.warn(`⚠️ 未找到状态元素: ${elementId}`);
        }
    }

    /**
     * 更新批量下载进度
     * @param {Object} progress - 进度数据 { total, current, success, failed }
     * @param {number} totalCount - 总作品数
     * @param {string} listType - 列表类型：'liked' | 'bookmarked' | 'following'
     */
    updateBatchDownloadProgress(progress, totalCount, listType = 'liked') {
        const { current, success, failed } = progress;
        
        // 更新状态消息
        this._showStatusMessage(
            `${listType}Status`,
            `🚀 正在保存... ${current}/${totalCount} (成功: ${success}, 失败: ${failed})`,
            '#1890ff'
        );
        
        // UI 日志（每 5 个作品输出一次，避免过多日志）
        if (current % 5 === 0 || current === totalCount) {
            logToUI('info', `📊 进度: ${current}/${totalCount} (成功: ${success}, 失败: ${failed})`);
        }
    }

    /**
     * ✅ 处理批量下载完成
     * @param {Object} data - 消息数据，包含 batchId 和 result
     */
    async handleBatchDownloadComplete(data) {
        const { batchId, result } = data;
        
        logger.info(`✅ 批量下载完成: 成功 ${result.progress.success}, 失败 ${result.progress.failed}`);
        
        // ✅ UI 日志
        logToUI('success', `✅ 批量保存完成: 成功 ${result.progress.success}, 失败 ${result.progress.failed}`);
        
        // ✅ 显示最终状态（区分正常完成和被停止）
        if (this.currentBatchListType) {
            if (result.stopped) {
                // ✅ 被用户停止
                this._showStatusMessage(
                    `${this.currentBatchListType}Status`,
                    `⏹️ 已停止（已完成 ${result.progress.current}/${result.progress.total}）`,
                    '#faad14'
                );
                logToUI('info', `⏹️ 批量保存已被用户停止`);
            } else {
                // ✅ 正常完成
                this._showStatusMessage(
                    `${this.currentBatchListType}Status`,
                    `✅ 完成: 成功 ${result.progress.success}, 失败 ${result.progress.failed}`,
                    '#52c41a'
                );
            }
        }
        
        // ✅ 如果是作者下载，调用 finishAuthorDownload 更新数据库
        if (batchId && batchId.startsWith('author_')) {
            // author_single_UID_TIMESTAMP → parts[2] = UID
            // author_batch_TIMESTAMP_UID  → parts[3] = UID
            const parts = batchId.split('_');
            const uid = parts[1] === 'single' ? parts[2] : parts[3];
            if (uid && this.app.authorDownloadManager) {
                await this.app.authorDownloadManager.finishAuthorDownload(uid, result.stopped);
                logger.info(`[DownloadHandler] ✅ 已调用 finishAuthorDownload: ${uid}`);
            }
        }
        
        // ✅ 重置状态
        this.resetDownloadState();
    }

    /**
     * ✅ 处理批量下载错误
     * @param {Object} data - 消息数据，包含 batchId 和 error
     */
    async handleBatchDownloadError(data) {
        const { batchId, error } = data;
        
        logger.error(`❌ 批量下载错误: ${error}`);
        
        // ✅ UI 日志
        logToUI('error', `❌ 批量保存失败: ${error}`);
        
        // ✅ 显示错误状态
        if (this.currentBatchListType) {
            this._showStatusMessage(
                `${this.currentBatchListType}Status`,
                `❌ 失败: ${error}`,
                '#ff4d4f'
            );
        }
        
        // ✅ 如果是作者下载，调用 finishAuthorDownload 更新数据库
        if (batchId && batchId.startsWith('author_')) {
            // author_single_UID_TIMESTAMP → parts[2] = UID
            // author_batch_TIMESTAMP_UID  → parts[3] = UID
            const parts = batchId.split('_');
            const uid = parts[1] === 'single' ? parts[2] : parts[3];
            if (uid && this.app.authorDownloadManager) {
                await this.app.authorDownloadManager.finishAuthorDownload(uid, true);
                logger.info(`[DownloadHandler] ✅ 已调用 finishAuthorDownload（错误）: ${uid}`);
            }
        }
        
        // ✅ 重置状态
        this.resetDownloadState();
    }

    /**
     * ✅ 处理批量下载中单个作品开始下载
     * @param {Object} data - 消息数据，包含 batchId 和 workId
     */
    handleBatchDownloadItemStart(data) {
        const { batchId, workId } = data;
        
        logger.info(`🔄 开始下载作品: ${workId}`);
        
        // ✅ 将该作品的按钮设置为“下载中”状态（带进度条）
        this._setWorkDownloadStatus(workId, 'downloading');
    }

    /**
     * 重置下载状态
     */
    resetDownloadState() {
        // ✅ 保存列表类型（在清空之前）
        const listType = this.currentBatchListType;
        
        // 重置标志位
        this.isDownloading = false;
        this.currentBatchId = null;
        this.currentBatchListType = null;
        
        // 恢复按钮状态
        this.app.uiStateManager.enableAllControlButtons();
        
        // ✅ 恢复作品按钮（pending/failed/error 状态变为可用）
        this.app.uiStateManager.enableAllWorkDownloadButtons();
        
        // ✅ 三个列表统一处理，都清空批量选择状态
        if (listType) {
            this.app.batchSelectionManager.clearSelection(listType);
            logger.info(`🔓 已清空 ${listType} 列表的批量选择`);
        }
        
        logger.info('🔓 下载状态已重置');
    }

    /**
     * 获取下载状态
     * @returns {Object} 下载状态对象
     */
    getDownloadState() {
        return {
            isDownloading: this.isDownloading,
            currentBatchId: this.currentBatchId,
            currentBatchListType: this.currentBatchListType
        };
    }
}

export { DownloadHandler };
