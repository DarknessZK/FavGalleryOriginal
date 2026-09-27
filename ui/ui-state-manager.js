// ==========================================
// UI 状态管理器
// 功能：控制按钮启用/禁用、加载状态、作品下载状态等
// ==========================================

import { createLogger, logToUI } from '../utils/logger.js';

const logger = createLogger('UIStateManager');

export class UIStateManager {
    constructor(app) {
        this.app = app;
    }

    /**
     * 启用相关按钮（文件夹选择后）
     */
    enableButtons() {
        logger.info('启用相关按钮...');
        
        // 启用刷新列表按钮
        const loadFollowingBtn = document.getElementById('loadFollowing');
        const loadLikedBtn = document.getElementById('loadLiked');
        const loadBookmarkedBtn = document.getElementById('loadBookmarked');
        
        if (loadFollowingBtn) {
            loadFollowingBtn.disabled = false;
            loadFollowingBtn.title = '';
        }
        
        if (loadLikedBtn) {
            loadLikedBtn.disabled = false;
            loadLikedBtn.title = '';
        }
        
        if (loadBookmarkedBtn) {
            loadBookmarkedBtn.disabled = false;
            loadBookmarkedBtn.title = '';
        }
        
        // 启用搜索框
        const searchInput = document.getElementById('searchInput');
        const likedSearchInput = document.getElementById('likedSearchInput');
        const bookmarkedSearchInput = document.getElementById('bookmarkedSearchInput');
        
        if (searchInput) {
            searchInput.disabled = false;
            searchInput.placeholder = '搜索用户名或抖音号...';
        }
        
        if (likedSearchInput) {
            likedSearchInput.disabled = false;
            likedSearchInput.placeholder = '搜索作品描述或作者...';
        }
        
        if (bookmarkedSearchInput) {
            bookmarkedSearchInput.disabled = false;
            bookmarkedSearchInput.placeholder = '搜索作品描述或作者...';
        }

        // ✅ 启用高级筛选栏（与搜索框同步）
        ['liked', 'bookmarked'].forEach(prefix => {
            ['FilterSaved', 'FilterFrom', 'FilterTo', 'FilterReset'].forEach(suffix => {
                const el = document.getElementById(`${prefix}${suffix}`);
                if (el) el.disabled = false;
            });
        });
        
        // ✅ 启用侧边栏模式切换开关
        const sidebarModeToggle = document.getElementById('sidebarModeToggle');
        if (sidebarModeToggle) {
            sidebarModeToggle.classList.remove('disabled');
        }
        
        // ✅ 启用“打开本地库”按钮（引导用户手动打开入口文件）
        const openLibraryBtn = document.getElementById('openLibrary');
        if (openLibraryBtn) {
            openLibraryBtn.disabled = false;
        }

        logger.info('✅ 按钮已启用');
    }

    /**
     * ✅ 设置恢复状态（显示/隐藏恢复提示条）
     * @param {boolean} isRestoring - 是否正在恢复
     * @param {string} message - 提示信息
     */
    setRestoreState(isRestoring, message = '') {
        const restoreStatus = document.getElementById('restoreStatus');
        const restoreStatusText = document.getElementById('restoreStatusText');
        
        if (restoreStatus && restoreStatusText) {
            if (isRestoring) {
                restoreStatus.style.display = 'block';
                restoreStatusText.textContent = message || '🔄 正在从备份恢复数据...';
                logger.info('🔄 显示恢复状态:', message);
            } else {
                restoreStatus.style.display = 'none';
                logger.info('✅ 隐藏恢复状态');
            }
        } else {
            logger.warn('⚠️ 未找到恢复状态元素');
        }
    }

    /**
     * 显示状态消息到 UI
     * @param {string} elementId - 状态元素 ID
     * @param {string} message - 消息内容
     * @param {string} color - 文字颜色
     */
    showStatusMessage(elementId, message, color = '#666') {
        const statusEl = document.getElementById(elementId);
        logger.info(`📝 尝试显示状态消息:`, {
            elementId,
            found: !!statusEl,
            message,
            color
        });
        if (statusEl) {
            statusEl.innerHTML = `<div style="color: ${color};">${message}</div>`;
            logger.info(`✅ 状态消息已显示: ${elementId}`);
        } else {
            logger.warn(`⚠️ 未找到状态元素: ${elementId}`);
        }
    }

    /**
     * 禁用所有控制按钮（选择文件夹、加载列表、Tab 切换、批量操作）
     */
    disableAllControlButtons() {
        // ✅ 1. 禁用功能按钮
        const buttonIds = ['selectFolder', 'loadLiked', 'loadBookmarked', 'loadFollowing'];
        
        buttonIds.forEach(id => {
            const btn = document.getElementById(id);
            if (btn) {
                btn.disabled = true;
                btn.title = '保存进行中，请稍候...';
                btn.style.opacity = '0.5';
                btn.style.cursor = 'not-allowed';
            }
        });
        
        // ✅ 2. 禁用 Tab 切换按钮（防止下载时切换列表）
        const tabButtonIds = ['tabFollowing', 'tabLiked', 'tabBookmarked'];
        const disabledTabs = [];
        
        tabButtonIds.forEach(id => {
            const btn = document.getElementById(id);
            if (btn && !btn.classList.contains('active')) {  // 不禁用当前激活的 Tab
                btn.disabled = true;
                btn.title = '保存进行中，请稍候...';
                btn.style.opacity = '0.5';
                btn.style.cursor = 'not-allowed';
                
                // 记录被禁用的 Tab 名称
                const tabNames = {
                    'tabFollowing': '关注',
                    'tabLiked': '点赞',
                    'tabBookmarked': '收藏'
                };
                disabledTabs.push(tabNames[id]);
            }
        });
        
        // ✅ UI 日志：记录禁用了哪些 Tab
        if (disabledTabs.length > 0) {
            logToUI('warning', `🔒 下载中，已禁用切换: ${disabledTabs.join('、')}`);
        }
        
        // ✅ 3. 禁用所有批量下载按钮
        document.querySelectorAll('.batch-download-btn').forEach(btn => {
            btn.disabled = true;
            btn.style.opacity = '0.5';
            btn.style.cursor = 'not-allowed';
            btn.title = '保存进行中，请稍候...';
        });
        
        // ✅ 4. 禁用分页按钮（防止下载时翻页导致状态混乱）
        const paginationButtonIds = [
            'likedPrevPage', 'likedNextPage',
            'bookmarkedPrevPage', 'bookmarkedNextPage',
            'followingPrevPage', 'followingNextPage',
            'authorWorksPrevPage', 'authorWorksNextPage'
        ];
        
        paginationButtonIds.forEach(id => {
            const btn = document.getElementById(id);
            if (btn) {
                btn.disabled = true;
                btn.style.opacity = '0.5';
                btn.style.cursor = 'not-allowed';
                btn.title = '保存进行中，请稍候...';
            }
        });
        
        // ✅ 5. 禁用高级筛选栏（防止下载中变更筛选导致状态混乱）
        ['liked', 'bookmarked'].forEach(prefix => {
            ['FilterSaved', 'FilterFrom', 'FilterTo', 'FilterReset'].forEach(suffix => {
                const el = document.getElementById(`${prefix}${suffix}`);
                if (el) el.disabled = true;
            });
        });

        // ✅ 6. 禁用侧边栏模式切换开关（防止备份冲突）
        const sidebarModeToggle = document.getElementById('sidebarModeToggle');
        if (sidebarModeToggle) {
            sidebarModeToggle.classList.add('disabled');
        }
        
        // ✅ 注意：停止按钮的状态由调用方控制
        // - 单个作品下载：保持禁用状态（不做处理）
        // - 批量下载：需要在调用 disableAllControlButtons() 后手动启用
        
        logger.info('🔒 已禁用所有控制按钮（包括 Tab 切换和批量操作）');
    }
    
    /**
     * 启用所有控制按钮（包括 Tab 切换）
     */
    enableAllControlButtons() {
        // ✅ 1. 启用功能按钮
        const buttonIds = ['selectFolder', 'loadLiked', 'loadBookmarked', 'loadFollowing'];
        
        buttonIds.forEach(id => {
            const btn = document.getElementById(id);
            if (btn) {
                btn.disabled = false;
                btn.title = '';
                btn.style.opacity = '1';
                btn.style.cursor = 'pointer';
            }
        });
        
        // ✅ 2. 启用 Tab 切换按钮
        const tabButtonIds = ['tabFollowing', 'tabLiked', 'tabBookmarked'];
        const enabledTabs = [];
        
        tabButtonIds.forEach(id => {
            const btn = document.getElementById(id);
            if (btn) {
                btn.disabled = false;
                btn.title = '';
                btn.style.opacity = '1';
                btn.style.cursor = 'pointer';
                
                // 记录被启用的 Tab 名称
                const tabNames = {
                    'tabFollowing': '关注',
                    'tabLiked': '点赞',
                    'tabBookmarked': '收藏'
                };
                enabledTabs.push(tabNames[id]);
            }
        });
        
        // ✅ UI 日志：记录启用了哪些 Tab
        if (enabledTabs.length > 0) {
            logToUI('success', `🔓 已恢复切换: ${enabledTabs.join('、')}`);
        }
        
        // ✅ 3. 恢复分页按钮可用态（强制 disabled=false 会越过各列表自己的分页边界，
        //    导致钻取视图等单页列表按钮被误启用，点击后因 goToPage 守卫无效又立即置灰；
        //    统一交回各 manager 的 updatePaginationControls 按真实数据状态恢复）
        const paginationManagers = [
            this.app.likedManager,
            this.app.bookmarkedManager,
            this.app.followingManager,
            this.app.authorWorksView?.manager
        ];
        const paginationButtonIdsClearTitle = [
            'likedPrevPage', 'likedNextPage',
            'bookmarkedPrevPage', 'bookmarkedNextPage',
            'followingPrevPage', 'followingNextPage',
            'authorWorksPrevPage', 'authorWorksNextPage'
        ];
        paginationManagers.forEach(manager => {
            try {
                manager?.updatePaginationControls();
            } catch (e) {
                // 个别列表状态未就绪时忽略，其数据渲染完成后的 updateUI 会自行恢复按钮状态
            }
        });
        paginationButtonIdsClearTitle.forEach(id => {
            const btn = document.getElementById(id);
            if (btn) btn.title = '';
        });
        
        // ✅ 4. 启用高级筛选栏
        ['liked', 'bookmarked'].forEach(prefix => {
            ['FilterSaved', 'FilterFrom', 'FilterTo', 'FilterReset'].forEach(suffix => {
                const el = document.getElementById(`${prefix}${suffix}`);
                if (el) el.disabled = false;
            });
        });

        // ✅ 5. 禁用停止下载按钮（下载已完成）
        document.querySelectorAll('.stop-download-btn').forEach(btn => {
            btn.disabled = true;
            btn.style.opacity = '0.5';
            btn.style.cursor = 'not-allowed';
            btn.title = '';
        });
        
        // ✅ 6. 启用侧边栏模式切换开关
        const sidebarModeToggle = document.getElementById('sidebarModeToggle');
        if (sidebarModeToggle) {
            sidebarModeToggle.classList.remove('disabled');
        }
        
        logger.info('🔓 已启用所有控制按钮（包括 Tab 切换和分页）');
    }
    
    /**
     * 禁用所有作品卡片的下载按钮（防止并发）
     */
    disableAllWorkDownloadButtons() {
        const downloadBtns = document.querySelectorAll('.download-btn');
        downloadBtns.forEach(btn => {
            // 只禁用未完成状态的按钮
            if (!btn.disabled && !btn.textContent.includes('已保存')) {
                btn.disabled = true;
                btn.style.opacity = '0.5';
                btn.style.cursor = 'not-allowed';
            }
        });
    }
    
    /**
     * ✅ 启用选择文件夹按钮
     */
    enableFolderButton() {
        const btn = document.getElementById('selectFolder');
        if (btn) {
            btn.disabled = false;
            btn.title = '';
            btn.style.opacity = '1';
            btn.style.cursor = 'pointer';
        }
    }
    
    /**
     * ✅ 启用加载点赞按钮
     */
    enableLoadLikedButton() {
        const btn = document.getElementById('loadLiked');
        if (btn) {
            btn.disabled = false;
            btn.title = '';
            btn.style.opacity = '1';
            btn.style.cursor = 'pointer';
        }
    }
    
    /**
     * ✅ 启用批量停止按钮
     */
    enableStopDownloadButton() {
        document.querySelectorAll('.stop-download-btn').forEach(btn => {
            btn.disabled = false;
            btn.style.opacity = '1';
            btn.style.cursor = 'pointer';
            btn.title = '点击停止批量保存';
        });
        logger.info('✅ 已启用批量停止按钮');
    }
    
    /**
     * ✅ 禁用批量停止按钮
     */
    disableStopDownloadButton() {
        document.querySelectorAll('.stop-download-btn').forEach(btn => {
            btn.disabled = true;
            btn.style.opacity = '0.5';
            btn.style.cursor = 'not-allowed';
            btn.title = '';
        });
        logger.info('🔒 已禁用批量停止按钮');
    }
    
    /**
     * 启用所有作品卡片的下载按钮（pending/failed/error 状态）
     */
    enableAllWorkDownloadButtons() {
        const downloadBtns = document.querySelectorAll('.download-btn');
        
        downloadBtns.forEach(btn => {
            const text = btn.textContent.trim();
            const isCompleted = text.includes('已保存');
            const workId = btn.getAttribute('data-work-id');
            
            // 恢复所有未完成的按钮（除了"已保存"状态）
            if (!isCompleted) {
                // ✅ 将"等待中"状态的按钮恢复到初始状态
                if (text.includes('等待中')) {
                    btn.innerHTML = '<span style="display: block; text-align: center;">⬇️ 保存</span>';
                    btn.style.background = '#1890ff';  // 蓝色
                    btn.style.cursor = 'pointer';
                    btn.disabled = false;
                    btn.style.opacity = '1';
                    btn.title = '';
                } else {
                    // 其他状态（failed/error）只需启用
                    btn.disabled = false;
                    btn.style.opacity = '1';
                    btn.style.cursor = 'pointer';
                }
                
                // ✅ 同时恢复对应的复选框
                if (workId) {
                    this.enableWorkCheckbox(workId);
                }
            }
        });
    }
    
    /**
     * 设置作品下载状态（UI 更新）
     * @param {string} workId - 作品ID
     * @param {string} status - 状态：'downloading' | 'completed' | 'failed' | 'error'
     * @param {string} message - 消息（可选）
     */
    setWorkDownloadStatus(workId, status, message = '') {
        const downloadBtn = document.querySelector(`.download-btn[data-work-id="${workId}"]`);
        if (!downloadBtn) return;
        
        switch (status) {
            case 'downloading':
                // ✅ 清除所有子元素
                downloadBtn.innerHTML = '';
                
                // ✅ 确保按钮有 position: relative（防止进度条溢出）
                downloadBtn.style.position = 'relative';
                downloadBtn.style.overflow = 'hidden';
                
                // ✅ 创建进度条容器
                const progressBar = document.createElement('div');
                progressBar.className = 'progress-bar';
                progressBar.style.cssText = `
                    position: absolute;
                    top: 0;
                    left: 0;
                    width: 0%;
                    height: 100%;
                    background: linear-gradient(90deg, #52c41a, #73d13d);
                    transition: width 0.3s ease;
                    z-index: 0;
                `;
                downloadBtn.appendChild(progressBar);
                
                // ✅ 创建文字容器
                const textSpan = document.createElement('span');
                textSpan.className = 'btn-text';
                textSpan.textContent = '⏳ 保存中...';
                textSpan.style.cssText = `
                    position: relative;
                    z-index: 1;
                    color: white;
                    display: block;
                    text-align: center;
                `;
                downloadBtn.appendChild(textSpan);
                
                // ✅ 模拟进度增长：0% → 90%（分阶段）
                let currentProgress = 0;
                const simulateProgress = () => {
                    if (currentProgress < 90) {
                        // 前期快，后期慢
                        const increment = currentProgress < 50 ? 3 : 1.5;
                        currentProgress += increment;
                        if (currentProgress > 90) currentProgress = 90;
                        
                        progressBar.style.width = currentProgress + '%';
                        
                        // 继续增长
                        setTimeout(simulateProgress, 400);
                    }
                };
                
                // 启动模拟进度
                simulateProgress();
                
                downloadBtn.style.background = '#999';
                downloadBtn.disabled = true;
                break;
                
            case 'completed':
                downloadBtn.innerHTML = '<span style="display: block; text-align: center;">✅ 已保存</span>';
                downloadBtn.style.background = '#52c41a';
                downloadBtn.style.cursor = 'default';
                downloadBtn.disabled = true;
                
                // ✅ 禁用对应的复选框
                this.disableWorkCheckbox(workId);
                break;
                
            case 'failed':
                downloadBtn.innerHTML = '<span style="display: block; text-align: center;">❌ 重试</span>';
                downloadBtn.style.background = '#ff4d4f';
                downloadBtn.style.cursor = 'pointer';
                downloadBtn.disabled = false;
                downloadBtn.title = message;
                break;
                
            case 'error':
                downloadBtn.innerHTML = '<span style="display: block; text-align: center;">⚠️ 异常</span>';
                downloadBtn.style.background = '#ff7a45';
                downloadBtn.style.cursor = 'pointer';
                downloadBtn.disabled = false;
                downloadBtn.title = message;
                break;
        }
    }
    
    /**
     * 禁用作品对应的复选框（下载成功后调用）
     * @param {string} workId - 作品ID
     */
    disableWorkCheckbox(workId) {
        const checkbox = document.querySelector(`.work-checkbox[data-work-id="${workId}"]`);
        if (checkbox) {
            checkbox.disabled = true;
            checkbox.style.opacity = '0.5';
            checkbox.style.cursor = 'not-allowed';
        }
    }
    
    /**
     * 启用作品对应的复选框（停止下载后调用）
     * @param {string} workId - 作品ID
     */
    enableWorkCheckbox(workId) {
        const checkbox = document.querySelector(`.work-checkbox[data-work-id="${workId}"]`);
        if (checkbox) {
            checkbox.disabled = false;
            checkbox.style.opacity = '1';
            checkbox.style.cursor = 'pointer';
        }
    }

    /**
     * 设置下载状态（启用/禁用按钮）
     * @param {boolean} isDownloading - 是否正在下载
     */
    setDownloadingState(isDownloading) {
        logger.info(`🔄 设置下载状态: ${isDownloading ? '下载中' : '空闲'}`);
        
        // ✅ 恢复所有控制按钮
        if (!isDownloading) {
            this.enableAllControlButtons();
            this.enableAllWorkDownloadButtons();
        }
    }

    /**
     * 更新选中计数和批量下载按钮状态
     * @param {string} listType - 列表类型：'liked' | 'bookmarked' | 'following'
     */
    updateSelectedCount(listType) {
        // ✅ 委托给 BatchSelectionManager
        if (this.app.batchSelectionManager) {
            this.app.batchSelectionManager.updateBatchSelectionUI(listType);
        }
    }

    /**
     * 处理批量选择（委托给 BatchSelectionManager）
     * @param {string} listType - 列表类型
     * @param {string} value - 选择类型：'current' | 'all'
     */
    handleBatchSelect(listType, value) {
        if (this.app.batchSelectionManager) {
            this.app.batchSelectionManager.handleBatchSelectionChange(listType, value);
        }
    }
}


