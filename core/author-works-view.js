// ==========================================
// FavGallery - 关注列表「作者作品钻取」子视图
// 职责：在关注 Tab 内切换 作者列表 ↔ 某作者的作品列表
// 卡片与批量操作与点赞/收藏列表同规格（保存按钮/复选框/批量保存/停止）
// 数据源：经 LOAD_AUTHOR_WORKS 消息由 Content Script 调用
//        platformAPI.getAuthorWorksForList() 实时拉取该作者全部作品
//        （与「按作者下载」同源，上限 FETCH_CONFIG.BATCH_MAX_COUNT）
// ==========================================

import { WorkListManager } from '../utils/work-list-manager.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('AuthorWorksView');

class AuthorWorksView {
    /**
     * @param {App} app - 侧边栏应用实例
     */
    constructor(app) {
        this.app = app;

        // ✅ 钻取视图专用列表管理器（分页/搜索/筛选全部复用其管线）
        this.manager = new WorkListManager({ type: 'authorWorks' });

        this.currentUid = null;
    }

    /**
     * 打开某作者的作品钻取视图：切换子视图并向 Content Script 发起拉取
     * @param {string} uid - 作者 uid（响应匹配键）
     * @param {string} nickname - 作者昵称（标题展示）
     * @param {string} platformId - 作者 sec_uid（API 拉取必需）
     */
    async open(uid, nickname, platformId = '') {
        this.currentUid = uid;

        // 1) 视图切换：隐藏作者列表/分页/批量栏，显示钻取块（flex 纵向布局，内部列表独享滚动）
        this._setAuthorAreaVisible(false);
        const view = document.getElementById('authorWorksView');
        if (view) view.style.display = 'flex';

        // 2) 标题栏
        const titleEl = document.getElementById('authorWorksTitle');
        if (titleEl) titleEl.textContent = `🎬 ${nickname || 'TA的作品'}`;
        const countEl = document.getElementById('authorWorksCount');
        if (countEl) countEl.textContent = '';

        this.manager.initElements();
        this.manager.setData([]); // 进入即重置上次的筛选/搜索状态
        // ✅ setData 只重置内部状态不重渲染，同步清空上一个作者残留的卡片 DOM
        // （不跑完整 updateUI，避免 updateStatus 的空数据文案覆盖下方的 loading 提示）
        if (this.manager.elements.list) {
            this.manager.elements.list.innerHTML = '';
        }
        this.manager.updatePaginationControls();
        // ✅ 清空上个会话残留的批量选择（切换作者时选择集不可跨作者复用）
        this.app.batchSelectionManager?.clearSelection('authorWorks');

        // 搜索框 DOM 残留值一并清空（manager 状态已重置，两者须一致）
        if (this.manager.elements.searchInput) {
            this.manager.elements.searchInput.value = '';
        }

        // 3) 缺少 sec_uid 无法调 API
        if (!platformId) {
            this._setStatus('error', '❌ 缺少作者标识（sec_uid），无法拉取 TA 的作品');
            logger.warn('⚠️ 钻取缺少 platformId:', uid);
            return;
        }

        // 4) 发起拉取（结果经 AUTHOR_WORKS_* 消息回流）
        this._setStatus('loading', '⏳ 正在获取 TA 的全部作品...');
        window.parent.postMessage({
            source: 'sidebar',
            type: 'LOAD_AUTHOR_WORKS',
            uid,
            platformId
        }, '*');

        logger.info(`🎬 钻取作者作品（API 拉取）: ${nickname || uid}`);
    }

    /**
     * 返回作者列表：隐藏钻取块、重置筛选条件与控件值、清空批量选择
     */
    close() {
        const lastUid = this.currentUid;
        this.currentUid = null;

        const view = document.getElementById('authorWorksView');
        if (view) view.style.display = 'none';

        // 重置 manager 查询状态 + DOM 控件值
        this.manager.search('');
        this.manager.setFilters({ saved: 'all', dateFrom: '', dateTo: '' });
        this._resetFilterControls();
        this.app.batchSelectionManager?.clearSelection('authorWorks');

        this._setAuthorAreaVisible(true);

        // 恢复作者列表渲染
        const followingManager = this.app.followingManager;
        followingManager.initElements();
        followingManager.updateUI();

        // ✅ 钻取内的保存不走按作者下载累加链路，返回时拉实时计数刷新该作者卡片
        if (lastUid) {
            this.app.authorDownloadManager?.requestAuthorStatuses([lastUid]);
        }

        logger.info('↩️ 已返回作者列表');
    }

    /**
     * 处理 AUTHOR_WORKS_PROGRESS：拉取进度提示
     */
    handleProgress(data = {}) {
        if (!this._isCurrent(data.uid)) return;
        this._setStatus('loading', `⏳ 正在获取 TA 的全部作品...（已获取 ${data.current || 0} 个）`);
    }

    /**
     * 处理 AUTHOR_WORKS_LOADED：渲染作品卡片（与点赞/收藏同款全功能卡片）
     */
    async handleLoaded(data = {}) {
        if (!this._isCurrent(data.uid)) return;

        // workId 去重兜底（API 分页边缘情况可能重复）
        const works = [];
        const seenWorkIds = new Set();
        for (const work of (data.works || [])) {
            const workId = work.workId;
            if (!workId || seenWorkIds.has(workId)) continue;
            seenWorkIds.add(workId);
            works.push(work);
        }

        const countEl = document.getElementById('authorWorksCount');
        if (countEl) countEl.textContent = `共 ${works.length} 个作品`;

        this.manager.setData(works);

        // 下载状态标注（支撑「已保存/未保存」筛选语义）
        await this.app.refreshListDownloadStatus(this.manager);
        this.manager.updateUI();

        logger.info(`🎬 钻取渲染完成: ${works.length} 个作品`);
    }

    /**
     * 处理 AUTHOR_WORKS_ERROR
     */
    handleError(data = {}) {
        if (!this._isCurrent(data.uid)) return;
        this._setStatus('error', `❌ 获取 TA 的作品失败：${data.error || '未知错误'}`);
        const countEl = document.getElementById('authorWorksCount');
        if (countEl) countEl.textContent = '';
    }

    /**
     * 响应是否属于当前钻取目标（用户快速切换作者/已返回时丢弃过期消息）
     */
    _isCurrent(uid) {
        return String(uid ?? '') === String(this.currentUid ?? '');
    }

    /**
     * 状态区提示（loading 蓝色 / error 红色）
     */
    _setStatus(kind, html) {
        this.manager.initElements();
        if (!this.manager.elements.status) return;
        const color = kind === 'error' ? '#ff4d4f' : '#1890ff';
        this.manager.elements.status.innerHTML = `<div style="color: ${color};">${html}</div>`;
    }

    /**
     * 作者列表区域显隐（列表/分页/批量栏）
     * @param {boolean} visible
     */
    _setAuthorAreaVisible(visible) {
        ['followingList', 'followingPagination', 'followingBatchActions'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.style.display = visible ? '' : 'none';
        });
    }

    /**
     * 清空钻取视图筛选栏控件值
     */
    _resetFilterControls() {
        const savedSelect = document.getElementById('authorWorksFilterSaved');
        const fromInput = document.getElementById('authorWorksFilterFrom');
        const toInput = document.getElementById('authorWorksFilterTo');
        if (savedSelect) savedSelect.value = 'all';
        if (fromInput) fromInput.value = '';
        if (toInput) toInput.value = '';
    }
}

export { AuthorWorksView };
