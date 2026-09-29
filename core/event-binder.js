// ==========================================
// FavGallery - DOM 事件绑定器
// 职责：统一管理所有 DOM 事件绑定（按钮点击、Tab 切换、搜索、分页、批量操作等）
// ==========================================

import { createLogger, logToUI } from '../utils/logger.js';
import { CONFIG } from '../config/constants.js';
import { DURATION_BUCKETS } from '../config/constants.js';
import { MultiTagSelector } from '../ui/components/multi-tag-selector.js';
import { showConfirmModal } from '../utils/ui-helpers.js';

const logger = createLogger('EventBinder');

class EventBinder {
    constructor(app) {
        this.app = app;
        // ✅ 作者多选筛选器（MultiTagSelector 实例，按 prefix 缓存）与各列表的 applyFilters 回引
        this.authorSelectors = {};
        this._filterApplyFns = {};
        // ✅ 自定义排序下拉组件实例（按 prefix 缓存）
        this.sortDropdowns = {};
        // ✅ 自定义“时长”多选下拉实例（按 prefix 缓存）
        this.durationDropdowns = {};
    }

    /**
     * 绑定所有 DOM 事件
     */
    bind() {
        logger.info('🔗 开始绑定 DOM 事件...');

        // 1. 选择文件夹
        this.bindSelectFolder();

        // 1.5. ✅ 打开本地库（引导）
        this.bindOpenLibrary();

        // 2. Tab 切换
        this.bindTabSwitching();

        // 3. 刷新点赞列表
        this.bindLoadLikedWorks();
        
        // 3.5. 刷新收藏列表
        this.bindLoadBookmarkedWorks();
        
        // 3.6. ✅ 刷新关注列表
        this.bindLoadFollowingAuthors();

        // 4. 点赞列表搜索
        this.bindLikedSearch();

        // 4.5. ✅ 收藏列表搜索
        this.bindBookmarkedSearch();
        
        // 4.6. ✅ 关注列表搜索
        this.bindFollowingSearch();

        // 4.8. ✅ 高级筛选栏（点赞 / 收藏）
        this.bindFilterBars();

        // 4.9. ✅ 作者作品钻取视图控件（筛选栏/搜索/分页/返回）
        this.bindAuthorWorksView();

        // 5. 点赞列表分页
        this.bindLikedPagination();

        // 5.5. ✅ 收藏列表分页
        this.bindBookmarkedPagination();
        
        // 5.6. ✅ 关注列表分页
        this.bindFollowingPagination();

        // 6. 作品卡片单个下载（事件委托）
        this.bindWorkCardActions();
        
        // 6.5. ✅ 关注列表作者卡片操作（保存作者所有作品）
        this.bindFollowingCardActions();

        // 7. 点赞列表批量操作
        this.bindLikedBatchOperations();

        // 8. 收藏列表批量操作
        this.bindBookmarkedBatchOperations();

        // 9. 关注列表批量操作
        this.bindFollowingBatchOperations();

        // 9.5. ✅ 作者作品钻取视图批量操作
        this.bindAuthorWorksBatchOperations();
        
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
     * ✅ 绑定“打开本地库”按钮（B+ 自动捕获）
     * 说明：路径不再要用户手输——用户首次手动打开离线页后，background 会反查
     *      file:// 标签页 URL 自动记住绝对路径。这里点击时先请求 background 一键
     *      “聚焦已开标签 / 新建标签打开”；只有打不开（没路径 / 未授权）时才展开引导。
     */
    bindOpenLibrary() {
        const btn = document.getElementById('openLibrary');
        const hint = document.getElementById('openLibraryHint');
        if (!btn || !hint) {
            logger.warn('⚠️ 未找到“打开本地库”相关元素');
            return;
        }

        // 启动探测：若已记住离线库路径，即便本次未重选文件夹也提前启用按钮
        this._probeLibrary(btn);

        btn.addEventListener('click', async () => {
            // 已展开的引导再次点击则收起
            if (hint.style.display !== 'none') {
                hint.style.display = 'none';
                return;
            }

            // 1) 先尝试一键打开 / 聚焦（路径由后台静默捕获）
            const res = await this._requestOpenLibrary();
            if (res && res.ok) {
                hint.style.display = 'none';
                logToUI('success', res.action === 'focused'
                    ? '📂 已切换到已打开的本地库标签页'
                    : '📂 已在新标签页打开本地库');
                return;
            }

            // 2) 打不开 → 展开引导（区分“未授权”与“从没打开过种子”）
            this._showLibraryGuide(hint, res || {});
        });
    }

    /**
     * 向 background 请求打开/聚焦离线页
     * @returns {Promise<object|null>}
     */
    _requestOpenLibrary() {
        return new Promise((resolve) => {
            try {
                chrome.runtime.sendMessage({ type: 'OPEN_OFFLINE_LIBRARY' }, (resp) => {
                    if (chrome.runtime.lastError) {
                        logger.warn('⚠️ 打开本地库消息失败:', chrome.runtime.lastError.message);
                        resolve(null);
                        return;
                    }
                    resolve(resp || null);
                });
            } catch (err) {
                logger.warn('⚠️ 打开本地库异常:', err && err.message);
                resolve(null);
            }
        });
    }

    /**
     * 启动探测：是否已记住离线库路径，据此提前启用按钮
     * @param {HTMLElement} btn
     */
    _probeLibrary(btn) {
        try {
            chrome.runtime.sendMessage({ type: 'PROBE_OFFLINE_LIBRARY' }, (resp) => {
                if (chrome.runtime.lastError || !resp) return;
                if (resp.hasPath) {
                    btn.disabled = false;
                    btn.title = '一键打开本地库（离线页）';
                    logger.info('📂 已记住离线库路径，按钮提前可用:', resp.url);
                }
            });
        } catch (err) {
            // 忽略：探测失败不影响后续手动引导
        }
    }

    /**
     * 展开“打开本地库”引导卡（按原因区分文案）
     * @param {HTMLElement} hint
     * @param {object} res background 返回 { reason, ... }
     */
    _showLibraryGuide(hint, res) {
        const folderName = this.app.folderName || '你选择的文件夹';
        const accountFolder = this.app.accountFolderName; // 账号数据区子目录（新版布局）
        const entryName = CONFIG.FILE_SYSTEM.OFFLINE_ENTRY_HTML;

        let body;
        if (res.reason === 'need-file-access') {
            // 已捕获路径，但未开「允许访问文件网址」→ 开 file:// 被拦
            body =
                `📂 已记住本地库路径，但浏览器拦截了打开操作。<br>` +
                `请在 <strong>chrome://extensions</strong> → 本扩展「详情」里开启 <strong>「允许访问文件网址」</strong>，之后点这个按钮即可一键直达。<br>`;
        } else {
            // 尚无路径（从没打开过）→ 种子引导（新布局需多进一层账号数据区目录）
            const locateHint = accountFolder
                ? `在文件管理器中打开你选择的文件夹「<strong>${folderName}</strong>」，进入其中创建的「<strong>${accountFolder}</strong>」，双击其中的 <strong>${entryName}</strong>`
                : `在文件管理器中打开你选择的文件夹「<strong>${folderName}</strong>」，双击其中的 <strong>${entryName}</strong>`;
            body =
                `📂 本地库入口文件：<strong>${entryName}</strong><br>` +
                `首次使用请手动打开一次：${locateHint}即可离线浏览。<br>` +
                `<span style="color:#8c8c8c;">打开一次后，扩展会自动记住它的位置，<strong>以后点这个按钮就能一键直达</strong>（需在扩展详情开启「允许访问文件网址」）。</span>`;
        }

        hint.innerHTML = body;
        hint.style.display = 'block';

        logToUI('info', `📂 打开本地库引导：${res.reason || 'no-path'}`);
    }

    /**
     * 绑定 Tab 切换事件
     */
    bindTabSwitching() {
        const tabFollowing = document.getElementById('tabFollowing');
        const tabLiked = document.getElementById('tabLiked');
        const tabBookmarked = document.getElementById('tabBookmarked');

        logger.debug('📑 Tab 元素检查:', {
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
     * ✅ 绑定关注列表搜索框
     */
    bindFollowingSearch() {
        const followingSearchInput = document.getElementById('searchInput');
        if (followingSearchInput) {
            this._bindAuthorSearchInput(followingSearchInput);
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

                // ✅ 搜索改变展示数据集 → 规则型批量模式随新结果重算（与筛选联动同理）
                this.app.batchSelectionManager?.reapplyBatchMode(listType);
    
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
     * ✅ 作者列表搜索框绑定方法（关注列表专用）
     * @param {HTMLElement} searchInput - 搜索输入框元素
     */
    _bindAuthorSearchInput(searchInput) {
        let searchTimer = null;
        searchInput.addEventListener('input', async (event) => {
            clearTimeout(searchTimer);
            searchTimer = setTimeout(async () => {
                const manager = this.app.followingManager;
                
                manager.initElements();
                manager.search(event.target.value);
                
                // ✅ UI 日志
                logToUI('info', `🔍 搜索作者: ${event.target.value}`);

                // ✅ 搜索改变展示数据集 → 规则型批量模式随新结果重算（与筛选联动同理）
                this.app.batchSelectionManager?.reapplyBatchMode('following');
                
                // ✅ 获取当前页的选中状态，传递给 updateUI
                const currentPageItems = manager.getCurrentPageData();
                const selectedIds = currentPageItems
                    .filter(author => this.app.batchSelectionManager.state.following.selectedAuthorIds.has(author.uid))
                    .map(author => author.uid);
                logger.info(`🔍 搜索后同步 checkbox: 当前页 ${currentPageItems.length} 个作者, 选中 ${selectedIds.length} 个`);
                logger.info(`🔍 内存中的选中状态: ${this.app.batchSelectionManager.state.following.selectedAuthorIds.size} 个`);
    
                // ✅ 在渲染时直接传递选中状态，消除闪烁
                manager.updateUI(new Set(selectedIds));
            }, 300);
        });
    }

    /**
     * ✅ 绑定点赞 / 收藏列表的高级筛选栏
     */
    bindFilterBars() {
        this._bindFilterBar('liked', () => this.app.likedManager, true);
        this._bindFilterBar('bookmarked', () => this.app.bookmarkedManager, true);
    }

    /**
     * ✅ 通用筛选栏绑定方法（保存状态 + 类型 + 时间范围 + 排序 + 可选作者多选 + 重置）
     * @param {string} prefix - 控件 ID 前缀 ('liked' | 'bookmarked' | 'authorWorks')
     * @param {Function} getManager - 返回对应的 WorkListManager 实例
     * @param {boolean} supportsAuthor - 是否启用作者多选筛选（仅点赞/收藏）
     */
    _bindFilterBar(prefix, getManager, supportsAuthor = false) {
        const savedSelect = document.getElementById(`${prefix}FilterSaved`);
        const typeSelect = document.getElementById(`${prefix}FilterType`);
        const fromInput = document.getElementById(`${prefix}FilterFrom`);
        const toInput = document.getElementById(`${prefix}FilterTo`);
        const resetBtn = document.getElementById(`${prefix}FilterReset`);
        if (!savedSelect || !fromInput || !toInput || !resetBtn) {
            logger.warn(`⚠️ 筛选栏控件不完整，跳过绑定: ${prefix}`);
            return;
        }

        // 筛选/排序条件变化后刷新列表（与搜索回调同款流程）
        const applyFilters = async () => {
            const manager = getManager();
            if (!manager) return;

            // ✅ 作者多选来自 MultiTagSelector 的选中集合（未创建/不支持则为空）
            const selector = this.authorSelectors[prefix];

            manager.initElements();
            // 排序由自定义下拉组件直接写入 manager.sort，这里不再覆盖
            manager.setFilters({
                saved: savedSelect.value || 'all',
                type: (typeSelect && typeSelect.value) || 'all',
                dateFrom: fromInput.value || '',
                dateTo: toInput.value || '',
                authorIds: (supportsAuthor && selector) ? Array.from(selector.getSelectedIds()) : [],
                durations: this.durationDropdowns[prefix] ? this.durationDropdowns[prefix].getSelected() : []
            });

            // ✅ 重新查询下载状态并更新 allWorks
            await this.app.refreshListDownloadStatus(manager);

            // ✅ 筛选/排序/作者多选改变了展示数据集 → 若存在规则型批量模式（选中当前页/全选），
            //    按新展示集重算选中（当前页∩筛选 / 全部∩筛选），取消筛选则自动回退
            this.app.batchSelectionManager?.reapplyBatchMode(manager.type);

            // ✅ 获取当前页的选中状态，传递给 updateUI（authorWorks 钻取视图同样适用）
            const listType = manager.type;
            const selection = this.app.batchSelectionManager.state[listType];
            const currentPageItems = manager.getCurrentPageData();
            const selectedIds = selection
                ? currentPageItems
                    .filter(work => selection.selectedWorkIds.has(work.workId))
                    .map(work => work.workId)
                : [];

            // ✅ 在渲染时直接传递选中状态，消除闪烁
            manager.updateUI(new Set(selectedIds));
        };

        savedSelect.addEventListener('change', applyFilters);
        if (typeSelect) typeSelect.addEventListener('change', () => {
            // ✅ 类型离开“视频”时清空时长多选，避免隐藏条件下仍参与过滤
            if (typeSelect.value !== 'video' && this.durationDropdowns[prefix]) {
                this.durationDropdowns[prefix].clear();
            }
            applyFilters();
        });
        fromInput.addEventListener('change', applyFilters);
        toInput.addEventListener('change', applyFilters);
        // ✅ 自定义排序下拉（点击已选中项切换升/降序）
        this._setupSortDropdown(prefix, getManager, applyFilters);
        // ✅ 自定义“时长”多选下拉（仅视频模式可用）
        this._setupDurationDropdown(prefix, applyFilters);

        // ✅ 登记 applyFilters 回引：供作者选择器 onSelectionChange 与「已保存（补全）」作用域联动复用
        this._filterApplyFns[prefix] = applyFilters;
        if (supportsAuthor) {
            const authorToggle = document.getElementById(`${prefix}AuthorFilterToggle`);
            if (authorToggle) authorToggle.addEventListener('click', () => this._toggleAuthorFilter(prefix));
        }

        // ✅ 重置：清空控件值、筛选与排序条件
        resetBtn.addEventListener('click', async () => {
            savedSelect.value = 'all';
            if (typeSelect) typeSelect.value = 'all';
            fromInput.value = '';
            toInput.value = '';
            // ✅ 重置时长多选
            const durDd = this.durationDropdowns[prefix];
            if (durDd) durDd.clear();
            // ✅ 清空作者多选选择器（其 onSelectionChange 会回驱一次 applyFilters，与下方显式调用一致）
            const selector = this.authorSelectors[prefix];
            if (selector) selector.clear();
            const manager = getManager();
            if (manager) manager.sort = { key: '', dir: 'desc' };
            const sd = this.sortDropdowns[prefix];
            if (sd) sd.reset();
            // ✅ 重置同时清空批量选择（含规则型模式 batchMode），避免筛选条件复位后仍残留上一轮的选中集
            if (manager) this.app.batchSelectionManager?.clearSelection(manager.type);
            await applyFilters();
            logToUI('info', '🧹 已重置筛选条件');
        });
    }

    /**
     * ✅ 复位筛选栏 DOM 控件到默认值（与 WorkListManager.setData 的内部状态重置保持同步）
     * 场景：点击「刷新/加载列表」后 setData 已把 filters/keyword/sort 归零并重渲全量，
     *      但下拉/输入框等 DOM 控件仍停留在用户上次的选择，会造成「条件显示还在、实际未生效」的错觉。
     * 说明：仅同步 DOM，不调用 applyFilters（此时列表已是全量默认态，无需再触发一次筛选渲染）；
     *      作者多选的清空由 refreshAuthorFilterOptions → updateData 静默完成，此处不重复处理以免误触发回驱。
     * @param {string} prefix - 控件 ID 前缀 ('liked' | 'bookmarked')
     */
    resetFilterControls(prefix) {
        const savedSelect = document.getElementById(`${prefix}FilterSaved`);
        const typeSelect = document.getElementById(`${prefix}FilterType`);
        const fromInput = document.getElementById(`${prefix}FilterFrom`);
        const toInput = document.getElementById(`${prefix}FilterTo`);
        const searchInput = document.getElementById(`${prefix}SearchInput`);
        if (savedSelect) savedSelect.value = 'all';
        if (typeSelect) typeSelect.value = 'all';
        if (fromInput) fromInput.value = '';
        if (toInput) toInput.value = '';
        if (searchInput) searchInput.value = '';
        // 排序下拉：manager.sort 已由 setData 归零，这里只把触发器文案同步回「默认排序」
        const sd = this.sortDropdowns[prefix];
        if (sd) sd.reset();
        // 时长多选：随筛选条件复位一同清空选中（is-disabled 态由 updateUI → _updateFilterBarState 按类型重置）
        const dd = this.durationDropdowns[prefix];
        if (dd) dd.clear();
    }

    /**
     * ✅ 构建自定义排序下拉：点击选项设置排序键；再次点击当前已选中的键则切换升/降序。
     * 方向以 ↓（降序）/↑（升序）箭头显示在触发器与选项上，直接写入 manager.sort 后刷新列表。
     * @param {string} prefix - 控件 ID 前缀
     * @param {Function} getManager - 返回对应 WorkListManager
     * @param {Function} applyFilters - 条件变化后的刷新回调
     */
    _setupSortDropdown(prefix, getManager, applyFilters) {
        const root = document.getElementById(`${prefix}FilterSort`);
        const trigger = document.getElementById(`${prefix}FilterSortTrigger`);
        const menu = document.getElementById(`${prefix}FilterSortMenu`);
        if (!root || !trigger || !menu) return;

        const OPTIONS = [
            { key: '', label: '默认排序' },
            { key: 'time', label: '按时间' },
            { key: 'status', label: '按保存状态' }
        ];
        const labelEl = trigger.querySelector('.sort-dropdown-label');

        const api = {
            _cache: { key: '', dir: 'desc' },
            _state() {
                const m = getManager();
                if (m && m.sort) {
                    return { key: m.sort.key || '', dir: m.sort.dir === 'asc' ? 'asc' : 'desc' };
                }
                return { key: api._cache.key, dir: api._cache.dir };
            },
            render() {
                const { key, dir } = api._state();
                const opt = OPTIONS.find(o => o.key === key) || OPTIONS[0];
                labelEl.textContent = opt.label + (key ? (dir === 'asc' ? ' ↑' : ' ↓') : '');
                menu.innerHTML = '';
                OPTIONS.forEach(o => {
                    const active = o.key === key;
                    const item = document.createElement('div');
                    item.className = 'sort-dropdown-item' + (active ? ' active' : '');
                    const labelSpan = document.createElement('span');
                    labelSpan.textContent = o.label;
                    const arrowSpan = document.createElement('span');
                    arrowSpan.className = 'sort-dropdown-arrow';
                    arrowSpan.textContent = (active && o.key) ? (dir === 'asc' ? '↑ 升序' : '↓ 降序') : '';
                    item.appendChild(labelSpan);
                    item.appendChild(arrowSpan);
                    item.addEventListener('click', (e) => {
                        e.stopPropagation();
                        api._choose(o.key);
                    });
                    menu.appendChild(item);
                });
            },
            _choose(key) {
                const cur = api._state();
                let dir = 'desc';
                if (key && key === cur.key) {
                    dir = cur.dir === 'asc' ? 'desc' : 'asc'; // ✅ 再次点击同一项 → 切换升/降
                }
                const m = getManager();
                if (m) m.sort = { key, dir };
                api._cache = { key, dir };
                api.close();
                api.render();
                applyFilters();
            },
            reset() {
                api._cache = { key: '', dir: 'desc' };
                api.render();
            },
            open() { root.classList.add('open'); },
            close() { root.classList.remove('open'); },
            toggle() { root.classList.toggle('open'); }
        };

        trigger.addEventListener('click', (e) => {
            e.stopPropagation();
            api.toggle();
        });
        // 点击页面其它处自动收起
        document.addEventListener('click', () => api.close());

        this.sortDropdowns[prefix] = api;
        api.render();
    }

    /**
     * ✅ 构建自定义“时长”多选下拉：档位来自 DURATION_BUCKETS，复选式多选（勾中任一即命中），
     * 多选时不自动收起、点页面其它处收起；选中集写入 manager.filters.durations（由 applyFilters 读取 getSelected）。
     * @param {string} prefix - 控件 ID 前缀
     * @param {Function} applyFilters - 选中变化后的刷新回调
     */
    _setupDurationDropdown(prefix, applyFilters) {
        const root = document.getElementById(`${prefix}FilterDuration`);
        const trigger = document.getElementById(`${prefix}FilterDurationTrigger`);
        const menu = document.getElementById(`${prefix}FilterDurationMenu`);
        if (!root || !trigger || !menu) return;
        const labelEl = trigger.querySelector('.dur-label');

        const api = {
            _selected: new Set(),
            getSelected() { return Array.from(api._selected); },
            render() {
                const n = api._selected.size;
                labelEl.textContent = n ? `时长(${n})` : '时长';
                root.classList.toggle('has-active', n > 0);
                menu.innerHTML = '';
                DURATION_BUCKETS.forEach(b => {
                    const checked = api._selected.has(b.key);
                    const item = document.createElement('div');
                    item.className = 'dur-item' + (checked ? ' checked' : '');
                    const check = document.createElement('span');
                    check.className = 'dur-check';
                    check.textContent = checked ? '☑' : '☐';
                    const label = document.createElement('span');
                    label.textContent = b.label;
                    item.appendChild(check);
                    item.appendChild(label);
                    item.addEventListener('click', (e) => {
                        e.stopPropagation();
                        api._toggle(b.key);
                    });
                    menu.appendChild(item);
                });
            },
            _toggle(key) {
                if (api._selected.has(key)) api._selected.delete(key);
                else api._selected.add(key);
                api.render();
                applyFilters();
            },
            clear() {
                if (api._selected.size === 0) { return; }
                api._selected.clear();
                api.close();
                api.render();
            },
            open() { root.classList.add('open'); },
            close() { root.classList.remove('open'); },
            toggle() { root.classList.toggle('open'); }
        };

        trigger.addEventListener('click', (e) => {
            e.stopPropagation();
            if (root.classList.contains('is-disabled')) return;
            api.toggle();
        });
        // 菜单内点击不关闭（多选），点页面其它处自动收起
        menu.addEventListener('click', (e) => e.stopPropagation());
        document.addEventListener('click', () => api.close());

        this.durationDropdowns[prefix] = api;
        api.render();
    }

    /**
     * ✅ 加载完数据后填充作者多选筛选选项（MultiTagSelector）
     * ≥ 2 个作者时仅启用/显示第一行“按作者筛选”按钮，面板保持收起（由按钮展开）；< 2 个则隐藏按钮
     * @param {string} prefix - 控件 ID 前缀 ('liked' | 'bookmarked')
     * @param {WorkListManager} manager - 对应列表管理器
     */
    refreshAuthorFilterOptions(prefix, manager) {
        if (!manager) return;
        const wrap = document.getElementById(`${prefix}AuthorFilter`);
        const toggle = document.getElementById(`${prefix}AuthorFilterToggle`);
        if (!wrap) return;

        const options = manager.getAuthorOptions();
        if (options.length < 2) {
            // 作者不足 2 个：收起面板、隐藏按钮、清空已有选择（避免残留过滤条件）
            wrap.style.display = 'none';
            if (toggle) { toggle.style.display = 'none'; toggle.disabled = true; }
            const existed = this.authorSelectors[prefix];
            if (existed) existed.clear();
            return;
        }

        // 首次：创建选择器实例（选项 = {id,name,count}，无需按时间排序）
        let selector = this.authorSelectors[prefix];
        if (!selector) {
            selector = new MultiTagSelector({
                containerId: `${prefix}AuthorSelect`,
                prefix: `${prefix}Author`,
                dataKey: 'id',
                labelKey: 'name',
                countKey: 'count',
                sortByTime: false,
                onSelectionChange: () => {
                    this._updateAuthorToggleLabel(prefix);
                    const fn = this._filterApplyFns[prefix];
                    if (fn) fn();
                }
            });
            this.authorSelectors[prefix] = selector;
            selector.init(options);
        } else {
            // 刷新：重建选项列表（与 collects 一致，选择会在刷新时重置）
            selector.updateData(options);
        }

        // 仅显示/启用“按作者筛选”按钮，面板保持当前收起状态（不强制展开）
        if (toggle) { toggle.style.display = ''; toggle.disabled = false; }
        this._updateAuthorToggleLabel(prefix);
    }

    /**
     * ✅ 展开/收起作者筛选面板，并同步按钮文案/箭头
     * @param {string} prefix - 控件 ID 前缀
     */
    _toggleAuthorFilter(prefix) {
        const wrap = document.getElementById(`${prefix}AuthorFilter`);
        if (!wrap) return;
        wrap.style.display = wrap.style.display === 'block' ? 'none' : 'block';
        this._updateAuthorToggleLabel(prefix);
    }

    /**
     * ✅ 更新“按作者筛选”按钮文案（附已选数量与展开/收起箭头）
     * @param {string} prefix - 控件 ID 前缀
     */
    _updateAuthorToggleLabel(prefix) {
        const btn = document.getElementById(`${prefix}AuthorFilterToggle`);
        const wrap = document.getElementById(`${prefix}AuthorFilter`);
        if (!btn) return;
        const selector = this.authorSelectors[prefix];
        const n = selector ? selector.getSelectedIds().size : 0;
        const expanded = !!wrap && wrap.style.display === 'block';
        btn.textContent = `按作者筛选${n ? `（${n}）` : ''} ${expanded ? '▴' : '▾'}`;
    }

    /**
     * ✅ 绑定作者作品钻取视图的搜索/分页/返回控件
     * （筛选栏复用 _bindFilterBar，manager 由视图懒提供）
     */
    bindAuthorWorksView() {
        this._bindFilterBar('authorWorks', () => this.app.authorWorksView?.manager);

        const getManager = () => this.app.authorWorksView?.manager;

        // 获取当前页选中集（分页/搜索/筛选后保持 checkbox 状态，与点赞/收藏一致）
        const getPageSelectedIds = (manager) => {
            const selection = this.app.batchSelectionManager.state.authorWorks;
            if (!selection) return new Set();
            return new Set(manager.getCurrentPageData()
                .filter(work => selection.selectedWorkIds.has(work.workId))
                .map(work => work.workId));
        };

        // 搜索框
        const searchInput = document.getElementById('authorWorksSearchInput');
        if (searchInput) {
            let searchTimer = null;
            searchInput.addEventListener('input', (event) => {
                clearTimeout(searchTimer);
                searchTimer = setTimeout(async () => {
                    const manager = getManager();
                    if (!manager) return;

                    manager.initElements();
                    manager.search(event.target.value);
                    await this.app.refreshListDownloadStatus(manager);
                    manager.updateUI(getPageSelectedIds(manager));
                }, 300);
            });
        }

        // 分页（首页/上一页/下一页/末页 + 跳至，与离线浏览页一致）
        this._bindPagination('authorWorks', getManager, 'authorWorks');

        // 返回作者列表
        const backBtn = document.getElementById('authorWorksBack');
        if (backBtn) {
            backBtn.addEventListener('click', () => {
                this.app.authorWorksView.close();
            });
        }
    }

    /**
     * ✅ 通用分页控件绑定（首页/上一页/下一页/末页 + 跳至输入框），与离线浏览页保持一致
     * @param {string} prefix - 控件 ID 前缀
     * @param {Function} getManager - 返回对应列表管理器
     * @param {string} listType - 列表类型（用于选中集与下载状态刷新判断）
     */
    _bindPagination(prefix, getManager, listType) {
        const cur = () => { const m = getManager(); return m ? m.currentPage : 1; };

        const go = async (targetPage) => {
            const manager = getManager();
            if (!manager) return;
            const totalPages = manager.getTotalPages();
            const p = Math.min(totalPages, Math.max(1, targetPage));
            if (p === manager.currentPage) return;
            manager.goToPage(p);
            await this._applyPageChange(listType, manager);
            logToUI('info', `📄 跳转到第 ${manager.currentPage} 页`);
        };

        const prevBtn = document.getElementById(`${prefix}PrevPage`);
        const nextBtn = document.getElementById(`${prefix}NextPage`);
        const firstBtn = document.getElementById(`${prefix}FirstPage`);
        const lastBtn = document.getElementById(`${prefix}LastPage`);
        const jumpInput = document.getElementById(`${prefix}JumpPage`);

        if (firstBtn) firstBtn.addEventListener('click', () => go(1));
        if (prevBtn) prevBtn.addEventListener('click', () => go(cur() - 1));
        if (nextBtn) nextBtn.addEventListener('click', () => go(cur() + 1));
        if (lastBtn) lastBtn.addEventListener('click', () => { const m = getManager(); if (m) go(m.getTotalPages()); });

        // ✅ 跳页输入框：回车或 change 跳转，页码夹取到 [1, totalPages]
        if (jumpInput) {
            const doJump = () => {
                const p = parseInt(jumpInput.value, 10);
                if (isNaN(p)) return;
                const m = getManager();
                if (!m) return;
                const target = Math.min(m.getTotalPages(), Math.max(1, p));
                jumpInput.value = '';
                go(target);
            };
            jumpInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); doJump(); } });
            jumpInput.addEventListener('change', doJump);
        }
    }

    /**
     * ✅ 翻页后统一刷新：重查下载状态（作品列表）→ 计算当前页选中集 → updateUI
     * @param {string} listType - 'liked' | 'bookmarked' | 'authorWorks' | 'following'
     * @param {Object} manager - 对应列表管理器
     */
    async _applyPageChange(listType, manager) {
        manager.initElements();
        if (listType !== 'following') {
            await this.app.refreshListDownloadStatus(manager);
        }
        const currentPageItems = manager.getCurrentPageData();
        const selection = this.app.batchSelectionManager.state[listType];
        let selectedIds = [];
        if (selection) {
            if (listType === 'following') {
                selectedIds = currentPageItems.filter(a => selection.selectedAuthorIds.has(a.uid)).map(a => a.uid);
            } else {
                selectedIds = currentPageItems.filter(w => selection.selectedWorkIds.has(w.workId)).map(w => w.workId);
            }
        }
        manager.updateUI(new Set(selectedIds));
    }

    /**
     * 绑定点赞列表分页按钮
     */
    bindLikedPagination() {
        this._bindPagination('liked', () => this.app.likedManager, 'liked');
    }

    /**
     * ✅ 绑定收藏列表分页按钮
     */
    bindBookmarkedPagination() {
        this._bindPagination('bookmarked', () => this.app.bookmarkedManager, 'bookmarked');
    }

    /**
     * ✅ 绑定关注列表分页按钮
     */
    bindFollowingPagination() {
        this._bindPagination('following', () => this.app.followingManager, 'following');
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

        // ✅ 作者作品钻取列表（与点赞/收藏同规格：保存按钮 + 复选框 + 点卡片切换选中）
        const authorWorksList = document.getElementById('authorWorksList');
        if (authorWorksList) {
            this._bindListEvents(authorWorksList, 'authorWorks');
        }
    }
    
    /**
     * ✅ 绑定关注列表作者卡片操作（事件委托）
     */
    bindFollowingCardActions() {
        const followingList = document.getElementById('followingList');
        if (!followingList) return;
        
        followingList.addEventListener('click', (event) => {
            // ✅ 优先级 0: 作品钻取按钮（须最先判断，避免落入 download-btn / author-item 逻辑）
            const worksBtn = event.target.closest('.works-btn');
            if (worksBtn) {
                const uid = worksBtn.dataset.uid;
                // ✅ 归一化比较，防 uid 类型不一致（字符串/数字）导致昵称查找失败
                const authorData = this.app.followingManager.allAuthors?.find(a => String(a.uid ?? '') === String(uid ?? ''));
                logger.info(`🎬 钻取作者作品: ${authorData?.nickname || uid}`);
                this.app.authorWorksView.open(uid, authorData?.nickname || '', authorData?.platformId || '');
                return;
            }

            // ✅ 优先级 1: 检查是否点击下载按钮（保存作者所有作品）
            const downloadBtn = event.target.closest('.download-btn');
            if (downloadBtn && !downloadBtn.disabled) {
                const uid = downloadBtn.dataset.uid;
                logger.info(`👤 点击了作者保存按钮: ${uid}`);
                
                // ✅ 获取作者信息
                const authorItem = downloadBtn.closest('.author-item');
                if (!authorItem) return;
                
                const authorData = this.app.followingManager.allAuthors?.find(a => a.uid === uid);
                if (!authorData) {
                    logger.warn(`⚠️ 未找到作者数据: ${uid}`);
                    return;
                }
                
                // ✅ 调用 AuthorDownloadManager，传递 button 引用
                this.app.authorDownloadManager.startAuthorDownload(
                    authorData.uid,
                    authorData.platformId || '',
                    authorData.nickname,
                    downloadBtn  // ✅ 传递按钮DOM引用
                );
                
                // ✅ 获取 batchId（从 DownloadHandler）
                const batchId = this.app.downloadHandler?.currentBatchId;
                
                // ✅ 触发下载（发送消息到 Content Script）
                window.parent.postMessage({
                    source: 'sidebar',
                    type: 'DOWNLOAD_AUTHOR_WORKS',
                    uid: authorData.uid,
                    platformId: authorData.platformId || '',
                    nickname: authorData.nickname,
                    folderPath: this.app.folderName || '',
                    batchId: batchId  // ✅ 携带 batchId
                }, '*');
                
                return;  // ✅ 阻止后续处理
            }
    
            // ✅ 优先级 2: 检查是否点击跳转链接
            const jumpBtn = event.target.closest('.jump-btn');
            if (jumpBtn) {
                // a 标签默认行为即可，不需要额外处理
                return;  // ✅ 阻止后续处理
            }
    
            // ✅ 优先级 3: 检查是否点击复选框
            const checkbox = event.target.closest('.author-checkbox');
            if (checkbox) {
                console.log('[DEBUG] author-checkbox clicked:', checkbox.dataset.uid, checkbox.checked);
                const uid = checkbox.dataset.uid;
                logger.info(`☑️ 作者复选框状态变化: ${uid}, checked=${checkbox.checked}`);
                this.app.batchSelectionManager.handleCheckboxChange('following', uid, checkbox.checked);
                return;  // ✅ 阻止后续处理
            }
    
            // ✅ 优先级 4: 点击卡片任意位置，切换复选框状态
            const authorItem = event.target.closest('.author-item');
            if (authorItem) {
                const uid = authorItem.dataset.uid;
                const cardCheckbox = authorItem.querySelector('.author-checkbox');
    
                if (cardCheckbox && !cardCheckbox.disabled) {
                    // 切换复选框状态
                    cardCheckbox.checked = !cardCheckbox.checked;
    
                    // 触发 change 事件（手动）
                    logger.info(`☑️ 点击卡片切换作者复选框: ${uid}, checked=${cardCheckbox.checked}`);
                    this.app.batchSelectionManager.handleCheckboxChange('following', uid, cardCheckbox.checked);
                }
                return;  // ✅ 阻止后续处理
            }
        });
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
                // ✅ 已有保存任务进行中时忽略（“已保存”按钮现常驻可点，防止误点另起批量抢占 content 侧当前批次）
                if (this.app.downloadHandler?.isDownloading) {
                    logToUI('warning', '⚠️ 已有保存任务进行中，请等待完成或先停止');
                    return;
                }
                logger.info(`👆 点击了下载按钮: ${workId}`);
                
                // ✅ 根据列表类型调用对应的独立方法
                if (listType === 'liked') {
                    this.app.handleLikedDownload([workId]);
                } else if (listType === 'bookmarked') {
                    this.app.handleBookmarkedDownload([workId]);
                } else if (listType === 'authorWorks') {
                    this.app.handleAuthorWorksDownload([workId]);
                }
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
            this._buildBatchScopeDropdown('liked', true);
        }

        if (likedBatchDownloadBtn) {
            likedBatchDownloadBtn.addEventListener('click', () => this._onWorksBatchButtonClick('liked'));
        }

        if (likedStopDownloadBtn) {
            likedStopDownloadBtn.addEventListener('click', () => {
                this.app.handleStopDownload('liked');
            });
        }
    }

    /**
     * 绑定收藏列表批量操作
     */
    bindBookmarkedBatchOperations() {
        const bookmarkedBatchSelect = document.getElementById('bookmarkedBatchSelect');
        const bookmarkedBatchDownloadBtn = document.querySelector('.batch-download-btn[data-type="bookmarked"]');
        const bookmarkedStopDownloadBtn = document.querySelector('#tabContentBookmarked .stop-download-btn');

        if (bookmarkedBatchSelect) {
            this._buildBatchScopeDropdown('bookmarked', true);
        }

        if (bookmarkedBatchDownloadBtn) {
            bookmarkedBatchDownloadBtn.addEventListener('click', () => this._onWorksBatchButtonClick('bookmarked'));
        }

        if (bookmarkedStopDownloadBtn) {
            bookmarkedStopDownloadBtn.addEventListener('click', () => {
                this.app.handleStopDownload('bookmarked');
            });
        }
    }

    /**
     * 绑定关注列表批量操作
     */
    bindFollowingBatchOperations() {
        const followingBatchSelect = document.getElementById('followingBatchSelect');
        const followingBatchDownloadBtn = document.querySelector('.batch-download-btn[data-type="following"]');
        const followingStopDownloadBtn = document.querySelector('#tabContentFollowing .stop-download-btn');

        if (followingBatchSelect) {
            this._buildBatchScopeDropdown('following', false);
        }

        if (followingBatchDownloadBtn) {
            followingBatchDownloadBtn.addEventListener('click', () => {
                const selectedUids = this.app.batchSelectionManager.getSelectedAuthorIds();
                this.app.handleAuthorDownload(selectedUids);
            });
        }

        if (followingStopDownloadBtn) {
            followingStopDownloadBtn.addEventListener('click', () => {
                this.app.handleStopDownload('following');
            });
        }
    }

    /**
     * ✅ 绑定作者作品钻取视图批量操作（与点赞/收藏同规格）
     * 注意：stop 按钮须用 #authorWorksBatchActions 作用域（钻取块嵌套在 tabContentFollowing 内，
     * 全局选择器会先命中关注列表自己的按钮）
     */
    bindAuthorWorksBatchOperations() {
        const batchSelect = document.getElementById('authorWorksBatchSelect');
        const batchDownloadBtn = document.querySelector('.batch-download-btn[data-type="authorWorks"]');
        const stopDownloadBtn = document.querySelector('#authorWorksBatchActions .stop-download-btn');

        if (batchSelect) {
            this._buildBatchScopeDropdown('authorWorks', true);
        }

        if (batchDownloadBtn) {
            batchDownloadBtn.addEventListener('click', () => this._onWorksBatchButtonClick('authorWorks'));
        }

        if (stopDownloadBtn) {
            stopDownloadBtn.addEventListener('click', () => {
                this.app.handleStopDownload('authorWorks');
            });
        }
    }
    
    /**
     * ✅ 构建自定义“批量选择”作用域下拉（替换原生 select）
     * 原生 select 无法给单项高亮、也捕捉不到“再次点同一项”的切换，故自建下拉：
     *  - 点作用域项 → 勾选 + 该项标蓝（记 state.activeScope）；再次点已高亮项 → 取消勾选 + 去高亮
     *  - 'saved'（仅作品列表）额外联动：锁筛选到“已保存”(不可改) + 当前页已保存作品全勾选且复选框解禁可逐卡操作
     *  - 高亮持续到用户主动切换/取消；手动逐个勾选不改高亮（activeScope 独立于 batchMode）
     * @param {string} listType - 'liked' | 'bookmarked' | 'authorWorks' | 'following'
     * @param {boolean} isWorks - 是否作品列表（决定是否有“已保存（补全）”项）
     */
    _buildBatchScopeDropdown(listType, isWorks) {
        const root = document.getElementById(`${listType}BatchSelect`);
        const trigger = document.getElementById(`${listType}BatchSelectTrigger`);
        const menu = document.getElementById(`${listType}BatchSelectMenu`);
        if (!root || !trigger || !menu) return;
        const labelEl = trigger.querySelector('.batch-scope-label');

        const OPTIONS = isWorks
            ? [
                { value: 'current', label: '当前页作品' },
                { value: 'all', label: '所有作品' },
                { value: 'saved', label: '已保存（补全）' }
            ]
            : [
                { value: 'current', label: '当前页作者' },
                { value: 'all', label: '所有作者' }
            ];

        const sel = this.app.batchSelectionManager;
        const closeMenu = () => root.classList.remove('open');

        const paintMenu = () => {
            menu.innerHTML = '';
            const cur = (sel.state[listType] && sel.state[listType].activeScope) || '';
            OPTIONS.forEach(o => {
                const item = document.createElement('div');
                item.className = 'batch-scope-item' + (o.value === cur ? ' active' : '');
                const t = document.createElement('span');
                t.textContent = o.label;
                item.appendChild(t);
                if (o.value === cur) {
                    const c = document.createElement('span');
                    c.className = 'batch-scope-check';
                    c.textContent = '✓';
                    item.appendChild(c);
                }
                item.addEventListener('click', (e) => {
                    e.stopPropagation();
                    closeMenu();
                    this._onBatchScopePick(listType, o.value);
                });
                menu.appendChild(item);
            });
        };

        const refresh = () => {
            const cur = (sel.state[listType] && sel.state[listType].activeScope) || '';
            const opt = OPTIONS.find(o => o.value === cur);
            if (labelEl) labelEl.textContent = opt ? opt.label : '-- 批量选择 --';
            trigger.classList.toggle('is-active', !!cur);
            if (root.classList.contains('open')) paintMenu();
        };
        this.app.batchScopeRenderers = this.app.batchScopeRenderers || {};
        this.app.batchScopeRenderers[listType] = refresh;

        // 解锁“状态”筛选：仅当之前被补全态锁定过（值仍为 downloaded 且已退出 backfillMode）时恢复
        this.app.batchScopeUnlockers = this.app.batchScopeUnlockers || {};
        this.app.batchScopeUnlockers[listType] = () => {
            const savedSelect = document.getElementById(`${listType}FilterSaved`);
            const stillBackfill = !!(sel.state[listType] && sel.state[listType].backfillMode);
            if (savedSelect && !stillBackfill && savedSelect.value === 'downloaded') {
                savedSelect.value = 'all';
                savedSelect.disabled = false;
                this._filterApplyFns[listType]?.();
            }
            refresh();
        };

        trigger.addEventListener('click', (e) => {
            e.stopPropagation();
            if (root.classList.contains('open')) {
                closeMenu();
            } else {
                document.querySelectorAll('.batch-scope-dropdown.open').forEach(d => d.classList.remove('open'));
                paintMenu();
                root.classList.add('open');
            }
        });
        document.addEventListener('click', () => closeMenu());

        refresh();
    }

    /**
     * ✅ 点击作用域项：在当前作用域与目标项间做“选中 / 切换 / 取消”三态处理
     * @param {string} listType
     * @param {'current'|'all'|'saved'} value - 被点击的项
     */
    async _onBatchScopePick(listType, value) {
        const sel = this.app.batchSelectionManager;
        const state = sel.state[listType];
        const manager = sel._getManager(listType);
        const savedSelect = document.getElementById(`${listType}FilterSaved`);
        const apply = this._filterApplyFns[listType];
        const cur = (state && state.activeScope) || '';

        if (value === 'saved') {
            // 再次点击已高亮的 saved → 取消补全（clearSelection 会联动解锁+刷新）
            if (cur === 'saved') { sel.clearSelection(listType); return; }
            // 进入补全态：切渲染意图 + 标记规则 + 锁筛选到“已保存”，随后 applyFilters 重算并全勾选当前页已保存作品
            if (state) { state.backfillMode = true; state.batchMode = 'saved'; state.activeScope = 'saved'; }
            if (manager) manager.backfillMode = true;
            if (savedSelect) savedSelect.value = 'downloaded';
            if (apply) await apply();
            this._refreshBatchScope(listType);
            return;
        }

        // current/all：点已高亮项=取消（→''），否则=切换到该项
        const target = (cur === value) ? '' : value;
        const wasBackfill = !!(state && state.backfillMode);
        if (wasBackfill) {
            // 从补全态切走：先复位补全态与渲染意图、解除筛选锁定并重渲，再执行目标作用域选择
            if (state) { state.backfillMode = false; state.batchMode = null; } // 清掉残留 'saved' 规则，避免 applyFilters 内 reapply 短暂按补全口径重算
            if (manager) manager.backfillMode = false;
            if (savedSelect) { savedSelect.value = 'all'; savedSelect.disabled = false; }
            if (apply) await apply();
        }
        if (state) state.activeScope = target || null;
        sel.handleBatchSelectionChange(listType, target);
        this._refreshBatchScope(listType);
    }

    /**
     * ✅ 主动刷新指定列表的“批量选择”下拉高亮（绕过 updateBatchSelectionUI 的时机补漏）
     * @param {string} listType
     */
    _refreshBatchScope(listType) {
        this.app.batchScopeRenderers?.[listType]?.();
    }

    /**
     * ✅ 作品列表批量按钮统一点击入口（复用同一个按钮，按当前是否处于补全态分流）
     * - 普通态（批量保存）：直接提交选中作品走下载管线
     * - 补全态（校验补全）：先弹说明对话框（作用 + 仅限当前页原因），确定才提交，取消仅关框
     * @param {string} listType - 'liked' | 'bookmarked' | 'authorWorks'
     */
    async _onWorksBatchButtonClick(listType) {
        const sel = this.app.batchSelectionManager;
        const selectedIds = sel.getSelectedWorkIds(listType);
        const isBackfill = !!(sel.state[listType] && sel.state[listType].backfillMode);
        if (isBackfill) {
            const ok = await showConfirmModal({
                title: '校验补全说明',
                message: '「校验补全」会对当前页已标记为“已保存”的作品逐个核对本地文件，仅补下缺失的图片/封面/音频，已完整的会自动跳过。\n\n为何只能作用于当前页、不能全选所有作品？因为补全每个作品都需实时拉取一次作品详情来得到应有的文件清单，跨全部分页核对会产生海量请求、开销大且易触发平台风控，故仅限当前页。\n\n是否开始校验补全选中的 ' + selectedIds.length + ' 个作品？',
                okText: '开始补全',
                cancelText: '取消'
            });
            if (!ok) return;
        }
        this._dispatchWorksDownload(listType, selectedIds);
    }

    /**
     * 根据列表类型调用对应的批量下载入口（补全与下载同一管线，管线内部已支持逐文件补缺）
     * @param {string} listType
     * @param {Array} ids - 作品 workId 数组
     */
    _dispatchWorksDownload(listType, ids) {
        if (listType === 'liked') this.app.handleLikedDownload(ids);
        else if (listType === 'bookmarked') this.app.handleBookmarkedDownload(ids);
        else if (listType === 'authorWorks') this.app.handleAuthorWorksDownload(ids);
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
