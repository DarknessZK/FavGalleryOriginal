// ==========================================
// FavGallery - 批量选择管理器
// 功能：管理批量选择状态、同步 checkbox、更新 UI
// ==========================================

import { createLogger } from '../utils/logger.js';
// ✅ 批量选择的“可选项口径 / 主键提取 / 规则满足判定 / 当前页切片”下沉到零依赖纯模块，
//    与 DOM/状态编排分离（决策/执行分离），供多处复用并可在测试台独立回归
import {
    getSelectableIds,
    isRuleSatisfied,
    sliceCurrentPage
} from '../utils/batch-selection.js';

const logger = createLogger('BatchSelectionManager');

class BatchSelectionManager {
    constructor(app) {
        this.app = app;
        
        // ✅ 批量选择状态（按列表类型管理）
        //    batchMode：上一次规则型批量操作（'current' 选中当前页 / 'all' 全选），
        //    筛选/排序/搜索改变展示数据集后据此对新结果重算选中集；手动逐个勾选置 null 解除规则
        this.state = {
            liked: {
                selectedWorkIds: new Set(),
                selectAll: false,
                batchMode: null,
                backfillMode: false,
                activeScope: null,
                totalCount: 0
            },
            bookmarked: {
                selectedWorkIds: new Set(),
                selectAll: false,
                batchMode: null,
                backfillMode: false,
                activeScope: null,
                totalCount: 0
            },
            following: {
                selectedAuthorIds: new Set(),
                selectAll: false,
                batchMode: null,
                activeScope: null,
                totalCount: 0
            },
            // ✅ 作者作品钻取视图（与点赞/收藏同规格的批量选择）
            authorWorks: {
                selectedWorkIds: new Set(),
                selectAll: false,
                batchMode: null,
                backfillMode: false,
                activeScope: null,
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
        
        // ✅ 手动逐个勾选/取消属于具体选择，解除规则型批量模式（避免后续筛选变动时被整页重选覆盖）
        state.batchMode = null;
        
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
        
        // ✅ 获取当前列表的“展示数据集”：有筛选/排序时为 filteredData，否则为全量
        //（与界面渲染取数口径 getCurrentPageData 保持一致，确保批量操作作用于当前筛选结果而非筛选前全量）
        const allItems = this._getDisplayedItems(listType);
        
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
    }

    /**
     * ✅ 取当前列表的“展示数据集”（筛选/排序后的结果，无筛选时为全量）
     * 供批量选择与界面渲染保持同一口径：filteredData 为空表示未筛选，回退到原始全量。
     * @param {string} listType - 列表类型
     * @returns {Array} 展示用的作品/作者数组
     */
    _getDisplayedItems(listType) {
        let manager = null;
        if (listType === 'liked') manager = this.app.likedManager;
        else if (listType === 'bookmarked') manager = this.app.bookmarkedManager;
        else if (listType === 'following') manager = this.app.followingManager;
        else if (listType === 'authorWorks') manager = this.app.authorWorksView?.manager;
        if (!manager) return [];
        const allData = listType === 'following' ? (manager.allAuthors || []) : (manager.allWorks || []);
        return manager.filteredData || allData;
    }

    /**
     * ✅ 按 listType 取对应的列表管理器
     * @param {string} listType
     * @returns {WorkListManager|null}
     */
    _getManager(listType) {
        if (listType === 'liked') return this.app.likedManager;
        if (listType === 'bookmarked') return this.app.bookmarkedManager;
        if (listType === 'following') return this.app.followingManager;
        if (listType === 'authorWorks') return this.app.authorWorksView?.manager;
        return null;
    }

    /**
     * ✅ 展示数据集变化（筛选/排序/搜索）后，按当前规则型批量模式对新结果重算选中集
     * 语义：上一轮是“选中当前页/全选”时，筛选后自动变为“当前页∩筛选”/“全部∩筛选”，
     *      取消筛选则回到“当前页”/“全部”；上一轮是手动逐个勾选（batchMode=null）则不干预。
     * @param {string} listType
     */
    reapplyBatchMode(listType) {
        const state = this.state[listType];
        if (!state || !state.batchMode) return;
        const manager = this._getManager(listType);
        if (!manager) return;

        // saved → 仅当前页已保存作品（backfill 口径）；current → 当前页（下载口径）；all → 全部展示集
        const isSaved = state.batchMode === 'saved';
        const items = (state.batchMode === 'current' || isSaved)
            ? (manager.getCurrentPageData() || [])
            : this._getDisplayedItems(listType);
        const ids = getSelectableIds(items, listType, isSaved ? 'backfill' : 'download');

        if (listType === 'following') state.selectedAuthorIds = new Set(ids);
        else state.selectedWorkIds = new Set(ids);

        this.syncCheckboxes(listType, ids);
        this.updateBatchSelectionUI(listType);
        logger.info(`🔄 ${listType} 批量模式(${state.batchMode})随筛选重算：选中 ${ids.length} 个`);
    }

    /**
     * ✅ 判定目标集（当前页/全部展示）的可选项是否已全部处于选中态
     * 用于在 selectCurrentPage/selectAllItems 末尾回写 batchMode：
     *   全部选中 → 规则生效（'current'/'all'）；否则视为已取消（null）。空集 every 为 true。
     * @param {string} listType
     * @param {'current'|'all'} mode
     * @returns {boolean}
     */
    _isRuleFullySelected(listType, mode) {
        const state = this.state[listType];
        if (!state) return false;
        const manager = this._getManager(listType);
        const isSaved = mode === 'saved';
        const items = (mode === 'current' || isSaved)
            ? (manager?.getCurrentPageData() || [])
            : this._getDisplayedItems(listType);
        const selSet = listType === 'following' ? state.selectedAuthorIds : state.selectedWorkIds;
        return isRuleSatisfied(items, selSet, listType, isSaved ? 'backfill' : 'download');
    }

    /**
     * 选中当前页
     */
    selectCurrentPage(listType, allItems) {
        const state = this.state[listType];
        state.backfillMode = false; // 切回下载意图
        const selSet = listType === 'following' ? state.selectedAuthorIds : state.selectedWorkIds;
        const currentPageItems = this.getCurrentPageItems(listType, allItems);
        const selectableIds = getSelectableIds(currentPageItems, listType);

        // ✅ 智能切换：当前页可选项已全选中 → 取消；否则先清空再选中当前页可选项
        const allChecked = selectableIds.length > 0 && selectableIds.every(id => selSet.has(id));
        if (allChecked) {
            logger.info('✅ 当前页已全部选中，执行取消选择');
            selectableIds.forEach(id => selSet.delete(id));
            state.selectAll = false;
            this.syncCheckboxes(listType, []);
        } else {
            logger.info('✅ 执行选中当前页');
            selSet.clear();
            state.selectAll = false;
            selectableIds.forEach(id => selSet.add(id));
            this.syncCheckboxes(listType, selectableIds);
        }

        logger.info(`✅ 已处理当前页: ${currentPageItems.length} 个`);
        // ✅ 回写规则型模式：当前页可选项全部选中 → 'current'（筛选变动时自动重算）；否则视为取消 → null
        state.batchMode = this._isRuleFullySelected(listType, 'current') ? 'current' : null;
    }

    /**
     * 选中全部
     */
    selectAllItems(listType, allItems) {
        const state = this.state[listType];
        state.backfillMode = false; // 切回下载意图
        const selSet = listType === 'following' ? state.selectedAuthorIds : state.selectedWorkIds;

        logger.info(`📋 selectAllItems 开始: listType=${listType}, allItems.length=${allItems.length}`);

        const selectableAllIds = getSelectableIds(allItems, listType);

        // ✅ 智能切换：展示集可选项已全选中 → 取消；否则清空后选中全部可选项
        const allChecked = selectableAllIds.length > 0 && selectableAllIds.every(id => selSet.has(id));
        if (allChecked) {
            logger.info('✅ 所有项已全部选中，执行取消选择');
            selectableAllIds.forEach(id => selSet.delete(id));
            state.selectAll = false;
            this.syncCheckboxes(listType, []);
        } else {
            logger.info('✅ 执行选中全部');
            selSet.clear();
            state.selectAll = true;
            selectableAllIds.forEach(id => selSet.add(id));
            // 其他页未渲染，仅同步当前页 checkbox（选中态存于 selSet，翻页渲染按状态回填）
            const currentPageItems = this.getCurrentPageItems(listType, allItems);
            this.syncCheckboxes(listType, getSelectableIds(currentPageItems, listType));
        }

        logger.info(`✅ 已处理全部: ${allItems.length} 个`);
        // ✅ 回写规则型模式：展示集可选项全部选中 → 'all'（筛选变动时自动重算）；否则视为取消 → null
        state.batchMode = this._isRuleFullySelected(listType, 'all') ? 'all' : null;
    }

    /**
     * 清空选择
     */
    clearSelection(listType) {
        const state = this.state[listType];
        if (!state) return;
        
        // ✅ 根据列表类型清空对应的选中集合
        if (listType === 'following') {
            state.selectedAuthorIds.clear();
        } else {
            state.selectedWorkIds.clear();
        }
        state.selectAll = false;
        state.batchMode = null;
        state.backfillMode = false;
        state.activeScope = null;
        // ✅ 退出补全态：同步复位渲染意图，使已保存作品复选框恢复禁用（避免残留可勾选态）
        const manager = this._getManager(listType);
        if (manager) manager.backfillMode = false;

        this.syncCheckboxes(listType, []);
        this.updateBatchSelectionUI(listType);
        // ✅ 通知事件层：若之前因补全态锁定了“状态”筛选，此处解锁并恢复全量列表（如补全完成后自动释放）
        this.app.batchScopeUnlockers?.[listType]?.();
        
        logger.info(`✅ 已清空选择`);
    }

    /**
     * 获取当前页的项目
     */
    getCurrentPageItems(listType, allItems) {
        const manager = this._getManager(listType);
        if (!manager) return [];
        return sliceCurrentPage(allItems, manager.currentPage, manager.pageSize);
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
        const state = this.state[listType];
        const batchDownloadBtn = document.querySelector(`.batch-download-btn[data-type="${listType}"]`);
        const selectedCount = this.getSelectedCount(listType);
        const isBackfill = !!(state && state.backfillMode);

        if (batchDownloadBtn) {
            // ✅ 按补全态切换按钮文案（校验补全 / 批量保存），保留计数 span 的 id/class 以供联动回写
            const label = isBackfill ? '🔍 校验补全' : '⬇️ 批量保存';
            batchDownloadBtn.innerHTML = `${label} (<span id="${listType}SelectedCount" class="selected-count">${selectedCount}</span>)`;

            // ✅ 从 downloadHandler 获取下载状态（权限控制与批量保存/停止一致：选中数为 0 或下载中则禁用）
            const downloadState = this.app.downloadHandler ? this.app.downloadHandler.getDownloadState() : { isDownloading: false };
            const shouldDisable = selectedCount === 0 || downloadState.isDownloading;
            batchDownloadBtn.disabled = shouldDisable;
            batchDownloadBtn.style.opacity = shouldDisable ? '0.5' : '1';
            batchDownloadBtn.style.cursor = shouldDisable ? 'not-allowed' : 'pointer';

            const itemType = listType === 'following' ? '作者' : '作品';
            if (isBackfill) {
                batchDownloadBtn.title = downloadState.isDownloading ? '任务进行中...' : (selectedCount > 0 ? `校验补全选中${itemType}` : '请先选择已保存作品');
            } else {
                batchDownloadBtn.title = downloadState.isDownloading ? '保存进行中...' : (selectedCount > 0 ? `保存选中${itemType}` : `请先选择${itemType}`);
            }
        } else {
            // 兜底：若无批量按钮，仍尝试更新独立计数元素
            const countElement = document.getElementById(`${listType}SelectedCount`);
            if (countElement) countElement.textContent = selectedCount;
        }

        // ✅ 同步“批量选择”下拉高亮（按 state.activeScope 反映当前作用域；手动改勾选不改变 activeScope → 高亮保持）
        this.app.batchScopeRenderers?.[listType]?.();
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
