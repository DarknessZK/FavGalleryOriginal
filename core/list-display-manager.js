// ==========================================
// FavGallery - 列表显示管理器
// 职责：封装列表显示相关的业务逻辑（加载、进度、错误、下载状态查询）
// 注意：不持有 WorkListManager 实例，而是接收它作为参数
// ==========================================

import { createLogger, logToUI } from '../utils/logger.js';
import { databaseProxy } from '../data/database/database-proxy.js';

const logger = createLogger('ListDisplayManager');

class ListDisplayManager {
    constructor(app) {
        this.app = app;
        // ✅ 缓存已下载作品ID（避免重复全表扫描）
        this.cachedDownloadedWorkIds = null;
    }

    /**
     * 处理加载点赞作品列表请求
     */
    handleLoadLikedWorks() {
        logger.info('🔄 开始加载点赞列表...');
    
        // 检查是否已选择文件夹
        if (!this.app.folderSelected) {
            logger.error('❌ 请先选择文件夹');
            alert('请先点击"选择文件夹"按钮');
            return;
        }
    
        // ✅ 禁用所有控制按钮（防止重复点击和误操作）
        this.app.uiStateManager.disableAllControlButtons();
            
        // ✅ 禁用所有作品按钮
        this.app.uiStateManager.disableAllWorkDownloadButtons();
    
        // 设置加载状态
        this.app.isLoading = true;
    
        // 发送消息到 Content Script
        // ✅ 不再传 maxCount：加载数量由用户配置文件驱动（Content Script 侧）
        window.parent.postMessage({
            source: 'sidebar',
            type: 'LOAD_LIKED_WORKS'
        }, '*');
    }

    /**
     * 处理点赞作品列表加载完成
     */
    async handleLikedWorksLoaded(works, total, likedManager) {
        logger.info(`✅ 收到点赞列表数据: ${total} 个作品`);

        // ✅ UI 日志
        logToUI('info', `✅ 加载完成: 共 ${total} 个作品`);

        // ✅ 刷新缓存的已下载作品ID
        await this.refreshDownloadedWorkIdsCache();
        const downloadedWorkIds = this.cachedDownloadedWorkIds;
        logger.info(`📋 从缓存查询到 ${downloadedWorkIds.size} 个已下载作品`);

        // ✅ 合并下载状态到作品数据
        const worksWithStatus = works.map(work => ({
            ...work,
            isDownloaded: downloadedWorkIds.has(work.workId)
        }));

        // 统计有多少作品标记为已下载
        const downloadedCount = worksWithStatus.filter(w => w.isDownloaded).length;
        logger.info(`📊 当前列表中 ${downloadedCount}/${worksWithStatus.length} 个作品已下载`);

        // 设置数据到管理器
        likedManager.setData(worksWithStatus);

        // 初始化 DOM 元素
        likedManager.initElements();

        // ✅ 加载完成后填充「作者多选筛选」选项（按需显示）
        this.app.eventBinder?.refreshAuthorFilterOptions('liked', likedManager);
        
        // ✅ 标记列表区域有数据，扩展到300px
        const listSection = document.getElementById('listSection');
        if (listSection && works.length > 0) {
            listSection.classList.add('has-data');
            logger.info('✅ 列表区域已标记为 has-data，扩展到300px');
        }

        // ✅ 获取当前页的选中状态，传递给 updateUI
        const currentPageItems = likedManager.getCurrentPageData();
        const selectedIds = currentPageItems
            .filter(work => this.app.batchSelectionManager.state.liked.selectedWorkIds.has(work.workId))
            .map(work => work.workId);
        logger.info(`🔍 初始渲染同步 checkbox: 当前页 ${currentPageItems.length} 个作品, 选中 ${selectedIds.length} 个`);
        
        // ✅ 在渲染时直接传递选中状态，消除闪烁
        likedManager.updateUI(new Set(selectedIds));

        if (selectedIds.length > 0) {
            logger.info(`✅ 恢复了 ${selectedIds.length} 个作品的选中状态`);
        }

        // ✅ 恢复所有控制按钮
        this.app.uiStateManager.enableAllControlButtons();
        
        // ✅ 恢复作品按钮（pending/failed/error 状态变为可用）
        this.app.uiStateManager.enableAllWorkDownloadButtons();

        // 重置加载状态
        this.app.isLoading = false;

        logger.info('✅ 点赞列表渲染完成');
    }

    /**
     * ✅ 处理收藏夹作品加载完成
     */
    async handleCollectWorksLoaded(works, total, bookmarkedManager) {
        logger.info(`✅ 收到收藏列表数据: ${total} 个作品`);

        // ✅ UI 日志
        logToUI('info', `✅ 加载完成: 共 ${total} 个作品`);

        // ✅ 使用缓存的已下载作品ID；缓存未建立时先刷新（直接勾选收藏夹、未加载过点赞/关注列表时为 null，
        // 此前裸用会抛 Cannot read properties of null (reading 'size') 导致渲染中断、状态卡在“正在加载”）
        if (!this.cachedDownloadedWorkIds) {
            await this.refreshDownloadedWorkIdsCache();
        }
        const downloadedWorkIds = this.cachedDownloadedWorkIds;
        logger.info(`📋 从缓存查询到 ${downloadedWorkIds.size} 个已下载作品`);

        // ✅ 合并下载状态到作品数据
        const worksWithStatus = works.map(work => ({
            ...work,
            isDownloaded: downloadedWorkIds.has(work.workId)
        }));

        // 统计有多少作品标记为已下载
        const downloadedCount = worksWithStatus.filter(w => w.isDownloaded).length;
        logger.info(`📊 当前列表中 ${downloadedCount}/${worksWithStatus.length} 个作品已下载`);

        // 设置数据到管理器
        bookmarkedManager.setData(worksWithStatus);

        // 初始化 DOM 元素
        bookmarkedManager.initElements();

        // ✅ 加载完成后填充「作者多选筛选」选项（按需显示）
        this.app.eventBinder?.refreshAuthorFilterOptions('bookmarked', bookmarkedManager);

        // ✅ 标记列表区域有数据，扩展到300px
        const listSection = document.getElementById('listSection');
        if (listSection && works.length > 0) {
            listSection.classList.add('has-data');
            logger.info('✅ 列表区域已标记为 has-data，扩展到300px');
        }

        // ✅ 获取当前页的选中状态，传递给 updateUI
        const currentPageItems = bookmarkedManager.getCurrentPageData();
        const selectedIds = currentPageItems
            .filter(work => this.app.batchSelectionManager.state.bookmarked.selectedWorkIds.has(work.workId))
            .map(work => work.workId);
        logger.info(`🔍 初始渲染同步 checkbox: 当前页 ${currentPageItems.length} 个作品, 选中 ${selectedIds.length} 个`);

        // ✅ 在渲染时直接传递选中状态，消除闪烁
        bookmarkedManager.updateUI(new Set(selectedIds));

        if (selectedIds.length > 0) {
            logger.info(`✅ 恢复了 ${selectedIds.length} 个作品的选中状态`);
        }

        // ✅ 恢复所有控制按钮
        this.app.uiStateManager.enableAllControlButtons();
        
        // ✅ 恢复作品按钮（pending/failed/error 状态变为可用）
        this.app.uiStateManager.enableAllWorkDownloadButtons();

        // 重置加载状态
        this.app.isLoading = false;

        logger.info('✅ 收藏列表渲染完成');
    }

    /**
     * ✅ 刷新缓存的已下载作品ID（列表加载时调用）
     */
    async refreshDownloadedWorkIdsCache() {
        try {
            logger.info(`🔍 开始查询 completed_works 表...`);
            const workIds = await databaseProxy.getDownloadedWorkIds();
            this.cachedDownloadedWorkIds = new Set(workIds);
            logger.info(`📦 缓存更新: ${workIds.length} 条记录`);
        } catch (error) {
            logger.error('❌ 查询下载状态失败:', error);
            this.cachedDownloadedWorkIds = new Set();
        }
    }

    /**
     * ✅ 获取缓存的已下载作品ID（作者下载时使用）
     */
    getCachedDownloadedWorkIds() {
        return this.cachedDownloadedWorkIds || new Set();
    }

    /**
     * 批量查询已下载的作品 ID（保留兼容，但优先使用缓存）
     */
    async getDownloadedWorkIds() {
        // ✅ 如果缓存存在，直接返回
        if (this.cachedDownloadedWorkIds) {
            logger.info(`📋 使用缓存: ${this.cachedDownloadedWorkIds.size} 条记录`);
            return this.cachedDownloadedWorkIds;
        }
        
        // ❌ 缓存不存在，查询数据库并缓存
        await this.refreshDownloadedWorkIdsCache();
        return this.cachedDownloadedWorkIds;
    }

    /**
     * 刷新所有作品的下载状态（分页/搜索后调用）
     */
    /**
     * ✅ 通用列表下载状态刷新方法
     */
    async refreshListDownloadStatus(manager) {
        try {
            // ✅ 使用缓存的已下载作品ID（同样防缓存未建立时裸用 null）
            if (!this.cachedDownloadedWorkIds) {
                await this.refreshDownloadedWorkIdsCache();
            }
            const downloadedWorkIds = this.cachedDownloadedWorkIds;

            // ✅ 更新 allWorks 中每个作品的 isDownloaded 状态
            manager.allWorks.forEach(work => {
                work.isDownloaded = downloadedWorkIds.has(work.workId);
            });

            logger.info(`✅ 已刷新 ${manager.allWorks.length} 个作品的下载状态`);
        } catch (error) {
            logger.error('❌ 刷新下载状态失败:', error);
        }
    }

    /**
     * 刷新点赞作品列表的下载状态
     */
    async refreshDownloadStatus(likedManager) {
        await this.refreshListDownloadStatus(likedManager);
    }

    /**
     * ✅ 通用列表进度处理方法
     * @param {string} [label] - 可选状态栏文案覆盖（如带收藏夹名的「XX」收藏作品），缺省用类型名
     */
    handleListProgress(currentCount, totalCount, manager, label) {
        manager.initElements();
        manager.showProgress(currentCount, totalCount, label);
    }

    /**
     * 处理点赞作品列表加载进度
     */
    handleLikedWorksProgress(currentCount, totalCount, likedManager) {
        this.handleListProgress(currentCount, totalCount, likedManager);
    }

    /**
     * ✅ 处理收藏作品列表加载进度
     * 两个发送源：main.js 直接带 collectName；data-fetcher 通用进度只带 collectId，
     * 此处从收藏夹选择器已加载的 dataList 反查名称
     */
    handleCollectWorksProgress(collectName, currentCount, totalCount, collectId, bookmarkedManager) {
        if (!collectName && collectId) {
            const item = (this.app.collectsSelector?.dataList || []).find(c => c.collectId === collectId);
            collectName = item && item.collectName;
        }

        // ✅ UI 日志（显示收藏夹名称，无名称时回退通用文案）
        const progressMsg = collectName
            ? `📂 正在加载「${collectName}」作品... (已加载 ${currentCount} 个)`
            : `📂 正在加载收藏作品... (已加载 ${currentCount} 个)`;
        logToUI('info', progressMsg);
        logger.info(progressMsg);

        // ✅ 显示进度条（状态栏同步带收藏夹名）
        const label = collectName ? `「${collectName}」收藏作品` : undefined;
        this.handleListProgress(currentCount, totalCount, bookmarkedManager, label);
    }

    /**
     * ✅ 通用列表错误处理方法
     */
    handleListError(error, manager) {
        logger.error('❌ 列表加载失败:', error);

        // ✅ UI 日志
        logToUI('error', `❌ 加载失败: ${error}`);

        manager.initElements();
        manager.showError(error);

        // ✅ 恢复所有控制按钮
        this.app.uiStateManager.enableAllControlButtons();
        
        // ✅ 恢复作品按钮
        this.app.uiStateManager.enableAllWorkDownloadButtons();

        // 重置加载状态
        this.app.isLoading = false;
    }

    /**
     * 处理点赞作品列表加载错误
     */
    handleLikedWorksError(error, likedManager) {
        this.handleListError(error, likedManager);
    }

    /**
     * ✅ 处理收藏作品列表加载错误
     */
    handleCollectWorksError(error, bookmarkedManager) {
        this.handleListError(error, bookmarkedManager);
    }

    /**
     * 清空点赞列表
     */
    clearLikedList(likedManager) {
        if (likedManager.elements.list) {
            likedManager.elements.list.innerHTML = '';
        }
    }
    
    /**
     * ✅ 清空收藏列表
     */
    clearBookmarkedList(bookmarkedManager) {
        if (bookmarkedManager.elements.list) {
            bookmarkedManager.elements.list.innerHTML = '';
        }
    }
    
    /**
     * ✅ 处理加载关注作者列表请求
     */
    handleLoadFollowingAuthors() {
        logger.info('🔄 开始加载关注列表...');
    
        // 检查是否已选择文件夹
        if (!this.app.folderSelected) {
            logger.error('❌ 请先选择文件夹');
            alert('请先点击“选择文件夹”按钮');
            return;
        }
    
        // ✅ 禁用所有控制按钮（防止重复点击和误操作）
        this.app.uiStateManager.disableAllControlButtons();
            
        // ✅ 禁用所有作品按钮
        this.app.uiStateManager.disableAllWorkDownloadButtons();
    
        // 设置加载状态
        this.app.isLoading = true;
    
        // 发送消息到 Content Script
        // ✅ 不再传 maxCount：加载数量由用户配置文件驱动（Content Script 侧）
        window.parent.postMessage({
            source: 'sidebar',
            type: 'LOAD_FOLLOWING_AUTHORS'
        }, '*');
    }
    
    /**
     * ✅ 处理关注作者列表加载完成
     */
    async handleFollowingAuthorsLoaded(authors, total, followingManager) {
        logger.info(`✅ 收到关注列表数据: ${total} 个作者`);

        // ✅ UI 日志
        logToUI('info', `✅ 加载完成: 共 ${total} 个作者`);

        // ✅ 刷新缓存的已下载作品ID（供作者下载使用）
        await this.refreshDownloadedWorkIdsCache();

        // 设置数据到管理器
        followingManager.setData(authors);

        // 初始化 DOM 元素
        followingManager.initElements();
        
        // ✅ 获取当前页的选中状态，传递给 updateUI
        const currentPageItems = followingManager.getCurrentPageData();
        const selectedIds = currentPageItems
            .filter(author => this.app.batchSelectionManager.state.following.selectedAuthorIds.has(author.uid))
            .map(author => author.uid);
        logger.info(`🔍 初始渲染同步 checkbox: 当前页 ${currentPageItems.length} 个作者, 选中 ${selectedIds.length} 个`);
        
        // ✅ 在渲染时直接传递选中状态，消除闪烁
        followingManager.updateUI(new Set(selectedIds));
        
        if (selectedIds.length > 0) {
            logger.info(`✅ 恢复了 ${selectedIds.length} 个作者的选中状态`);
        }
        
        // ✅ 标记列表区域有数据，扩展到300px
        const listSection = document.getElementById('listSection');
        if (listSection && authors.length > 0) {
            listSection.classList.add('has-data');
            logger.info('✅ 列表区域已标记为 has-data，扩展到300px');
        }

        // ✅ 恢复所有控制按钮
        this.app.uiStateManager.enableAllControlButtons();
        
        // ✅ 恢复作品按钮（pending/failed/error 状态变为可用）
        this.app.uiStateManager.enableAllWorkDownloadButtons();

        // 重置加载状态
        this.app.isLoading = false;

        // ✅ 异步拉取实时下载计数校正「已存 x/y」（relations∩completed_works，
        // 覆盖钻取/单卡保存不累加派生字段的场景），不阻塞首次渲染
        this.app.authorDownloadManager?.requestAuthorStatuses(authors.map(a => a.uid));

        logger.info('✅ 关注列表渲染完成');
    }
    
    /**
     * ✅ 处理关注作者列表加载进度
     */
    handleFollowingAuthorsProgress(currentCount, totalCount, followingManager) {
        logger.info(`📈 关注列表加载进度: ${currentCount}/${totalCount}`);
        
        // ✅ UI 日志
        logToUI('info', `📈 加载进度: ${currentCount}/${totalCount}`);
        
        // ✅ 显示进度条（与点赞/收藏列表保持一致）
        followingManager.initElements();
        followingManager.showProgress(currentCount, totalCount);
    }
    
    /**
     * ✅ 处理关注作者列表加载错误
     */
    handleFollowingAuthorsError(error, followingManager) {
        this.handleListError(error, followingManager);
    }

    /**
     * 处理加载数据开始
     */
    handleLoadDataStart(listType) {
        logger.info(`🔄 开始加载 ${listType} 列表...`);

        // ✅ UI 日志
        const typeNames = {
            'liked': '点赞',
            'bookmarked': '收藏',
            'following': '关注'
        };
        const typeName = typeNames[listType] || listType;
        logToUI('info', `🔄 开始加载${typeName}列表...`);
    }
}

export { ListDisplayManager };
