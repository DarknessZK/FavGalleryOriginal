// ==========================================
// FavGallery - 列表显示管理器
// 职责：封装列表显示相关的业务逻辑（加载、进度、错误、下载状态查询）
// 注意：不持有 WorkListManager 实例，而是接收它作为参数
// ==========================================

import { createLogger, logToUI } from '../utils/logger.js';
import { database } from '../data/index.js';
import { CONFIG } from '../config/constants.js';

const logger = createLogger('ListDisplayManager');

class ListDisplayManager {
    constructor(app) {
        this.app = app;
    }

    /**
     * 处理加载点赞作品列表请求
     */
    handleLoadLikedVideos() {
        logger.info('🔄 开始加载点赞列表...');

        // 检查是否已选择文件夹
        if (!this.app.folderSelected) {
            logger.error('❌ 请先选择文件夹');
            alert('请先点击“选择文件夹”按钮');
            return;
        }

        // 设置加载状态
        this.app.isLoading = true;

        // 发送消息到 Content Script
        window.parent.postMessage({
            source: 'sidebar',
            type: 'LOAD_LIKED_WORKS',
            maxCount: CONFIG.FETCH_CONFIG.LIST_DEFAULTS.LIKED
        }, '*');

        // 显示加载状态
        const statusDiv = document.getElementById('likedStatus');
        if (statusDiv) {
            statusDiv.textContent = '加载中...';
            statusDiv.style.color = '#1890ff';
        }
    }

    /**
     * 处理点赞作品列表加载完成
     */
    async handleLikedWorksLoaded(works, total, likedManager) {
        logger.info(`✅ 收到点赞列表数据: ${total} 个作品`);

        // ✅ UI 日志
        logToUI('info', `✅ 加载完成: 共 ${total} 个作品`);

        // ✅ 批量查询下载状态
        const downloadedWorkIds = await this.getDownloadedWorkIds();
        logger.info(`📋 从数据库查询到 ${downloadedWorkIds.size} 个已下载作品`);

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

        // 重置加载状态
        this.app.isLoading = false;

        logger.info('✅ 点赞列表渲染完成');
    }

    /**
     * 批量查询已下载的作品 ID
     */
    async getDownloadedWorkIds() {
        try {
            logger.info(`🔍 开始查询 completed_works 表...`);
            const completedWorks = await database.getAll('completed_works');
            logger.info(`📦 查询结果: ${completedWorks.length} 条记录`, completedWorks.map(w => w.workId));
            return new Set(completedWorks.map(w => w.workId));
        } catch (error) {
            logger.error('❌ 查询下载状态失败:', error);
            return new Set();
        }
    }

    /**
     * 刷新所有作品的下载状态（分页/搜索后调用）
     */
    async refreshDownloadStatus(likedManager) {
        try {
            const downloadedWorkIds = await this.getDownloadedWorkIds();

            // ✅ 更新 allWorks 中每个作品的 isDownloaded 状态
            likedManager.allWorks.forEach(work => {
                work.isDownloaded = downloadedWorkIds.has(work.workId);
            });

            logger.info(`✅ 已刷新 ${likedManager.allWorks.length} 个作品的下载状态`);
        } catch (error) {
            logger.error('❌ 刷新下载状态失败:', error);
        }
    }

    /**
     * 处理点赞作品列表加载进度
     */
    handleLikedWorksProgress(currentCount, totalCount, likedManager) {
        likedManager.initElements();
        likedManager.showProgress(currentCount, totalCount);
    }

    /**
     * 处理点赞作品列表加载错误
     */
    handleLikedWorksError(error, likedManager) {
        logger.error('❌ 点赞列表加载失败:', error);

        // ✅ UI 日志
        logToUI('error', `❌ 加载失败: ${error}`);

        likedManager.initElements();
        likedManager.showError(error);

        // 重置加载状态
        this.app.isLoading = false;
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
