// ==========================================
// FavGallery - 侧边栏应用主逻辑
// 功能：用户信息、文件夹选择、Tab 切换、日志输出、列表渲染
// ==========================================

import { createLogger, logToUI } from '../utils/logger.js';
import { escapeHtml } from '../utils/ui-helpers.js';
import { TabManager } from '../ui/tab-manager.js';
import { UIStateManager } from '../ui/ui-state-manager.js';
import { BatchSelectionManager } from './batch-selection-manager.js';
import { MessageHandler } from './message-handler.js';
import { EventBinder } from './event-binder.js';
import { ListDisplayManager } from './list-display-manager.js';
import { CONFIG } from '../config/constants.js';
import { WorkListManager } from '../utils/work-list-manager.js';
import { fileSystem } from '../data/file-system.js';

const logger = createLogger('App');

class App {
    constructor() {
        // 当前激活的平台
        this.currentPlatform = CONFIG.ACTIVE_PLATFORM;

        // 当前激活的 Tab
        this.currentActiveTab = 'following';

        // 用户信息
        this.userInfo = null;

        // 文件夹选择状态
        this.folderSelected = false;
        this.folderName = null; // ✅ 保存文件夹名称

        // 加载状态
        this.isLoading = false;

        // ✅ 下载状态标志（防止并发操作）
        this.isDownloading = false;

        // ✅ 批量选择管理器
        this.batchSelectionManager = new BatchSelectionManager(this);

        // ✅ 列表显示管理器
        this.listDisplayManager = new ListDisplayManager(this);

        // 管理器
        this.tabManager = new TabManager(this);
        this.uiStateManager = new UIStateManager(this);
        this.messageHandler = new MessageHandler(this);
        this.eventBinder = new EventBinder(this);

        // ✅ 列表管理器（先实现点赞列表）
        this.likedManager = new WorkListManager({ type: 'liked' });

        this.init();
    }

    /**
     * 初始化
     */
    async init() {
        logger.info('🚀 系统初始化开始...');
        logger.info('📄 当前 DOM 状态:', {
            readyState: document.readyState,
            bodyExists: !!document.body,
            tabFollowingExists: !!document.getElementById('tabFollowing'),
            tabLikedExists: !!document.getElementById('tabLiked'),
            tabBookmarkedExists: !!document.getElementById('tabBookmarked')
        });

        // ✅ 初始化文件系统（包括日志系统）
        await this.initializeFileSystem();

        // 更新平台信息
        this.updatePlatformInfo();

        // 绑定事件
        this.eventBinder.bind();

        // 监听来自 Content Script 的消息
        this.messageHandler.setup();

        // 请求用户信息
        this.requestUserInfo();

        logger.info('✅ 系统初始化完成，就绪');
    }

    /**
     * 初始化文件系统
     */
    async initializeFileSystem() {
        try {
            // ✅ 浏览器通过 id 参数自动记忆上次选择的目录
            // 无需手动恢复句柄，fileSystem.init() 会在需要时触发用户选择
            logger.info('⚠️ 等待用户选择文件夹后初始化文件系统');
        } catch (error) {
            logger.error('❌ 文件系统初始化失败:', error);
        }
    }

    /**
     * 更新平台信息显示
     */
    updatePlatformInfo() {
        const platformInfo = CONFIG.PLATFORM_INFO[this.currentPlatform];

        if (!platformInfo) {
            logger.warn('未找到平台信息:', this.currentPlatform);
            return;
        }

        // 更新标题描述
        const headerDesc = document.querySelector('.header p');
        if (headerDesc) {
            headerDesc.textContent = platformInfo.description;
        }

        logger.info('平台信息已更新:', platformInfo.name);
    }

    /**
     * 处理加载点赞列表
     */
    handleLoadLikedVideos() {
        this.listDisplayManager.handleLoadLikedVideos();
    }
    
    /**
     * 处理点赞作品列表加载完成
     */
    async handleLikedWorksLoaded(works, total) {
        await this.listDisplayManager.handleLikedWorksLoaded(works, total, this.likedManager);
    }
    
    /**
     * 批量查询已下载的作品 ID
     */
    async getDownloadedWorkIds() {
        return await this.listDisplayManager.getDownloadedWorkIds();
    }
    
    /**
     * 刷新所有作品的下载状态（分页/搜索后调用）
     */
    async refreshDownloadStatus() {
        await this.listDisplayManager.refreshDownloadStatus(this.likedManager);
    }
    
    /**
     * 处理点赞作品列表加载进度
     */
    handleLikedWorksProgress(currentCount, totalCount) {
        this.listDisplayManager.handleLikedWorksProgress(currentCount, totalCount, this.likedManager);
    }
    
    /**
     * 处理点赞作品列表加载错误
     */
    handleLikedWorksError(error) {
        this.listDisplayManager.handleLikedWorksError(error, this.likedManager);
    }
    
    /**
     * 清空点赞列表
     */
    clearLikedList() {
        this.listDisplayManager.clearLikedList(this.likedManager);
    }
    
    /**
     * 处理加载数据开始
     */
    handleLoadDataStart(listType) {
        this.listDisplayManager.handleLoadDataStart(listType);
    }

    /**
     * 请求用户信息
     */
    requestUserInfo() {
        window.parent.postMessage({
            source: 'sidebar',
            type: 'GET_USER_INFO'
        }, '*');
    }

    /**
     * 处理用户信息
     */
    handleUserInfo(userInfo) {
        logger.info('收到用户信息:', userInfo.nickname);
        this.userInfo = userInfo;
        this.displayUserInfo(userInfo);
    }

    /**
     * 显示用户信息
     */
    displayUserInfo(userInfo) {
        const userInfoEl = document.getElementById('userInfo');
        if (!userInfoEl) return;

        userInfoEl.innerHTML = `
            <div style="font-size: 13px; line-height: 1.8;">
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 4px;">
                    <div><strong>昵称:</strong> ${escapeHtml(userInfo.nickname)}</div>
                    <div><strong>关注数:</strong> ${userInfo.followingCount}</div>
                    <div><strong>点赞数:</strong> ${userInfo.favoritingCount}</div>
                    <div><strong>收藏数:</strong> ${userInfo.collectCount || 0}</div>
                </div>
            </div>
        `;
    }

    /**
     * 处理选择文件夹
     */
    handleSelectFolder() {
        logger.info('请求选择文件夹...');

        window.parent.postMessage({
            source: 'sidebar',
            type: 'SELECT_FOLDER'
        }, '*');
    }

    /**
     * 处理文件夹选择结果
     */
    async handleFolderSelected(data) {
        logger.info('文件夹选择结果:', data.success ? '成功' : '失败');

        const folderStatus = document.getElementById('folderStatus');
        if (!folderStatus) return;

        if (data.success) {
            this.folderSelected = true;
            this.folderName = data.path; // ✅ 保存文件夹名称
            folderStatus.innerHTML = `
                <div style="color: #52c41a;">
                    ✅ 已选择: ${data.path}
                </div>
            `;

            // ✅ UI 日志
            logToUI('info', `✅ 已选择文件夹: ${data.path}`);

            // ✅ 启用相关按钮
            this.uiStateManager.enableButtons();

            logger.info('✅ 文件夹选择成功:', data.path);
        } else {
            this.folderSelected = false;
            this.folderName = null;
            folderStatus.innerHTML = `
                <div style="color: #ff4d4f;">
                    ❌ 选择失败: ${data.error}
                </div>
            `;

            // ✅ UI 日志
            logToUI('error', `❌ 选择文件夹失败: ${data.error}`);

            logger.error('❌ 文件夹选择失败:', data.error);
        }
    }

    /**
     * 处理单个作品下载
     * @param {string} workId - 作品ID
     */
    async handleSingleWorkDownload(workId) {
        try {
            logger.info(`📥 开始下载单个作品: ${workId}`);

            // 检查是否已选择文件夹
            if (!this.folderSelected) {
                logger.error('❌ 请先选择文件夹');
                logToUI('error', '❌ 请先点击"选择文件夹"按钮');
                this._showStatusMessage('folderStatus', '❌ 请先点击"选择文件夹"按钮', '#ff4d4f');
                return;
            }

            // 从当前列表中找到作品数据
            const allWorks = this.likedManager.allWorks || [];
            const work = allWorks.find(w => w.workId === workId);

            if (!work) {
                logger.error(`❌ 未找到作品: ${workId}`);
                logToUI('error', '❌ 未找到作品数据，请刷新列表后重试');
                return;
            }

            // ✅ UI 日志（通过所有检查后才记录）
            const workDesc = work.desc ? (work.desc.length > 20 ? work.desc.substring(0, 20) + '...' : work.desc) : '无描述';
            logToUI('info', `📥 开始下载作品: ${workDesc}`);

            // ✅ 获取文件夹路径（使用保存的文件夹名称）
            const folderPath = this.folderName;
            if (!folderPath) {
                logger.error('❌ 未获取到文件夹路径');
                logToUI('error', '❌ 文件夹路径无效，请重新选择');
                this._showStatusMessage('folderStatus', '❌ 文件夹路径无效，请重新选择', '#ff4d4f');
                return;
            }

            // ✅ 设置下载状态标志
            this.isDownloading = true;

            // ✅ 禁用所有控制按钮和其他作品卡片按钮（防止并发）
            this.uiStateManager.disableAllControlButtons();
            this.uiStateManager.disableAllWorkDownloadButtons();

            // ✅ 更新按钮状态为下载中（通过 UIStateManager）
            this._setWorkDownloadStatus(workId, 'downloading');

            // ✅ P0: 发送消息到 Content Script，由它执行下载（只传 workId）
            logger.info(`🚀 发送下载请求到 Content Script: ${workId}`);
            window.parent.postMessage({
                source: 'sidebar',
                type: 'DOWNLOAD_WORK_BY_ID',
                workId: workId,
                folderPath: folderPath
            }, '*');

            // ✅ 注意：下载结果将由 message-handler.js 统一处理
            // 调用 handleDownloadSuccess 或 handleDownloadFailed
        } catch (error) {
            logger.error(`❌ 下载异常: ${workId}`, error);

            // ✅ 更新按钮状态为异常
            const errorMessage = error.message || (typeof error === 'string' ? error : '未知错误');
            this._setWorkDownloadStatus(workId, 'error', errorMessage);

            // ✅ 恢复下载状态标志
            this.isDownloading = false;

            // ✅ 恢复所有控制按钮和其他作品卡片按钮
            this.uiStateManager.enableAllControlButtons();
            this.uiStateManager.enableAllWorkDownloadButtons();
        }
    }

    /**
     * 设置作品下载状态（UI 更新）
     * @param {string} workId - 作品ID
     * @param {string} status - 状态：'downloading' | 'completed' | 'failed' | 'error'
     * @param {string} message - 消息（可选）
     */
    _setWorkDownloadStatus(workId, status, message = '') {
        const downloadBtn = document.querySelector(`.download-btn[data-work-id="${workId}"]`);
        if (!downloadBtn) return;

        switch (status) {
            case 'waiting':  // ✅ 新增：等待中状态（批量下载时使用）
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
     * 处理下载成功（由 message-handler.js 调用）
     * @param {Object} data - 消息数据，包含 workId 和 result
     */
    async handleDownloadSuccess(data) {
        const { workId, result } = data;
        
        // ✅ 从当前列表中找到作品数据
        const allWorks = this.likedManager.allWorks || [];
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
        
        // ✅ 只有在非批量下载模式下才重置状态
        // 批量下载时，状态由 BATCH_DOWNLOAD_COMPLETE 消息触发 resetDownloadState()
        if (!this.currentBatchId) {
            this.isDownloading = false;
            this.uiStateManager.enableAllControlButtons();
            this.uiStateManager.enableAllWorkDownloadButtons();
        }
    }

    /**
     * 处理下载失败（由 message-handler.js 调用）
     * @param {Object} data - 消息数据，包含 workId 和 error
     */
    handleDownloadFailed(data) {
        const { workId, error } = data;
        
        // ✅ 从当前列表中找到作品数据
        const allWorks = this.likedManager.allWorks || [];
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
            this.uiStateManager.enableAllControlButtons();
            this.uiStateManager.enableAllWorkDownloadButtons();
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
     * 处理批量选择变化（下拉框）
     * @param {string} listType - 列表类型：'liked' | 'bookmarked' | 'following'
     * @param {string} selectionType - 选择类型：'current' | 'all' | ''
     */
    handleBatchSelectionChange(listType, selectionType) {
        this.batchSelectionManager.handleBatchSelectionChange(listType, selectionType);
    }

    /**
     * 处理批量下载
     * @param {string} listType - 列表类型：'liked' | 'bookmarked' | 'following'
     */
    async handleBatchDownload(listType) {
        logger.info(`🚀 开始批量下载: ${listType}`);
    
        // ✅ 调试日志：获取并输出批量选择状态
        const batchState = this.batchSelectionManager.getState(listType);
        logger.info(`📋 批量选择状态详情:`, {
            listType: listType,
            selectAll: batchState.selectAll,
            selectedCount: batchState.selectedWorkIds.size,
            selectedIds: Array.from(batchState.selectedWorkIds)
        });
    
        // ✅ UI 日志：显示选中数量
        logToUI('info', `📋 当前选中 ${batchState.selectedWorkIds.size} 个作品`);
        if (batchState.selectAll) {
            logToUI('info', '✅ 已启用全选模式');
        }
    
        // 检查是否已选择文件夹
        if (!this.folderSelected) {
            logger.error('❌ 请先选择文件夹');
            logToUI('error', '❌ 请先点击“选择文件夹”按钮');
            this._showStatusMessage('folderStatus', '❌ 请先点击“选择文件夹”按钮', '#ff4d4f');
            return;
        }
    
        // ✅ 检查是否有选中作品
        if (batchState.selectedWorkIds.size === 0) {
            logger.warn('⚠️ 未选择任何作品');
            logToUI('warning', '⚠️ 请先选择要保存的作品');
            return;
        }
    
        // ✅ 检查并发控制
        if (this.isDownloading) {
            logger.warn('⚠️ 已有下载任务在运行');
            logToUI('warning', '⚠️ 已有保存任务在运行，请等待完成或停止后再试');
            return;
        }
    
        try {
            // ✅ 根据 listType 获取对应的 Manager 和作品数据
            let allWorks = [];
            if (listType === 'liked') {
                allWorks = this.likedManager.allWorks || [];
            } else if (listType === 'bookmarked') {
                logger.warn('⚠️ 收藏列表功能尚未实现');
                logToUI('warning', '⚠️ 收藏列表功能尚未实现，敬请期待');
                return;
            } else if (listType === 'following') {
                logger.warn('⚠️ 关注列表功能尚未实现');
                logToUI('warning', '⚠️ 关注列表功能尚未实现，敬请期待');
                return;
            } else {
                logger.error(`❌ 未知的列表类型: ${listType}`);
                logToUI('error', `❌ 未知的列表类型: ${listType}`);
                return;
            }
                
            // ✅ 只提取 workId 列表，不传递完整对象
            const selectedWorkIds = Array.from(batchState.selectedWorkIds).filter(workId => 
                allWorks.some(work => work.workId === workId)
            );
                
            if (selectedWorkIds.length === 0) {
                logger.error('❌ 未找到选中作品的数据');
                logToUI('error', '❌ 未找到选中作品的数据，请重新加载列表');
                return;
            }
    
            logger.info(`✅ 获取到 ${selectedWorkIds.length} 个作品的 ID`);
            logToUI('info', `✅ 准备保存 ${selectedWorkIds.length} 个作品`);
    
            // ✅ 设置下载状态
            this.isDownloading = true;
            this.currentBatchId = `batch_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            this.currentBatchListType = listType;  // ✅ 保存当前批量下载的列表类型
    
            // ✅ 禁用所有控制按钮（不包括停止按钮）
            this.uiStateManager.disableAllControlButtons();
            
            // ✅ 禁用所有作品按钮（防止并发和误操作）
            this.uiStateManager.disableAllWorkDownloadButtons();
            
            // ✅ 启用停止下载按钮（批量下载允许中断）
            document.querySelectorAll('.stop-download-btn').forEach(btn => {
                btn.disabled = false;
                btn.style.opacity = '1';
                btn.style.cursor = 'pointer';
                btn.title = '点击停止批量保存';
            });
    
            // ✅ UI 日志
            logToUI('success', `🚀 开始批量保存 (${selectedWorkIds.length} 个作品)`);
            this._showStatusMessage(`${listType}Status`, `🚀 正在保存... 0/${selectedWorkIds.length}`, '#1890ff');
            
            // ✅ 将所有选中作品的按钮设置为"等待中"状态（无进度条）
            selectedWorkIds.forEach(workId => {
                this._setWorkDownloadStatus(workId, 'waiting');
                // ✅ 同时禁用复选框（防止用户中途取消勾选）
                this._disableWorkCheckbox(workId);
            });
            
            // ✅ 发送消息到 Content Script 执行批量下载
            logger.info(`🚀 发送批量下载请求到 Content Script: ${selectedWorkIds.length} 个作品`);
            window.parent.postMessage({
                source: 'sidebar',
                type: 'BATCH_DOWNLOAD_WORKS',
                workIds: selectedWorkIds,
                folderPath: this.folderName,
                batchId: this.currentBatchId
            }, '*');
    
            // ✅ 注意：下载结果将由 message-handler.js 统一处理
            // 调用 handleBatchDownloadComplete、handleBatchDownloadError 等
    
        } catch (error) {
            logger.error('❌ 批量下载异常:', error);
            logToUI('error', `❌ 批量保存失败: ${error.message}`);
            this._showStatusMessage(`${listType}Status`, `❌ 失败: ${error.message}`, '#ff4d4f');
                
            // ✅ 异常时也要重置状态
            this.resetDownloadState();
        }
    }

    /**
     * 处理停止下载
     * @param {string} listType - 列表类型：'liked' | 'bookmarked' | 'following'
     */
    async handleStopDownload(listType) {
        logger.info(`⏹️ 停止下载: ${listType}`);

        // ✅ 检查是否有正在运行的批量下载任务
        if (!this.isDownloading || !this.currentBatchId) {
            logger.warn('⚠️ 没有正在运行的下载任务');
            logToUI('warning', '⚠️ 没有正在运行的保存任务');
            return;
        }

        try {
            // ✅ 立即禁用停止按钮（防止重复点击）
            document.querySelectorAll('.stop-download-btn').forEach(btn => {
                btn.disabled = true;
                btn.style.opacity = '0.5';
                btn.style.cursor = 'not-allowed';
                btn.title = '正在停止...';
            });

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
     * 获取 FileSystem 实例
     * @returns {Promise<Object>} FileSystem 实例
     */
    async getFileSystem() {
        // fileSystem 已经在文件顶部导入，直接返回
        return fileSystem;
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
    handleBatchDownloadComplete(data) {
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
        
        // ✅ 重置状态
        this.resetDownloadState();
    }

    /**
     * ✅ 处理批量下载错误
     * @param {Object} data - 消息数据，包含 batchId 和 error
     */
    handleBatchDownloadError(data) {
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
        this.uiStateManager.enableAllControlButtons();
        
        // ✅ 恢复作品按钮（pending/failed/error 状态变为可用）
        this.uiStateManager.enableAllWorkDownloadButtons();
        
        // ✅ 清空批量选择状态和复选框
        if (listType) {
            this.batchSelectionManager.clearSelection(listType);
            logger.info(`🔓 已清空 ${listType} 列表的批量选择`);
        }
        
        logger.info('🔓 下载状态已重置');
    }
}

// 暴露 app 实例到全局
window.douyinDownloaderApp = new App();




