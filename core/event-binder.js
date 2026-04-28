// ==========================================
// FavGallery - DOM 事件绑定器
// 职责：统一管理所有 DOM 事件绑定（按钮点击、Tab 切换、搜索、分页、批量操作等）
// ==========================================

import { createLogger, logToUI } from '../utils/logger.js';

const logger = createLogger('EventBinder');

class EventBinder {
    constructor(app) {
        this.app = app;
    }

    /**
     * 绑定所有 DOM 事件
     */
    bind() {
        logger.info('🔗 开始绑定 DOM 事件...');

        // 1. 选择文件夹
        this.bindSelectFolder();

        // 2. Tab 切换
        this.bindTabSwitching();

        // 3. 刷新点赞列表
        this.bindLoadLikedVideos();

        // 4. 点赞列表搜索
        this.bindLikedSearch();

        // 5. 点赞列表分页
        this.bindLikedPagination();

        // 6. 作品卡片单个下载（事件委托）
        this.bindWorkCardActions();

        // 7. 点赞列表批量操作
        this.bindLikedBatchOperations();

        // 8. 收藏列表批量操作（预留）
        this.bindBookmarkedBatchOperations();

        // 9. 关注列表批量操作（预留）
        this.bindFollowingBatchOperations();

        logger.info('✅ DOM 事件绑定完成');
    }

    /**
     * 绑定选择文件夹按钮
     */
    bindSelectFolder() {
        const selectFolderBtn = document.getElementById('selectFolder');
        if (selectFolderBtn) {
            selectFolderBtn.addEventListener('click', () => {
                this.app.handleSelectFolder();
            });
            logger.info('✅ 已绑定: 选择文件夹按钮');
        } else {
            logger.warn('⚠️ 未找到元素: selectFolder');
        }
    }

    /**
     * 绑定 Tab 切换事件
     */
    bindTabSwitching() {
        const tabFollowing = document.getElementById('tabFollowing');
        const tabLiked = document.getElementById('tabLiked');
        const tabBookmarked = document.getElementById('tabBookmarked');

        logger.info('📑 Tab 元素检查:', {
            tabFollowing: !!tabFollowing,
            tabLiked: !!tabLiked,
            tabBookmarked: !!tabBookmarked
        });

        if (tabFollowing) {
            tabFollowing.addEventListener('click', () => {
                logger.info('👆 点击了关注列表 Tab');
                logToUI('info', '🔄 切换到关注列表');
                this.app.tabManager.switchTab('following');
            });
            logger.info('✅ 已绑定: 关注列表 Tab');
        } else {
            logger.warn('⚠️ 未找到元素: tabFollowing');
        }

        if (tabLiked) {
            tabLiked.addEventListener('click', () => {
                logger.info('👆 点击了点赞列表 Tab');
                logToUI('info', '🔄 切换到点赞列表');
                this.app.tabManager.switchTab('liked');
            });
            logger.info('✅ 已绑定: 点赞列表 Tab');
        } else {
            logger.warn('⚠️ 未找到元素: tabLiked');
        }

        if (tabBookmarked) {
            tabBookmarked.addEventListener('click', () => {
                logger.info('👆 点击了收藏列表 Tab');
                logToUI('info', '🔄 切换到收藏列表');
                this.app.tabManager.switchTab('bookmarked');
            });
            logger.info('✅ 已绑定: 收藏列表 Tab');
        } else {
            logger.warn('⚠️ 未找到元素: tabBookmarked');
        }
    }

    /**
     * 绑定刷新点赞列表按钮
     */
    bindLoadLikedVideos() {
        const loadLikedBtn = document.getElementById('loadLiked');
        if (loadLikedBtn) {
            loadLikedBtn.addEventListener('click', () => {
                this.app.handleLoadLikedVideos();
            });
            logger.info('✅ 已绑定: 刷新点赞列表按钮');
        } else {
            logger.warn('⚠️ 未找到元素: loadLiked');
        }
    }

    /**
     * 绑定点赞列表搜索框
     */
    bindLikedSearch() {
        const likedSearchInput = document.getElementById('likedSearchInput');
        if (likedSearchInput) {
            let searchTimer = null;
            likedSearchInput.addEventListener('input', async (event) => {
                clearTimeout(searchTimer);
                searchTimer = setTimeout(async () => {
                    this.app.likedManager.initElements();
                    this.app.likedManager.search(event.target.value);

                    // ✅ 重新查询下载状态并更新 allWorks
                    await this.app.refreshDownloadStatus();

                    // ✅ 获取当前页的选中状态，传递给 updateUI
                    const currentPageItems = this.app.likedManager.getCurrentPageData();
                    const selectedIds = currentPageItems
                        .filter(work => this.app.batchSelectionManager.state.liked.selectedWorkIds.has(work.workId))
                        .map(work => work.workId);
                    logger.info(`🔍 搜索后同步 checkbox: 当前页 ${currentPageItems.length} 个作品, 选中 ${selectedIds.length} 个`);
                    logger.info(`🔍 内存中的选中状态: ${this.app.batchSelectionManager.state.liked.selectedWorkIds.size} 个`);
                    
                    // ✅ 在渲染时直接传递选中状态，消除闪烁
                    this.app.likedManager.updateUI(new Set(selectedIds));
                }, 300);
            });
            logger.info('✅ 已绑定: 点赞列表搜索框');
        } else {
            logger.warn('⚠️ 未找到元素: likedSearchInput');
        }
    }

    /**
     * 绑定点赞列表分页按钮
     */
    bindLikedPagination() {
        const likedPrevBtn = document.getElementById('likedPrevPage');
        const likedNextBtn = document.getElementById('likedNextPage');

        if (likedPrevBtn) {
            likedPrevBtn.addEventListener('click', async () => {
                this.app.likedManager.initElements();
                this.app.likedManager.prevPage();

                // ✅ 重新查询下载状态并更新 allWorks
                await this.app.refreshDownloadStatus();

                // ✅ UI 日志
                logToUI('info', `⬅️ 切换到第 ${this.app.likedManager.currentPage} 页`);

                // ✅ 获取当前页的选中状态，传递给 updateUI
                const currentPageItems = this.app.likedManager.getCurrentPageData();
                const selectedIds = currentPageItems
                    .filter(work => this.app.batchSelectionManager.state.liked.selectedWorkIds.has(work.workId))
                    .map(work => work.workId);
                logger.info(`🔍 分页后同步 checkbox: 当前页 ${currentPageItems.length} 个作品, 选中 ${selectedIds.length} 个`);
                logger.info(`🔍 内存中的选中状态: ${this.app.batchSelectionManager.state.liked.selectedWorkIds.size} 个`);
                
                // ✅ 在渲染时直接传递选中状态，消除闪烁
                this.app.likedManager.updateUI(new Set(selectedIds));
            });
            logger.info('✅ 已绑定: 点赞列表上一页按钮');
        } else {
            logger.warn('⚠️ 未找到元素: likedPrevPage');
        }

        if (likedNextBtn) {
            likedNextBtn.addEventListener('click', async () => {
                this.app.likedManager.initElements();
                this.app.likedManager.nextPage();

                // ✅ 重新查询下载状态并更新 allWorks
                await this.app.refreshDownloadStatus();

                // ✅ UI 日志
                logToUI('info', `➡️ 切换到第 ${this.app.likedManager.currentPage} 页`);

                // ✅ 获取当前页的选中状态，传递给 updateUI
                const currentPageItems = this.app.likedManager.getCurrentPageData();
                const selectedIds = currentPageItems
                    .filter(work => this.app.batchSelectionManager.state.liked.selectedWorkIds.has(work.workId))
                    .map(work => work.workId);
                logger.info(`🔍 分页后同步 checkbox: 当前页 ${currentPageItems.length} 个作品, 选中 ${selectedIds.length} 个`);
                logger.info(`🔍 内存中的选中状态: ${this.app.batchSelectionManager.state.liked.selectedWorkIds.size} 个`);
                
                // ✅ 在渲染时直接传递选中状态，消除闪烁
                this.app.likedManager.updateUI(new Set(selectedIds));
            });
            logger.info('✅ 已绑定: 点赞列表下一页按钮');
        } else {
            logger.warn('⚠️ 未找到元素: likedNextPage');
        }
    }

    /**
     * 绑定作品卡片操作（事件委托）
     */
    bindWorkCardActions() {
        const likedList = document.getElementById('likedList');
        if (likedList) {
            likedList.addEventListener('click', (event) => {
                // ✅ 优先级 1: 检查是否点击了下载按钮
                const downloadBtn = event.target.closest('.download-btn');
                if (downloadBtn && !downloadBtn.disabled) {
                    const workId = downloadBtn.dataset.workId;
                    logger.info(`👆 点击了下载按钮: ${workId}`);
                    this.app.handleSingleWorkDownload(workId);
                    return;  // ✅ 阻止后续处理
                }

                // ✅ 优先级 2: 检查是否点击了跳转链接
                const jumpBtn = event.target.closest('.jump-btn');
                if (jumpBtn) {
                    // a 标签默认行为即可，不需要额外处理
                    return;  // ✅ 阻止后续处理
                }

                // ✅ 优先级 3: 检查是否点击了复选框
                const checkbox = event.target.closest('.work-checkbox');
                if (checkbox) {
                    const workId = checkbox.dataset.workId;
                    logger.info(`☑️ 复选框状态变化: ${workId}, checked=${checkbox.checked}`);
                    this.app.batchSelectionManager.handleCheckboxChange('liked', workId, checkbox.checked);
                    return;  // ✅ 阻止后续处理
                }

                // ✅ 优先级 4: 点击卡片任意位置，切换复选框状态
                const workItem = event.target.closest('.work-item');
                if (workItem) {
                    const workId = workItem.dataset.workId;
                    const cardCheckbox = workItem.querySelector('.work-checkbox');

                    if (cardCheckbox && !cardCheckbox.disabled) {
                        // 切换复选框状态
                        cardCheckbox.checked = !cardCheckbox.checked;

                        // 触发 change 事件（手动）
                        logger.info(`☑️ 点击卡片切换复选框: ${workId}, checked=${cardCheckbox.checked}`);
                        this.app.batchSelectionManager.handleCheckboxChange('liked', workId, cardCheckbox.checked);
                    }
                    return;  // ✅ 阻止后续处理
                }
            });
            logger.info('✅ 已绑定: 作品卡片下载、跳转、复选框和卡片点击（事件委托）');
        } else {
            logger.warn('⚠️ 未找到元素: likedList');
        }
    }

    /**
     * 绑定点赞列表批量操作
     */
    bindLikedBatchOperations() {
        const likedBatchSelect = document.getElementById('likedBatchSelect');
        const likedBatchDownloadBtn = document.querySelector('.batch-download-btn[data-type="liked"]');
        const likedStopDownloadBtn = document.querySelector('#tabContentLiked .stop-download-btn');

        if (likedBatchSelect) {
            likedBatchSelect.addEventListener('change', (event) => {
                this.app.handleBatchSelectionChange('liked', event.target.value);
            });
            logger.info('✅ 已绑定: 点赞列表批量选择下拉框');
        }

        if (likedBatchDownloadBtn) {
            likedBatchDownloadBtn.addEventListener('click', () => {
                this.app.handleBatchDownload('liked');
            });
            logger.info('✅ 已绑定: 点赞列表批量下载按钮');
        }

        if (likedStopDownloadBtn) {
            likedStopDownloadBtn.addEventListener('click', () => {
                this.app.handleStopDownload('liked');
            });
            logger.info('✅ 已绑定: 点赞列表停止下载按钮');
        }
    }

    /**
     * 绑定收藏列表批量操作（预留）
     */
    bindBookmarkedBatchOperations() {
        const bookmarkedBatchSelect = document.getElementById('bookmarkedBatchSelect');
        if (bookmarkedBatchSelect) {
            bookmarkedBatchSelect.addEventListener('change', (event) => {
                this.app.handleBatchSelectionChange('bookmarked', event.target.value);
            });
            logger.info('✅ 已绑定: 收藏列表批量选择下拉框');
        }
    }

    /**
     * 绑定关注列表批量操作（预留）
     */
    bindFollowingBatchOperations() {
        const followingBatchSelect = document.getElementById('followingBatchSelect');
        if (followingBatchSelect) {
            followingBatchSelect.addEventListener('change', (event) => {
                this.app.handleBatchSelectionChange('following', event.target.value);
            });
            logger.info('✅ 已绑定: 关注列表批量选择下拉框');
        }
    }
}

export { EventBinder };
