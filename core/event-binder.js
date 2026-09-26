// ==========================================
// FavGallery - DOM 事件绑定器
// 职责：统一管理所有 DOM 事件绑定（按钮点击、Tab 切换、搜索、分页、批量操作等）
// ==========================================

import { createLogger, logToUI } from '../utils/logger.js';
import { CONFIG } from '../config/constants.js';

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
        const entryName = CONFIG.FILE_SYSTEM.OFFLINE_ENTRY_HTML;

        let body;
        if (res.reason === 'need-file-access') {
            // 已捕获路径，但未开「允许访问文件网址」→ 开 file:// 被拦
            body =
                `📂 已记住本地库路径，但浏览器拦截了打开操作。<br>` +
                `请在 <strong>chrome://extensions</strong> → 本扩展「详情」里开启 <strong>「允许访问文件网址」</strong>，之后点这个按钮即可一键直达。<br>`;
        } else {
            // 尚无路径（从没打开过）→ 种子引导
            body =
                `📂 本地库入口文件：<strong>${entryName}</strong><br>` +
                `首次使用请手动打开一次：在文件管理器中打开你选择的文件夹「<strong>${folderName}</strong>」，双击其中的 <strong>${entryName}</strong> 即可离线浏览。<br>` +
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
     * ✅ 绑定关注列表分页按钮
     */
    bindFollowingPagination() {
        const prevBtn = document.getElementById('followingPrevPage');
        const nextBtn = document.getElementById('followingNextPage');
        const manager = this.app.followingManager;
    
        if (prevBtn) {
            prevBtn.addEventListener('click', async () => {
                manager.initElements();
                manager.prevPage();
    
                // ✅ UI 日志
                logToUI('info', `⬅️ 切换到第 ${manager.currentPage} 页`);
    
                // ✅ 获取当前页的选中状态，传递给 updateUI
                const currentPageItems = manager.getCurrentPageData();
                const selectedIds = currentPageItems
                    .filter(author => this.app.batchSelectionManager.state.following.selectedAuthorIds.has(author.uid))
                    .map(author => author.uid);
                logger.info(`🔍 分页后同步 checkbox: 当前页 ${currentPageItems.length} 个作者, 选中 ${selectedIds.length} 个`);
                logger.info(`🔍 内存中的选中状态: ${this.app.batchSelectionManager.state.following.selectedAuthorIds.size} 个`);
    
                // ✅ 在渲染时直接传递选中状态，消除闪烁
                manager.updateUI(new Set(selectedIds));
            });
        }
    
        if (nextBtn) {
            nextBtn.addEventListener('click', async () => {
                manager.initElements();
                manager.nextPage();
    
                // ✅ UI 日志
                logToUI('info', `➡️ 切换到第 ${manager.currentPage} 页`);
    
                // ✅ 获取当前页的选中状态，传递给 updateUI
                const currentPageItems = manager.getCurrentPageData();
                const selectedIds = currentPageItems
                    .filter(author => this.app.batchSelectionManager.state.following.selectedAuthorIds.has(author.uid))
                    .map(author => author.uid);
                logger.info(`🔍 分页后同步 checkbox: 当前页 ${currentPageItems.length} 个作者, 选中 ${selectedIds.length} 个`);
                logger.info(`🔍 内存中的选中状态: ${this.app.batchSelectionManager.state.following.selectedAuthorIds.size} 个`);
    
                // ✅ 在渲染时直接传递选中状态，消除闪烁
                manager.updateUI(new Set(selectedIds));
            });
        }
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
     * ✅ 绑定关注列表作者卡片操作（事件委托）
     */
    bindFollowingCardActions() {
        const followingList = document.getElementById('followingList');
        if (!followingList) return;
        
        followingList.addEventListener('click', (event) => {
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
                logger.info(`👆 点击了下载按钮: ${workId}`);
                
                // ✅ 根据当前标签页调用对应的独立方法
                if (listType === 'liked') {
                    this.app.handleLikedDownload([workId]);
                } else if (listType === 'bookmarked') {
                    this.app.handleBookmarkedDownload([workId]);
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
            likedBatchSelect.addEventListener('change', (event) => {
                this.app.handleBatchSelectionChange('liked', event.target.value);
            });
        }

        if (likedBatchDownloadBtn) {
            likedBatchDownloadBtn.addEventListener('click', () => {
                const selectedIds = this.app.batchSelectionManager.getSelectedWorkIds('liked');
                this.app.handleLikedDownload(selectedIds);
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
                const selectedIds = this.app.batchSelectionManager.getSelectedWorkIds('bookmarked');
                this.app.handleBookmarkedDownload(selectedIds);
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
