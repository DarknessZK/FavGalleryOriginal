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
        // renderStatus:false → 不渲染内置“共 N 个TA的作品，共 M 页”状态行（已由顶部计数 + 截断标注替代）
        this.manager = new WorkListManager({ type: 'authorWorks', renderStatus: false });

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

        // 1) 视图切换：隐藏外层作者维度元素（刷新按钮/计数提示/搜索栏/列表/分页/批量栏），显示钻取块
        this._setAuthorAreaVisible(false);
        // ✅ 钻取期间锁定 Tab 切换（下方作品列表属于关注 Tab 内部子视图，切走会丢失钻取上下文）
        this.app.tabManager?.lock();
        const view = document.getElementById('authorWorksView');
        if (view) view.style.display = 'flex';

        // 2) 标题栏
        const titleEl = document.getElementById('authorWorksTitle');
        if (titleEl) titleEl.textContent = `🎬 ${nickname || 'TA的作品'}`;
        const countEl = document.getElementById('authorWorksCount');
        if (countEl) countEl.textContent = '';
        this._setTruncNote(''); // ✅ 清空上一个作者残留的截断标注
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
        // ✅ 退出钻取：解除 Tab 切换锁定
        this.app.tabManager?.unlock();

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
        // ✅ 截断标注：单独成行展示（不塞进顶部 nowrap 计数 span，否则窄侧边栏会裁切看不到），
        //    并给出可执行的解法（调高「作者作品」上限 + 刷新关注列表作废会话缓存后重进）
        this._setTruncNote(data.truncated
            ? `⚠️ 仅显示最新 ${works.length} 个（已达上限，TA 可能还有更多）；在 ⚙️ 配置 调高「作者作品」上限并刷新关注列表后重新查看可加载全部`
            : '');

        this.manager.setData(works);

        // 下载状态标注（支撑「已保存/未保存」筛选语义）
        await this.app.refreshListDownloadStatus(this.manager);
        this.manager.updateUI();

        // ✅ 本视图已禁用 manager 状态行渲染（renderStatus:false），此处清空 open() 期间残留的 loading 文案
        if (this.manager.elements.status) this.manager.elements.status.innerHTML = '';

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
        this._setTruncNote('');
    }

    /**
     * 响应是否属于当前钻取目标（用户快速切换作者/已返回时丢弃过期消息）
     */
    _isCurrent(uid) {
        return String(uid ?? '') === String(this.currentUid ?? '');
    }

    /**
     * 截断标注独占行（authorWorksTruncNote）：有文案则显示，空则隐藏
     * @param {string} text - 提示文案（空字符串清除并隐藏）
     */
    _setTruncNote(text) {
        const el = document.getElementById('authorWorksTruncNote');
        if (!el) return;
        if (text) {
            el.textContent = text;
            el.style.display = '';
        } else {
            el.textContent = '';
            el.style.display = 'none';
        }
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
     * 外层作者维度区域显隐（刷新按钮 / 计数提示 / 搜索栏 / 列表 / 分页 / 批量栏）
     * 钻取时整体隐藏（这些都是作者层元素，与作品子视图无关），返回时恢复
     * @param {boolean} visible
     */
    _setAuthorAreaVisible(visible) {
        const show = visible ? '' : 'none';
        ['loadFollowing', 'followingStatus', 'followingList', 'followingPagination', 'followingBatchActions'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.style.display = show;
        });
        // ✅ 关注搜索框：隐藏其整块容器（避免残留空占位）
        const searchWrap = document.getElementById('searchInput')?.parentElement;
        if (searchWrap) searchWrap.style.display = show;
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
