// ==========================================
// FavGallery - 批量选择管理器
// 功能：管理批量选择状态、同步 checkbox、更新 UI
// ==========================================

import { createLogger } from '../utils/logger.js';

const logger = createLogger('BatchSelectionManager');

class BatchSelectionManager {
    constructor(app) {
        this.app = app;
        
        // ✅ 批量选择状态（按列表类型管理）
        this.state = {
            liked: {
                selectedWorkIds: new Set(),
                selectAll: false,
                totalCount: 0
            },
            bookmarked: {
                selectedWorkIds: new Set(),
                selectAll: false,
                totalCount: 0
            },
            following: {
                selectedAuthorIds: new Set(),
                selectAll: false,
                totalCount: 0
            }
        };
    }

    /**
     * 处理单个 checkbox 变化
     */
    handleCheckboxChange(listType, itemId, checked) {
        console.log('[DEBUG] handleCheckboxChange:', listType, itemId, checked);
        
        const state = this.state[listType];
        if (!state) {
            logger.warn(`⚠️ 未知的列表类型: ${listType}`);
            return;
        }
        
        logger.info(`🔍 handleCheckboxChange: listType=${listType}, itemId=${itemId}, checked=${checked}`);
        
        // ✅ 更新选中状态
        if (checked) {
            if (listType === 'following') {
                state.selectedAuthorIds.add(itemId);
            } else {
                state.selectedWorkIds.add(itemId);
            }
        } else {
            if (listType === 'following') {
                state.selectedAuthorIds.delete(itemId);
            } else {
                state.selectedWorkIds.delete(itemId);
            }
            state.selectAll = false;
        }
        
        // ✅ 记录修改后的状态
        const currentCount = listType === 'following' ? state.selectedAuthorIds.size : state.selectedWorkIds.size;
        logger.info(`🔍 修改后选中数量: ${currentCount}`);
        
        // ✅ 更新 UI
        this.updateBatchSelectionUI(listType);
        
        logger.info(`📋 批量选择状态: ${listType}, 已选 ${this.getSelectedCount(listType)} 个`);
    }

    /**
     * 处理批量选择下拉框变化
     */
    handleBatchSelectionChange(listType, selectionType) {
        console.log('[DEBUG] handleBatchSelectionChange:', listType, selectionType);
        console.log('[DEBUG] before - selectedAuthorIds:', Array.from(this.state.following?.selectedAuthorIds || []));
        
        const state = this.state[listType];
        if (!state) {
            logger.warn(`⚠️ 未知的列表类型: ${listType}`);
            return;
        }
        
        // ✅ 获取当前列表的所有数据
        let allItems = [];
        if (listType === 'liked') {
            allItems = this.app.likedManager.allWorks || [];
        } else if (listType === 'bookmarked') {
            allItems = this.app.bookmarkedManager.allWorks || [];
        } else if (listType === 'following') {
            allItems = this.app.followingManager.allAuthors || [];
        }
        
        // ✅ 调试日志：检查数据是否正确加载
        logger.info(`📊 批量选择数据检查: listType=${listType}, selectionType=${selectionType}, allItems.length=${allItems.length}`);
        if (listType === 'following') {
            logger.info(`📊 followingManager.allAuthors:`, allItems);
        }
        
        // ✅ 根据选择类型设置选中状态
        console.log('[DEBUG] selectionType value:', selectionType, typeof selectionType);
        switch (selectionType) {
            case 'current':
                console.log('[DEBUG] executing selectCurrentPage');
                this.selectCurrentPage(listType, allItems);
                break;
            case 'all':
                console.log('[DEBUG] executing selectAllItems');
                this.selectAllItems(listType, allItems);
                break;
            default:
                console.log('[DEBUG] executing clearSelection (default branch)');
                this.clearSelection(listType);
                break;
        }
        
        // ✅ 更新 UI
        this.updateBatchSelectionUI(listType);
        
        // ✅ UI 日志
        const selectedCount = this.getSelectedCount(listType);
        if (selectedCount > 0) {
            import('../utils/logger.js').then(({ logToUI }) => {
                const itemType = listType === 'following' ? '作者' : '作品';
                logToUI('info', `📋 已选中 ${selectedCount} 个${itemType}`);
            });
        } else {
            import('../utils/logger.js').then(({ logToUI }) => {
                logToUI('info', '📋 已清空选择');
            });
        }
        
        // ✅ 重置下拉框
        const batchSelectElement = document.getElementById(`${listType}BatchSelect`);
        if (batchSelectElement) {
            batchSelectElement.value = '';
        }
    }

    /**
     * 选中当前页
     */
    selectCurrentPage(listType, allItems) {
        const state = this.state[listType];
        
        // 获取当前页的数据
        let currentPageItems = [];
        if (listType === 'liked') {
            const startIndex = (this.app.likedManager.currentPage - 1) * this.app.likedManager.pageSize;
            const endIndex = startIndex + this.app.likedManager.pageSize;
            currentPageItems = allItems.slice(startIndex, endIndex);
        } else if (listType === 'bookmarked') {
            const startIndex = (this.app.bookmarkedManager.currentPage - 1) * this.app.bookmarkedManager.pageSize;
            const endIndex = startIndex + this.app.bookmarkedManager.pageSize;
            currentPageItems = allItems.slice(startIndex, endIndex);
        } else if (listType === 'following') {
            const startIndex = (this.app.followingManager.currentPage - 1) * this.app.followingManager.pageSize;
            const endIndex = startIndex + this.app.followingManager.pageSize;
            currentPageItems = allItems.slice(startIndex, endIndex);
        }
        
        // ✅ 智能切换逻辑
        if (listType === 'following') {
            const currentPageIds = currentPageItems.map(item => item.uid);
            
            // ✅ 只检查可选的项目是否都被选中
            const selectableCurrentIds = currentPageItems
                .filter(item => !(item.workCount === 0 || item.downloadStatus === 'completed'))
                .map(item => item.uid);
            const allChecked = selectableCurrentIds.length > 0 && selectableCurrentIds.every(id => state.selectedAuthorIds.has(id));
            
            if (allChecked) {
                logger.info('✅ 当前页已全部选中，执行取消选择');
                selectableCurrentIds.forEach(id => state.selectedAuthorIds.delete(id));
                state.selectAll = false;
                this.syncCheckboxes(listType, []);
            } else {
                console.log('[DEBUG] selectCurrentPage: clearing and selecting');
                logger.info('✅ 执行选中当前页');
                state.selectedAuthorIds.clear();
                state.selectAll = false;
                
                // ✅ 过滤掉禁用的作者（无作品或已完成下载）
                const selectableItems = currentPageItems.filter(item => {
                    return !(item.workCount === 0 || item.downloadStatus === 'completed');
                });
                
                selectableItems.forEach(item => {
                    state.selectedAuthorIds.add(item.uid);
                });
                
                const selectableIds = selectableItems.map(item => item.uid);
                this.syncCheckboxes(listType, selectableIds);
            }
        } else {
            const currentPageIds = currentPageItems.map(item => item.workId);
            
            // ✅ 只检查可选的项目是否都被选中
            const selectableCurrentIds = currentPageItems
                .filter(item => !item.isDownloaded)
                .map(item => item.workId);
            const allChecked = selectableCurrentIds.length > 0 && selectableCurrentIds.every(id => state.selectedWorkIds.has(id));
            
            if (allChecked) {
                logger.info('✅ 当前页已全部选中，执行取消选择');
                selectableCurrentIds.forEach(id => state.selectedWorkIds.delete(id));
                state.selectAll = false;
                this.syncCheckboxes(listType, []);
            } else {
                logger.info('✅ 执行选中当前页');
                state.selectedWorkIds.clear();
                state.selectAll = false;
                
                // ✅ 过滤掉已下载的作品
                const selectableItems = currentPageItems.filter(item => !item.isDownloaded);
                
                selectableItems.forEach(item => {
                    state.selectedWorkIds.add(item.workId);
                });
                
                const selectableIds = selectableItems.map(item => item.workId);
                this.syncCheckboxes(listType, selectableIds);
            }
        }
        
        logger.info(`✅ 已处理当前页: ${currentPageItems.length} 个`);
    }

    /**
     * 选中全部
     */
    selectAllItems(listType, allItems) {
        const state = this.state[listType];
        
        logger.info(`📋 selectAllItems 开始: listType=${listType}, allItems.length=${allItems.length}`);
        
        if (listType === 'following') {
            const allIds = allItems.map(item => item.uid);
            logger.info(`📋 following - allIds:`, allIds);
            logger.info(`📋 following - selectedAuthorIds before:`, Array.from(state.selectedAuthorIds));
            
            // ✅ 只检查可选的项目是否都被选中
            const selectableAllIds = allItems
                .filter(item => !(item.workCount === 0 || item.downloadStatus === 'completed'))
                .map(item => item.uid);
            const allChecked = selectableAllIds.length > 0 && selectableAllIds.every(id => state.selectedAuthorIds.has(id));
            logger.info(`📋 following - selectableAllIds.length=${selectableAllIds.length}, allChecked=${allChecked}`);
            
            if (allChecked) {
                logger.info('✅ 所有项已全部选中，执行取消选择');
                selectableAllIds.forEach(id => state.selectedAuthorIds.delete(id));
                state.selectAll = false;
                
                const currentPageItems = this.getCurrentPageItems(listType, allItems);
                this.syncCheckboxes(listType, []);
            } else {
                logger.info('✅ 执行选中全部');
                state.selectedAuthorIds.clear();
                state.selectAll = true;
                
                // ✅ 过滤掉禁用的作者（无作品或已完成下载）
                const selectableItems = allItems.filter(item => {
                    return !(item.workCount === 0 || item.downloadStatus === 'completed');
                });
                
                selectableItems.forEach(item => {
                    state.selectedAuthorIds.add(item.uid);
                });
                
                logger.info(`📋 following - selectedAuthorIds after:`, Array.from(state.selectedAuthorIds));
                
                const currentPageItems = this.getCurrentPageItems(listType, allItems);
                const selectableCurrentIds = currentPageItems
                    .filter(item => !(item.workCount === 0 || item.downloadStatus === 'completed'))
                    .map(item => item.uid);
                this.syncCheckboxes(listType, selectableCurrentIds);
            }
        } else {
            const allIds = allItems.map(item => item.workId);
            
            // ✅ 只检查可选的项目是否都被选中
            const selectableAllIds = allItems
                .filter(item => !item.isDownloaded)
                .map(item => item.workId);
            const allChecked = selectableAllIds.length > 0 && selectableAllIds.every(id => state.selectedWorkIds.has(id));
            
            if (allChecked) {
                logger.info('✅ 所有项已全部选中，执行取消选择');
                selectableAllIds.forEach(id => state.selectedWorkIds.delete(id));
                state.selectAll = false;
                
                const currentPageItems = this.getCurrentPageItems(listType, allItems);
                this.syncCheckboxes(listType, []);
            } else {
                logger.info('✅ 执行选中全部');
                state.selectedWorkIds.clear();
                state.selectAll = true;
                
                // ✅ 过滤掉已下载的作品
                const selectableItems = allItems.filter(item => !item.isDownloaded);
                
                selectableItems.forEach(item => {
                    state.selectedWorkIds.add(item.workId);
                });
                
                const currentPageItems = this.getCurrentPageItems(listType, allItems);
                const selectableCurrentIds = currentPageItems
                    .filter(item => !item.isDownloaded)
                    .map(item => item.workId);
                this.syncCheckboxes(listType, selectableCurrentIds);
            }
        }
        
        logger.info(`✅ 已处理全部: ${allItems.length} 个`);
    }

    /**
     * 清空选择
     */
    clearSelection(listType) {
        console.log('[DEBUG] ===== clearSelection START =====');
        console.trace('[DEBUG] clearSelection call stack');
        console.log('[DEBUG] clearSelection called:', listType);
        console.log('[DEBUG] before clear - selectedAuthorIds:', Array.from(this.state.following?.selectedAuthorIds || []));
        
        const state = this.state[listType];
        if (!state) return;
        
        // ✅ 根据列表类型清空对应的选中集合
        if (listType === 'following') {
            state.selectedAuthorIds.clear();
        } else {
            state.selectedWorkIds.clear();
        }
        state.selectAll = false;
        
        this.syncCheckboxes(listType, []);
        this.updateBatchSelectionUI(listType);
        
        logger.info(`✅ 已清空选择`);
    }

    /**
     * 获取当前页的项目
     */
    getCurrentPageItems(listType, allItems) {
        if (listType === 'liked') {
            const startIndex = (this.app.likedManager.currentPage - 1) * this.app.likedManager.pageSize;
            const endIndex = startIndex + this.app.likedManager.pageSize;
            return allItems.slice(startIndex, endIndex);
        } else if (listType === 'bookmarked') {
            const startIndex = (this.app.bookmarkedManager.currentPage - 1) * this.app.bookmarkedManager.pageSize;
            const endIndex = startIndex + this.app.bookmarkedManager.pageSize;
            return allItems.slice(startIndex, endIndex);
        } else if (listType === 'following') {
            const startIndex = (this.app.followingManager.currentPage - 1) * this.app.followingManager.pageSize;
            const endIndex = startIndex + this.app.followingManager.pageSize;
            return allItems.slice(startIndex, endIndex);
        }
        return [];
    }

    /**
     * 同步 checkbox 状态（延迟执行，确保 DOM 已渲染）
     */
    syncCheckboxes(listType, selectedIds) {
        const tabContentId = listType === 'liked' ? 'tabContentLiked' : 
                            listType === 'bookmarked' ? 'tabContentBookmarked' : 
                            'tabContentFollowing';
        
        // ✅ 延迟执行，确保 DOM 已完全渲染
        setTimeout(() => {
            // ✅ 关注列表使用 data-uid，作品列表使用 data-work-id
            const selector = listType === 'following' ? 
                `#${tabContentId} [data-uid]` : 
                `#${tabContentId} .work-checkbox`;
            const checkboxes = document.querySelectorAll(selector);
            
            checkboxes.forEach(checkbox => {
                // ✅ 根据列表类型获取 ID
                const itemId = listType === 'following' ? 
                    checkbox.dataset.uid : 
                    checkbox.dataset.workId;
                const shouldBeChecked = selectedIds.includes(itemId);
                
                // ✅ 只更新未禁用的 checkbox 的 checked 状态
                if (!checkbox.disabled) {
                    checkbox.checked = shouldBeChecked;
                }
            });
        }, 100);
    }

    /**
     * 更新批量选择 UI
     */
    updateBatchSelectionUI(listType) {
        const countElement = document.getElementById(`${listType}SelectedCount`);
        const batchDownloadBtn = document.querySelector(`.batch-download-btn[data-type="${listType}"]`);
        
        const selectedCount = this.getSelectedCount(listType);
        
        if (countElement) {
            countElement.textContent = selectedCount;
        }
        
        if (batchDownloadBtn) {
            // ✅ 从 downloadHandler 获取下载状态
            const downloadState = this.app.downloadHandler ? this.app.downloadHandler.getDownloadState() : { isDownloading: false };
            const shouldDisable = selectedCount === 0 || downloadState.isDownloading;
            batchDownloadBtn.disabled = shouldDisable;
            batchDownloadBtn.style.opacity = shouldDisable ? '0.5' : '1';
            batchDownloadBtn.style.cursor = shouldDisable ? 'not-allowed' : 'pointer';
            
            // ✅ 根据列表类型显示不同的提示文本
            const itemType = listType === 'following' ? '作者' : '作品';
            batchDownloadBtn.title = downloadState.isDownloading ? '保存进行中...' : (selectedCount > 0 ? `保存选中${itemType}` : `请先选择${itemType}`);
        }
    }

    /**
     * 获取选中数量
     */
    getSelectedCount(listType) {
        const state = this.state[listType];
        if (!state) return 0;
        
        if (listType === 'following') {
            return state.selectedAuthorIds.size;
        } else {
            return state.selectedWorkIds.size;
        }
    }

    /**
     * ✅ 获取选中的作品ID列表
     * @param {string} listType - 列表类型：'liked' | 'bookmarked'
     * @returns {Array} 作品ID数组
     */
    getSelectedWorkIds(listType) {
        const state = this.state[listType];
        if (!state) return [];
        return Array.from(state.selectedWorkIds);
    }

    /**
     * ✅ 获取选中的作者UID列表
     * @returns {Array} 作者UID数组
     */
    getSelectedAuthorIds() {
        const state = this.state.following;
        if (!state) return [];
        return Array.from(state.selectedAuthorIds);
    }

    /**
     * ✅ 禁用指定项目（作者或作品）的复选框
     * @param {string} listType - 列表类型：'liked' | 'bookmarked' | 'following'
     * @param {string} itemId - 项目ID（uid 或 workId）
     */
    disableItem(listType, itemId) {
        const tabContentId = listType === 'liked' ? 'tabContentLiked' : 
                            listType === 'bookmarked' ? 'tabContentBookmarked' : 
                            'tabContentFollowing';
        
        // ✅ 根据列表类型获取选择器
        const selector = listType === 'following' ? 
            `#${tabContentId} .author-checkbox[data-uid="${itemId}"]` : 
            `#${tabContentId} .work-checkbox[data-work-id="${itemId}"]`;
        
        const checkbox = document.querySelector(selector);
        if (checkbox) {
            checkbox.checked = false;
            checkbox.disabled = true;
            logger.info(`✅ 已禁用 ${listType} 列表的项目: ${itemId}`);
        } else {
            logger.warn(`⚠️ 未找到 ${listType} 列表的项目复选框: ${itemId}`);
        }
    }

    /**
     * 获取选中状态
     */
    getState(listType) {
        return this.state[listType];
    }
}

export { BatchSelectionManager };
