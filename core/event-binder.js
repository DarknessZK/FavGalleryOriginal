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
        this.bindLoadLikedWorks();
        
        // 3.5. 刷新收藏列表
        this.bindLoadBookmarkedWorks();

        // 4. 点赞列表搜索
        this.bindLikedSearch();

        // 4.5. ✅ 收藏列表搜索
        this.bindBookmarkedSearch();

        // 5. 点赞列表分页
        this.bindLikedPagination();

        // 5.5. ✅ 收藏列表分页
        this.bindBookmarkedPagination();

        // 6. 作品卡片单个下载（事件委托）
        this.bindWorkCardActions();

        // 7. 点赞列表批量操作
        this.bindLikedBatchOperations();

        // 8. 收藏列表批量操作（预留）
        this.bindBookmarkedBatchOperations();

        // 9. 关注列表批量操作（预留）
        this.bindFollowingBatchOperations();
        
        // 10. 日志区域折叠/展开
        this.bindLogToggle();

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
        } else {
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
        } else {
        }

        if (tabLiked) {
            tabLiked.addEventListener('click', () => {
                logger.info('👆 点击了点赞列表 Tab');
                logToUI('info', '🔄 切换到点赞列表');
                this.app.tabManager.switchTab('liked');
            });
        } else {
        }

        if (tabBookmarked) {
            tabBookmarked.addEventListener('click', () => {
                logger.info('👆 点击了收藏列表 Tab');
                logToUI('info', '🔄 切换到收藏列表');
                this.app.tabManager.switchTab('bookmarked');
            });
        } else {
        }
    }

    /**
     * 绑定刷新点赞列表按钮
     */
    bindLoadLikedWorks() {
        const loadLikedBtn = document.getElementById('loadLiked');
        if (loadLikedBtn) {
            loadLikedBtn.addEventListener('click', () => {
                this.app.handleLoadLikedWorks();
            });
        } else {
        }
    }
    
    /**
     * ✅ 绑定刷新收藏列表按钮
     */
    bindLoadBookmarkedWorks() {
        const loadBookmarkedBtn = document.getElementById('loadBookmarked');
        if (loadBookmarkedBtn) {
            loadBookmarkedBtn.addEventListener('click', () => {
                logger.info('📋 请求加载收藏夹列表...');
                
                // ✅ 禁用所有控制按钮（防止重复点击和误操作）
                this.app.uiStateManager.disableAllControlButtons();
                
                // ✅ 禁用所有作品按钮
                this.app.uiStateManager.disableAllWorkDownloadButtons();
                
                // 发送消息到 Content Script
                window.parent.postMessage({
                    source: 'sidebar',
                    type: 'LOAD_COLLECTS_LIST'
                }, '*');
            });
        } else {
        }
    }
    
    /**
     * ✅ 绑定刷新关注列表按钮
     */
    bindLoadFollowingAuthors() {
        const loadFollowingBtn = document.getElementById('loadFollowing');
        if (loadFollowingBtn) {
            loadFollowingBtn.addEventListener('click', () => {
                logger.info('👥 请求加载关注列表...');
                this.app.handleLoadFollowingAuthors();
            });
        } else {
            logger.warn('⚠️ 未找到 loadFollowing 按钮元素');
        }
    }

    /**
     * 绑定点赞列表搜索框
     */
    bindLikedSearch() {
        const likedSearchInput = document.getElementById('likedSearchInput');
        if (likedSearchInput) {
            this._bindSearchInput(likedSearchInput, 'liked');
        }
    }
    
    /**
     * ✅ 绑定收藏列表搜索框
     */
    bindBookmarkedSearch() {
        const bookmarkedSearchInput = document.getElementById('bookmarkedSearchInput');
        if (bookmarkedSearchInput) {
            this._bindSearchInput(bookmarkedSearchInput, 'bookmarked');
        }
    }
    
    /**
     * ✅ 通用搜索框绑定方法（支持点赞和收藏）
     * @param {HTMLElement} searchInput - 搜索输入框元素
     * @param {string} listType - 列表类型 ('liked' | 'bookmarked')
     */
    _bindSearchInput(searchInput, listType) {
        let searchTimer = null;
        searchInput.addEventListener('input', async (event) => {
            clearTimeout(searchTimer);
            searchTimer = setTimeout(async () => {
                // ✅ 根据列表类型选择对应的 Manager
                const manager = listType === 'liked' ? this.app.likedManager : this.app.bookmarkedManager;
                    
                manager.initElements();
                manager.search(event.target.value);
                
                // ✅ 重新查询下载状态并更新 allWorks
                await this.app.refreshListDownloadStatus(manager);
    
                // ✅ 获取当前页的选中状态，传递给 updateUI
                const currentPageItems = manager.getCurrentPageData();
                const selectedIds = currentPageItems
                    .filter(work => this.app.batchSelectionManager.state[listType].selectedWorkIds.has(work.workId))
                    .map(work => work.workId);
                logger.info(`🔍 搜索后同步 checkbox: 当前页 ${currentPageItems.length} 个作品, 选中 ${selectedIds.length} 个`);
                logger.info(`🔍 内存中的选中状态: ${this.app.batchSelectionManager.state[listType].selectedWorkIds.size} 个`);
    
                // ✅ 在渲染时直接传递选中状态，消除闪烁
                manager.updateUI(new Set(selectedIds));
            }, 300);
        });
    }

    /**
     * ✅ 通用分页按钮绑定方法
     * @param {string} listType - 列表类型 ('liked' | 'bookmarked')
     */
    _bindPagination(listType) {
        const prefix = listType === 'liked' ? 'liked' : 'bookmarked';
        const prevBtn = document.getElementById(`${prefix}PrevPage`);
        const nextBtn = document.getElementById(`${prefix}NextPage`);
        const manager = listType === 'liked' ? this.app.likedManager : this.app.bookmarkedManager;
    
        if (prevBtn) {
            prevBtn.addEventListener('click', async () => {
                manager.initElements();
                manager.prevPage();
    
                // ✅ 重新查询下载状态并更新 allWorks
                await this.app.refreshListDownloadStatus(manager);
    
                // ✅ UI 日志
                logToUI('info', `⬅️ 切换到第 ${manager.currentPage} 页`);
    
                // ✅ 获取当前页的选中状态，传递给 updateUI
                const currentPageItems = manager.getCurrentPageData();
                const selectedIds = currentPageItems
                    .filter(work => this.app.batchSelectionManager.state[listType].selectedWorkIds.has(work.workId))
                    .map(work => work.workId);
                logger.info(`🔍 分页后同步 checkbox: 当前页 ${currentPageItems.length} 个作品, 选中 ${selectedIds.length} 个`);
                logger.info(`🔍 内存中的选中状态: ${this.app.batchSelectionManager.state[listType].selectedWorkIds.size} 个`);
    
                // ✅ 在渲染时直接传递选中状态，消除闪烁
                manager.updateUI(new Set(selectedIds));
            });
        }
    
        if (nextBtn) {
            nextBtn.addEventListener('click', async () => {
                manager.initElements();
                manager.nextPage();
    
                // ✅ 重新查询下载状态并更新 allWorks
                await this.app.refreshListDownloadStatus(manager);
    
                // ✅ UI 日志
                logToUI('info', `➡️ 切换到第 ${manager.currentPage} 页`);
    
                // ✅ 获取当前页的选中状态，传递给 updateUI
                const currentPageItems = manager.getCurrentPageData();
                const selectedIds = currentPageItems
                    .filter(work => this.app.batchSelectionManager.state[listType].selectedWorkIds.has(work.workId))
                    .map(work => work.workId);
                logger.info(`🔍 分页后同步 checkbox: 当前页 ${currentPageItems.length} 个作品, 选中 ${selectedIds.length} 个`);
                logger.info(`🔍 内存中的选中状态: ${this.app.batchSelectionManager.state[listType].selectedWorkIds.size} 个`);
    
                // ✅ 在渲染时直接传递选中状态，消除闪烁
                manager.updateUI(new Set(selectedIds));
            });
        }
    }
    
    /**
     * 绑定点赞列表分页按钮
     */
    bindLikedPagination() {
        this._bindPagination('liked');
    }
    
    /**
     * ✅ 绑定收藏列表分页按钮
     */
    bindBookmarkedPagination() {
        this._bindPagination('bookmarked');
    }

    /**
     * 绑定作品卡片操作（事件委托）
     */
    bindWorkCardActions() {
        // ✅ 点赞列表
        const likedList = document.getElementById('likedList');
        if (likedList) {
            this._bindListEvents(likedList, 'liked');
        }
            
        // ✅ 收藏列表
        const bookmarkedList = document.getElementById('bookmarkedList');
        if (bookmarkedList) {
            this._bindListEvents(bookmarkedList, 'bookmarked');
        }
    }
        
    /**
     * ✅ 绑定单个列表的事件（通用方法）
     * @param {HTMLElement} listElement - 列表容器
     * @param {string} listType - 列表类型 ('liked' | 'bookmarked')
     */
    _bindListEvents(listElement, listType) {
        listElement.addEventListener('click', (event) => {
            // ✅ 优先级 1: 检查是否点击下载按钮
            const downloadBtn = event.target.closest('.download-btn');
            if (downloadBtn && !downloadBtn.disabled) {
                const workId = downloadBtn.dataset.workId;
                logger.info(`👆 点击了下载按钮: ${workId}`);
                this.app.handleSingleWorkDownload(workId);
                return;  // ✅ 阻止后续处理
            }
    
            // ✅ 优先级 2: 检查是否点击跳转链接
            const jumpBtn = event.target.closest('.jump-btn');
            if (jumpBtn) {
                // a 标签默认行为即可，不需要额外处理
                return;  // ✅ 阻止后续处理
            }
    
            // ✅ 优先级 3: 检查是否点击复选框
            const checkbox = event.target.closest('.work-checkbox');
            if (checkbox) {
                const workId = checkbox.dataset.workId;
                logger.info(`☑️ 复选框状态变化: ${workId}, checked=${checkbox.checked}`);
                this.app.batchSelectionManager.handleCheckboxChange(listType, workId, checkbox.checked);
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
                    this.app.batchSelectionManager.handleCheckboxChange(listType, workId, cardCheckbox.checked);
                }
                return;  // ✅ 阻止后续处理
            }
        });
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
        }

        if (likedBatchDownloadBtn) {
            likedBatchDownloadBtn.addEventListener('click', () => {
                this.app.handleBatchDownload('liked');
            });
        }

        if (likedStopDownloadBtn) {
            likedStopDownloadBtn.addEventListener('click', () => {
                this.app.handleStopDownload('liked');
            });
        }
    }

    /**
     * 绑定收藏列表批量操作（预留）
     */
    bindBookmarkedBatchOperations() {
        const bookmarkedBatchSelect = document.getElementById('bookmarkedBatchSelect');
        const bookmarkedBatchDownloadBtn = document.querySelector('.batch-download-btn[data-type="bookmarked"]');
        const bookmarkedStopDownloadBtn = document.querySelector('#tabContentBookmarked .stop-download-btn');

        if (bookmarkedBatchSelect) {
            bookmarkedBatchSelect.addEventListener('change', (event) => {
                this.app.handleBatchSelectionChange('bookmarked', event.target.value);
            });
        }

        if (bookmarkedBatchDownloadBtn) {
            bookmarkedBatchDownloadBtn.addEventListener('click', () => {
                this.app.handleBatchDownload('bookmarked');
            });
        }

        if (bookmarkedStopDownloadBtn) {
            bookmarkedStopDownloadBtn.addEventListener('click', () => {
                this.app.handleStopDownload('bookmarked');
            });
        }
    }

    /**
     * 绑定关注列表批量操作（预留）
     */
    bindFollowingBatchOperations() {
        const followingBatchSelect = document.getElementById('followingBatchSelect');
        const followingBatchDownloadBtn = document.querySelector('.batch-download-btn[data-type="following"]');
        const followingStopDownloadBtn = document.querySelector('#tabContentFollowing .stop-download-btn');

        if (followingBatchSelect) {
            followingBatchSelect.addEventListener('change', (event) => {
                this.app.handleBatchSelectionChange('following', event.target.value);
            });
        }

        if (followingBatchDownloadBtn) {
            followingBatchDownloadBtn.addEventListener('click', () => {
                this.app.handleBatchDownload('following');
            });
        }

        if (followingStopDownloadBtn) {
            followingStopDownloadBtn.addEventListener('click', () => {
                this.app.handleStopDownload('following');
            });
        }
    }
    
    /**
     * ✅ 绑定日志区域折叠/展开按钮
     */
    bindLogToggle() {
        const toggleLogBtn = document.getElementById('toggleLogBtn');
        const logHeader = document.getElementById('logHeader');
        const logSection = document.getElementById('logSection');
        
        if (toggleLogBtn && logHeader && logSection) {
            // 点击按钮或标题都可以折叠/展开
            const toggleLog = () => {
                logSection.classList.toggle('collapsed');
                const isCollapsed = logSection.classList.contains('collapsed');
                
                // 更新按钮图标
                toggleLogBtn.textContent = isCollapsed ? '▲' : '▼';
                
                logger.info(`📝 日志区域${isCollapsed ? '向下收起' : '展开'}`);
            };
            
            toggleLogBtn.addEventListener('click', (e) => {
                e.stopPropagation(); // 防止触发标题的点击事件
                toggleLog();
            });
            
            logHeader.addEventListener('click', toggleLog);
            
        } else {
        }
    }
}

export { EventBinder };
