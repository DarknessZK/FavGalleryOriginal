// ==========================================
// FavGallery - 侧边栏应用主逻辑
// 功能：用户信息、文件夹选择、Tab 切换、日志输出、列表渲染
// ==========================================

import { createLogger, logToUI } from '../utils/logger.js';
import { escapeHtml } from '../utils/ui-helpers.js';
import { TabManager } from '../ui/components/tab-manager.js';
import { UIStateManager } from '../ui/ui-state-manager.js';
import { BatchSelectionManager } from './batch-selection-manager.js';
import { MessageHandler } from './message-handler.js';
import { EventBinder } from './event-binder.js';
import { ListDisplayManager } from './list-display-manager.js';
import { DownloadHandler } from './download-handler.js';
import { AuthorDownloadManager } from './author-download-manager.js';
import { MultiTagSelector } from '../ui/components/multi-tag-selector.js';
import { CONFIG } from '../config/constants.js';
import { WorkListManager } from '../utils/work-list-manager.js';
import { fileSystem } from '../data/storage/file-system.js';

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

        // ✅ 批量选择管理器
        this.batchSelectionManager = new BatchSelectionManager(this);

        // ✅ 列表显示管理器
        this.listDisplayManager = new ListDisplayManager(this);
        
        // ✅ 下载处理器
        this.downloadHandler = new DownloadHandler(this);
        
        // ✅ 作者下载管理器
        this.authorDownloadManager = new AuthorDownloadManager(this);

        // 管理器
        this.tabManager = new TabManager(this);
        this.uiStateManager = new UIStateManager(this);
        this.messageHandler = new MessageHandler(this);
        this.eventBinder = new EventBinder(this);

        // ✅ 列表管理器（先实现点赞列表）
        this.likedManager = new WorkListManager({ type: 'liked' });
        
        // ✅ 收藏列表管理器
        this.bookmarkedManager = new WorkListManager({ type: 'bookmarked' });
        
        // ✅ 关注列表管理器（作者列表）
        this.followingManager = new WorkListManager({ type: 'following' });
        
        // ✅ 收藏夹多选标签选择器
        this.collectsSelector = null; // 稍后初始化

        this.init();
    }

    /**
     * 初始化
     */
    async init() {
        logger.info('🚀 系统初始化开始...');
        logger.debug('📄 当前 DOM 状态:', {
            readyState: document.readyState,
            bodyExists: !!document.body,
            tabFollowingExists: !!document.getElementById('tabFollowing'),
            tabLikedExists: !!document.getElementById('tabLiked'),
            tabBookmarkedExists: !!document.getElementById('tabBookmarked')
        });

        // ✅ 先初始化其他组件
        await this.initializeFileSystem();

        // 更新平台信息
        this.updatePlatformInfo();

        // 绑定事件
        this.eventBinder.bind();

        // 监听来自 Content Script 的消息
        this.messageHandler.setup();

        // 请求用户信息
        this.requestUserInfo();

        // ✅ 最后设置容器高度（确保 DOM 和 CSS 已完全加载）
        requestAnimationFrame(() => {
            this.setupContainerHeight();
        });
        
        // ✅ 初始化侧边栏模式切换开关
        this.initSidebarModeToggle();

        logger.info('✅ 系统初始化完成，就绪');
    }

    /**
     * 设置 container 固定高度（基于初始视口）
     * 窗口缩小时，container 保持原始高度，通过 body 滚动查看
     */
    setupContainerHeight() {
        const container = document.getElementById('sidebarContainer');
        if (container) {
            // 设置为当前视口高度，之后不再随窗口变化
            container.style.height = window.innerHeight + 'px';
            logger.debug('📏 Container 高度设置为:', window.innerHeight + 'px');
        }
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
    handleLoadLikedWorks() {
        this.listDisplayManager.handleLoadLikedWorks();
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
     * ✅ 通用列表下载状态刷新
     */
    async refreshListDownloadStatus(manager) {
        await this.listDisplayManager.refreshListDownloadStatus(manager);
    }

    /**
     * 刷新点赞作品列表的下载状态（分页/搜索后调用）
     */
    async refreshDownloadStatus() {
        await this.refreshListDownloadStatus(this.likedManager);
    }
    
    /**
     * 处理点赞作品列表加载进度
     */
    handleLikedWorksProgress(currentCount, totalCount) {
        this.listDisplayManager.handleLikedWorksProgress(currentCount, totalCount, this.likedManager);
    }
    
    /**
     * ✅ 处理收藏作品列表加载进度
     */
    handleCollectWorksProgress(currentCount, totalCount) {
        this.listDisplayManager.handleCollectWorksProgress(currentCount, totalCount, this.bookmarkedManager);
    }
    
    /**
     * 处理点赞作品列表加载错误
     */
    handleLikedWorksError(error) {
        this.listDisplayManager.handleLikedWorksError(error, this.likedManager);
    }

    /**
     * ✅ 处理收藏作品列表加载错误
     */
    handleCollectWorksError(error) {
        this.listDisplayManager.handleCollectWorksError(error, this.bookmarkedManager);
    }
    
    /**
     * 清空点赞列表
     */
    clearLikedList() {
        this.listDisplayManager.clearLikedList(this.likedManager);
    }

    /**
     * ✅ 清空收藏列表
     */
    clearBookmarkedList() {
        this.listDisplayManager.clearBookmarkedList(this.bookmarkedManager);
    }
    
    /**
     * ✅ 处理加载关注列表
     */
    handleLoadFollowingAuthors() {
        this.listDisplayManager.handleLoadFollowingAuthors();
    }
    
    /**
     * ✅ 处理关注作者列表加载完成
     */
    async handleFollowingAuthorsLoaded(authors, total) {
        await this.listDisplayManager.handleFollowingAuthorsLoaded(authors, total, this.followingManager);
    }
    
    /**
     * ✅ 处理关注作者列表加载进度
     */
    handleFollowingAuthorsProgress(currentCount, totalCount) {
        this.listDisplayManager.handleFollowingAuthorsProgress(currentCount, totalCount, this.followingManager);
    }
    
    /**
     * ✅ 处理关注作者列表加载错误
     */
    handleFollowingAuthorsError(error) {
        this.listDisplayManager.handleFollowingAuthorsError(error, this.followingManager);
    }
    
    /**
     * 处理加载数据开始
     */
    handleLoadDataStart(listType) {
        this.listDisplayManager.handleLoadDataStart(listType);
    }
    
    /**
     * ✅ 初始化收藏夹多选标签选择器
     * @param {Array} collects - 收藏夹列表
     */
    initCollectsSelector(collects) {
        if (!collects || collects.length === 0) {
            logger.warn('⚠️ 收藏夹列表为空，无法初始化选择器');
            logToUI('warning', '⚠️ 未获取到收藏夹列表');
            return;
        }
        
        // 创建选择器实例
        this.collectsSelector = new MultiTagSelector({
            containerId: 'collectsMultiSelect',
            prefix: 'collects',  // ✅ 使用前缀自动推导所有元素ID
            dataKey: 'collectId',
            labelKey: 'collectName',
            countKey: 'workCount',
            sortByTime: true,
            onSelectionChange: (selectedCollectIds) => {
                logger.info(`📋 收藏夹选择变化: ${selectedCollectIds.size} 个`);
                this.loadBookmarkedWorksByCollects(selectedCollectIds);
            }
        });
        
        // 初始化数据
        this.collectsSelector.init(collects);
        
        logger.info(`✅ 已初始化 ${collects.length} 个收藏夹`);
        
        // ✅ 显示状态信息（在刷新按钮下方）
        const statusDiv = document.getElementById('bookmarkedStatus');
        if (statusDiv) {
            statusDiv.textContent = `✅ 已加载 ${collects.length} 个收藏夹`;
            statusDiv.style.color = '#52c41a';
        }
    }
    
    /**
     * ✅ 根据选中的收藏夹加载作品
     * @param {Set} selectedCollectIds - 选中的收藏夹ID集合
     */
    async loadBookmarkedWorksByCollects(selectedCollectIds) {
        const collectIds = Array.from(selectedCollectIds);
        
        if (collectIds.length === 0) {
            // 清空列表
            this.bookmarkedManager.setData([]);
            this.bookmarkedManager.updateUI();
            logger.info('🗑️ 已清空收藏列表');
            logToUI('info', '🗑️ 已清空收藏列表');
            return;
        }
        
        logger.info(`🔄 开始加载 ${collectIds.length} 个收藏夹的作品...`);
        logToUI('info', `🔄 正在加载 ${collectIds.length} 个收藏夹的作品...`);
        
        // ✅ 禁用所有控制按钮（防止重复点击和误操作）
        this.uiStateManager.disableAllControlButtons();
        
        // ✅ 禁用所有作品按钮
        this.uiStateManager.disableAllWorkDownloadButtons();
        
        // ✅ 发送消息到 Content Script，请求获取这些收藏夹的所有作品
        window.parent.postMessage({
            source: 'sidebar',
            type: 'LOAD_COLLECT_WORKS',
            collectIds: collectIds
        }, '*');
    }
    
    /**
     * ✅ 处理收藏夹作品加载完成
     * @param {Array} works - 作品列表
     * @param {number} total - 总数
     */
    async handleCollectWorksLoaded(works, total) {
        await this.listDisplayManager.handleCollectWorksLoaded(works, total, this.bookmarkedManager);
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

            // ✅ 通知 FileLogger 已选择文件夹
            import('../utils/file-logger.js').then(({ default: fileLogger }) => {
                fileLogger.setFolderSelected(true);
            });

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

            // ✅ 通知 FileLogger 文件夹选择失败
            import('../utils/file-logger.js').then(({ default: fileLogger }) => {
                fileLogger.setFolderSelected(false);
            });

            logger.error('❌ 文件夹选择失败:', data.error);
        }
    }

    /**
     * ✅ 处理恢复开始消息
     */
    handleRestoreStarting(message) {
        logger.info('🔄 开始恢复数据...');
        
        // 显示恢复提示条
        this.uiStateManager.setRestoreState(true, message || '🔄 正在从备份恢复数据...');
        
        // 禁用所有控制按钮
        this.uiStateManager.disableAllControlButtons();
        
        // 在日志区域显示
        logToUI('info', message || '🔄 正在从备份恢复数据...');
    }

    /**
     * ✅ 处理恢复进度消息
     */
    handleRestoreProgress(data) {
        const { table, restored, current, total } = data;
        
        // 在日志区域显示进度
        if (restored > 0) {
            logToUI('info', `✅ 恢复 ${table}: ${restored} 条记录 (${current}/${total})`);
        } else {
            logToUI('info', `ℹ️ ${table}: 无数据，跳过`);
        }
    }

    /**
     * ✅ 处理恢复完成消息
     */
    handleRestoreCompleted(data) {
        const { success, restoredCount, message } = data;
        
        logger.info('✅ 恢复完成:', message);
        
        // 在日志区域显示结果
        if (success && restoredCount > 0) {
            logToUI('success', `✅ 自动恢复完成: 共恢复 ${restoredCount} 条记录`);
        } else {
            logToUI('warning', message || 'ℹ️ 未找到备份文件或备份为空');
        }
        
        // ✅ 延迟隐藏提示条，让用户有时间看到结果（2秒后）
        setTimeout(() => {
            // 隐藏恢复提示条
            this.uiStateManager.setRestoreState(false);
            
            // 启用所有控制按钮
            this.uiStateManager.enableAllControlButtons();
        }, 2000);
    }

    // ==========================================
    // 下载相关方法（委托给 DownloadHandler）
    // ==========================================

    /**
     * 处理批量选择变化（下拉框）
     * @param {string} listType - 列表类型：'liked' | 'bookmarked' | 'following'
     * @param {string} selectionType - 选择类型：'current' | 'all' | ''
     */
    handleBatchSelectionChange(listType, selectionType) {
        this.batchSelectionManager.handleBatchSelectionChange(listType, selectionType);
    }

    /**
     * 处理停止下载
     * @param {string} listType - 列表类型：'liked' | 'bookmarked' | 'following'
     */
    async handleStopDownload(listType) {
        await this.downloadHandler.handleStopDownload(listType);
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
        this.downloadHandler.updateBatchDownloadProgress(progress, totalCount, listType);
    }

    /**
     * ✅ 处理批量下载完成
     * @param {Object} data - 消息数据，包含 batchId 和 result
     */
    handleBatchDownloadComplete(data) {
        this.downloadHandler.handleBatchDownloadComplete(data);
    }

    /**
     * ✅ 处理批量下载错误
     * @param {Object} data - 消息数据，包含 batchId 和 error
     */
    handleBatchDownloadError(data) {
        this.downloadHandler.handleBatchDownloadError(data);
    }

    /**
     * ✅ 处理批量下载中单个作品开始下载
     * @param {Object} data - 消息数据，包含 batchId 和 workId
     */
    handleBatchDownloadItemStart(data) {
        this.downloadHandler.handleBatchDownloadItemStart(data);
    }

    /**
     * ✅ 处理单个作者的所有作品下载
     * @param {Array} uids - 作者 UID 数组
     */
    async handleAuthorDownload(uids) {
        await this.downloadHandler.handleAuthorDownload(uids);
    }

    /**
     * ✅ 点赞列表批量下载（独立入口）
     * @param {Array} workIds - 作品ID数组
     */
    async handleLikedDownload(workIds) {
        await this.downloadHandler.handleLikedDownload(workIds);
    }

    /**
     * ✅ 收藏列表批量下载（独立入口）
     * @param {Array} workIds - 作品ID数组
     */
    async handleBookmarkedDownload(workIds) {
        await this.downloadHandler.handleBookmarkedDownload(workIds);
    }

    /**
     * ✅ 处理停止下载
     * @param {string} listType - 列表类型：'liked' | 'bookmarked' | 'following'
     */
    async handleStopDownload(listType) {
        await this.downloadHandler.handleStopDownload(listType);
    }

    /**
     * 处理下载成功（由 message-handler.js 调用）
     * @param {Object} data - 消息数据，包含 workId 和 result
     */
    async handleDownloadSuccess(data) {
        await this.downloadHandler.handleDownloadSuccess(data);
    }

    /**
     * 处理下载失败（由 message-handler.js 调用）
     * @param {Object} data - 消息数据，包含 workId 和 error
     */
    handleDownloadFailed(data) {
        this.downloadHandler.handleDownloadFailed(data);
    }
    
    /**
     * ✅ 初始化侧边栏模式切换开关
     */
    initSidebarModeToggle() {
        const toggle = document.getElementById('sidebarModeToggle');
        if (!toggle) {
            logger.warn('⚠️ 未找到侧边栏模式切换开关');
            return;
        }
        
        // ✅ 通过 postMessage 请求 Content Script 获取设置
        window.parent.postMessage({
            source: 'sidebar',
            type: 'GET_SIDEBAR_MODE'
        }, '*');
        
        // ✅ 监听响应消息
        const handleMessage = (event) => {
            if (event.data && event.data.source === 'content' && event.data.type === 'SIDEBAR_MODE_RESPONSE') {
                const mode = event.data.mode || 'hover';
                logger.info(`📋 读取侧边栏模式: ${mode}`);
                
                // ✅ 只同步 UI 状态，不移除 disabled（等待选择文件夹后由 enableButtons() 启用）
                this.setToggleMode(toggle, mode);
                
                // 移除监听器（只处理一次）
                window.removeEventListener('message', handleMessage);
            }
        };
        
        window.addEventListener('message', handleMessage);
        
        const options = toggle.querySelectorAll('.toggle-option');
        
        // 绑定点击事件
        options.forEach(option => {
            option.addEventListener('click', () => {
                const value = option.dataset.value;
                
                // 更新 UI
                this.setToggleMode(toggle, value);
                
                // 通知 Content Script
                window.parent.postMessage({
                    source: 'sidebar',
                    type: 'CHANGE_SIDEBAR_MODE',
                    mode: value
                }, '*');
                
                logger.info(`✅ 侧边栏模式已切换为: ${value === 'hover' ? '悬停' : '挤压'}`);
            });
        });
    }
    
    /**
     * ✅ 设置开关状态
     * @param {HTMLElement} toggle - 开关元素
     * @param {string} mode - 模式 ('hover' | 'squeeze')
     */
    setToggleMode(toggle, mode) {
        toggle.setAttribute('data-mode', mode);
        
        const options = toggle.querySelectorAll('.toggle-option');
        options.forEach(opt => {
            if (opt.dataset.value === mode) {
                opt.classList.add('active');
            } else {
                opt.classList.remove('active');
            }
        });
    }
}

// 暴露 app 实例到全局
window.douyinDownloaderApp = new App();




