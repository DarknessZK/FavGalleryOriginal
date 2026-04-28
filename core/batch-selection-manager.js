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
        const state = this.state[listType];
        if (!state) {
            logger.warn(`⚠️ 未知的列表类型: ${listType}`);
            return;
        }
        
        logger.info(`🔍 handleCheckboxChange: listType=${listType}, itemId=${itemId}, checked=${checked}`);
        logger.info(`🔍 修改前 selectedWorkIds.size=${state.selectedWorkIds.size}`);
        
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
        
        logger.info(`🔍 修改后 selectedWorkIds.size=${state.selectedWorkIds.size}`);
        
        // ✅ 更新 UI
        this.updateBatchSelectionUI(listType);
        
        logger.info(`📋 批量选择状态: ${listType}, 已选 ${this.getSelectedCount(listType)} 个`);
    }

    /**
     * 处理批量选择下拉框变化
     */
    handleBatchSelectionChange(listType, selectionType) {
        logger.info(`📋 批量选择变化: ${listType}, ${selectionType}`);
        
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
            logger.warn('⚠️ 收藏列表尚未实现');
            return;
        } else if (listType === 'following') {
            logger.warn('⚠️ 关注列表尚未实现');
            return;
        }
        
        // ✅ 根据选择类型设置选中状态
        switch (selectionType) {
            case 'current':
                this.selectCurrentPage(listType, allItems);
                break;
            case 'all':
                this.selectAllItems(listType, allItems);
                break;
            default:
                this.clearSelection(listType);
                break;
        }
        
        // ✅ 更新 UI
        this.updateBatchSelectionUI(listType);
        
        // ✅ UI 日志
        const selectedCount = this.getSelectedCount(listType);
        if (selectedCount > 0) {
            import('../utils/logger.js').then(({ logToUI }) => {
                logToUI('info', `📋 已选中 ${selectedCount} 个${listType === 'following' ? '作者' : '作品'}`);
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
        }
        
        // ✅ 智能切换逻辑
        const currentPageIds = currentPageItems.map(item => 
            listType === 'following' ? item.authorId : item.workId
        );
        const allChecked = currentPageIds.every(id => 
            listType === 'following' ? state.selectedAuthorIds.has(id) : state.selectedWorkIds.has(id)
        );
        
        if (allChecked && currentPageIds.length > 0) {
            logger.info('✅ 当前页已全部选中，执行取消选择');
            currentPageIds.forEach(id => {
                if (listType === 'following') {
                    state.selectedAuthorIds.delete(id);
                } else {
                    state.selectedWorkIds.delete(id);
                }
            });
            state.selectAll = false;
            this.syncCheckboxes(listType, []);
        } else {
            logger.info('✅ 执行选中当前页');
            if (listType === 'following') {
                state.selectedAuthorIds.clear();
            } else {
                state.selectedWorkIds.clear();
            }
            state.selectAll = false;
            
            currentPageItems.forEach(item => {
                const id = listType === 'following' ? item.authorId : item.workId;
                if (listType === 'following') {
                    state.selectedAuthorIds.add(id);
                } else {
                    state.selectedWorkIds.add(id);
                }
            });
            
            this.syncCheckboxes(listType, currentPageIds);
        }
        
        logger.info(`✅ 已处理当前页: ${currentPageItems.length} 个`);
    }

    /**
     * 选中全部
     */
    selectAllItems(listType, allItems) {
        const state = this.state[listType];
        
        const allIds = allItems.map(item => 
            listType === 'following' ? item.authorId : item.workId
        );
        const allChecked = allIds.every(id => 
            listType === 'following' ? state.selectedAuthorIds.has(id) : state.selectedWorkIds.has(id)
        );
        
        if (allChecked && allIds.length > 0) {
            logger.info('✅ 所有项已全部选中，执行取消选择');
            allIds.forEach(id => {
                if (listType === 'following') {
                    state.selectedAuthorIds.delete(id);
                } else {
                    state.selectedWorkIds.delete(id);
                }
            });
            state.selectAll = false;
            
            const currentPageItems = this.getCurrentPageItems(listType, allItems);
            this.syncCheckboxes(listType, []);
        } else {
            logger.info('✅ 执行选中全部');
            if (listType === 'following') {
                state.selectedAuthorIds.clear();
            } else {
                state.selectedWorkIds.clear();
            }
            state.selectAll = true;
            
            allItems.forEach(item => {
                const id = listType === 'following' ? item.authorId : item.workId;
                if (listType === 'following') {
                    state.selectedAuthorIds.add(id);
                } else {
                    state.selectedWorkIds.add(id);
                }
            });
            
            const currentPageItems = this.getCurrentPageItems(listType, allItems);
            this.syncCheckboxes(listType, currentPageItems.map(item => 
                listType === 'following' ? item.authorId : item.workId
            ));
        }
        
        logger.info(`✅ 已处理全部: ${allItems.length} 个`);
    }

    /**
     * 清空选择
     */
    clearSelection(listType) {
        const state = this.state[listType];
        if (!state) return;
        
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
        
        logger.info(`🔍 syncCheckboxes: listType=${listType}, selectedIds.length=${selectedIds.length}`);
        
        // ✅ 延迟执行，确保 DOM 已完全渲染
        setTimeout(() => {
            const checkboxes = document.querySelectorAll(`#${tabContentId} .work-checkbox`);
            logger.info(`🔍 找到 ${checkboxes.length} 个 checkbox`);
            
            checkboxes.forEach(checkbox => {
                const itemId = checkbox.dataset.workId;
                const shouldBeChecked = selectedIds.includes(itemId);
                checkbox.checked = shouldBeChecked;
                if (shouldBeChecked) {
                    logger.info(`🔍 设置 checkbox ${itemId} 为 checked`);
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
            const shouldDisable = selectedCount === 0 || this.app.isDownloading;
            batchDownloadBtn.disabled = shouldDisable;
            batchDownloadBtn.style.opacity = shouldDisable ? '0.5' : '1';
            batchDownloadBtn.style.cursor = shouldDisable ? 'not-allowed' : 'pointer';
            batchDownloadBtn.title = this.app.isDownloading ? '保存进行中...' : (selectedCount > 0 ? '保存选中作品' : '请先选择作品');
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
     * 获取选中状态
     */
    getState(listType) {
        return this.state[listType];
    }
}

export { BatchSelectionManager };
