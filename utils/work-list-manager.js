// ==========================================
// 作品/作者列表管理器 - 通用分页、搜索、渲染功能
// 功能：管理点赞、收藏、关注等列表的分页、搜索、渲染
// ==========================================

import { createLogger } from './logger.js';

const logger = createLogger('WorkListManager');

/**
 * 通用列表管理器
 * 用于管理作品列表（点赞、收藏）和作者列表（关注）的分页、搜索、渲染等功能
 */
export class WorkListManager {
    /**
     * @param {Object} config - 配置对象
     * @param {string} config.type - 列表类型：'liked' | 'bookmarked' | 'following'
     * @param {Array} config.allWorks - 所有作品数据（作品列表使用）
     * @param {Array} config.allAuthors - 所有作者数据（作者列表使用）
     * @param {number} config.pageSize - 每页显示数量
     * @param {Function} config.onStateChange - 状态变化回调 (state) => void
     */
    constructor(config) {
        this.type = config.type;
        this.allWorks = config.allWorks || [];
        this.allAuthors = config.allAuthors || [];
        this.filteredData = null;
        this.currentPage = 1;
        this.pageSize = config.pageSize || 50;
        this.onStateChange = config.onStateChange;

        // ✅ 统一查询状态：关键词 + 高级筛选（saved / 时间范围）
        this.keyword = '';
        this.filters = { saved: 'all', dateFrom: '', dateTo: '', type: 'all', authorIds: [] };
        this.sort = { key: '', dir: 'desc' };

        // DOM 元素缓存
        this.elements = {};
    }

    /**
     * 初始化 DOM 元素
     */
    initElements() {
        const prefix = this.type;

        // ✅ 关注列表的搜索框 ID 是 searchInput，不是 followingSearchInput
        const searchInputId = this.type === 'following' ? 'searchInput' : `${prefix}SearchInput`;

        this.elements = {
            status: document.getElementById(`${prefix}Status`),
            list: document.getElementById(`${prefix}List`),
            searchInput: document.getElementById(searchInputId),
            pagination: document.getElementById(`${prefix}Pagination`),
            pageInfo: document.getElementById(`${prefix}PageInfo`),
            prevBtn: document.getElementById(`${prefix}PrevPage`),
            nextBtn: document.getElementById(`${prefix}NextPage`),
            firstBtn: document.getElementById(`${prefix}FirstPage`),
            lastBtn: document.getElementById(`${prefix}LastPage`),
            jumpInput: document.getElementById(`${prefix}JumpPage`)
        };
    }

    /**
     * 设置数据（兼容作品和作者）
     */
    setData(data) {
        if (this.type === 'following') {
            this.allAuthors = data || [];
            this.allWorks = [];
        } else {
            this.allWorks = data || [];
            this.allAuthors = [];
        }
        this.filteredData = null;
        this.keyword = '';
        this.filters = { saved: 'all', dateFrom: '', dateTo: '', type: 'all', authorIds: [] };
        this.sort = { key: '', dir: 'desc' };
        this.currentPage = 1;
        this.notifyStateChange();
    }

    /**
     * 获取当前页的数据
     */
    getCurrentPageData() {
        const allData = this.type === 'following' ? this.allAuthors : this.allWorks;
        const data = this.filteredData || allData;
        const start = (this.currentPage - 1) * this.pageSize;
        const end = start + this.pageSize;
        return data.slice(start, end);
    }

    /**
     * 计算总页数
     */
    getTotalPages() {
        const allData = this.type === 'following' ? this.allAuthors : this.allWorks;
        const total = this.filteredData ? this.filteredData.length : allData.length;
        return Math.ceil(total / this.pageSize) || 1;
    }

    /**
     * 跳转到指定页
     */
    goToPage(page) {
        const totalPages = this.getTotalPages();
        if (page < 1 || page > totalPages) return false;

        this.currentPage = page;
        this.notifyStateChange();
        return true;
    }

    /**
     * 上一页
     */
    prevPage() {
        return this.goToPage(this.currentPage - 1);
    }

    /**
     * 下一页
     */
    nextPage() {
        return this.goToPage(this.currentPage + 1);
    }

    /**
     * 搜索（只存关键词，统一走 _applyQuery 管线）
     */
    search(keyword) {
        this.keyword = keyword || '';
        this._applyQuery();
    }

    /**
     * ✅ 设置高级筛选条件（增量合并后统一走 _applyQuery 管线）
     * @param {Object} patch - 部分筛选条件 { saved?, dateFrom?, dateTo? }
     */
    setFilters(patch = {}) {
        this.filters = { ...this.filters, ...patch };
        this._applyQuery();
    }

    /**
     * ✅ 设置排序条件（增量合并后统一走 _applyQuery 管线）
     * @param {Object} patch - 部分排序条件 { key?, dir? }，key: ''(默认)|'time'|'status'，dir: 'asc'|'desc'
     */
    setSort(patch = {}) {
        this.sort = { ...this.sort, ...patch };
        this._applyQuery();
    }

    /**
     * ✅ 是否存在生效的排序
     */
    hasActiveSort() {
        return !!this.sort.key;
    }

    /**
     * ✅ 排序阶段（默认 key 为空时原样返回，保持 API 原始顺序）
     * 时间：sortTime||createTime；状态：主键 isDownloaded、次键时间（保证升降切换有确定且可见的顺序变化）
     * dir desc 为默认（大/新/已存在前）
     */
    _applySort(data) {
        const { key, dir } = this.sort;
        if (!key) return data;
        const arr = data.slice();
        const sign = dir === 'asc' ? 1 : -1;
        const timeOf = (w) => w.sortTime || w.createTime || 0;
        if (key === 'status') {
            arr.sort((a, b) => {
                const d = (a.isDownloaded ? 1 : 0) - (b.isDownloaded ? 1 : 0);
                if (d !== 0) return sign * d;
                // ✅ 保存状态相同时用时间作次级键，避免全为同一状态时升降切换无可见变化
                return sign * (timeOf(a) - timeOf(b));
            });
        } else {
            arr.sort((a, b) => sign * (timeOf(a) - timeOf(b)));
        }
        return arr;
    }

    /**
     * ✅ 提取当前列表的作者选项（按作品 author 分组，供作者多选筛选下拉填充）
     * @returns {Array<{id:string,name:string,count:number}>} 按作品数降序、同数按昵称
     */
    getAuthorOptions() {
        const allData = this.type === 'following' ? this.allAuthors : this.allWorks;
        const map = new Map();
        for (const work of allData) {
            const a = (work && work.author) || {};
            const id = a.uid || a.platformId || a.nickname;
            if (!id) continue;
            const cur = map.get(id);
            if (cur) cur.count += 1;
            else map.set(id, { id, name: a.nickname || String(id), count: 1 });
        }
        return Array.from(map.values())
            .sort((x, y) => y.count - x.count || String(x.name).localeCompare(String(y.name)));
    }

    /**
     * ✅ 是否存在生效的查询条件（关键词或任一筛选条件）
     */
    hasActiveQuery() {
        const { saved, dateFrom, dateTo, type, authorIds } = this.filters;
        return !!this.keyword.trim() || saved !== 'all' || !!dateFrom || !!dateTo
            || type !== 'all' || (Array.isArray(authorIds) && authorIds.length > 0);
    }

    /**
     * ✅ 统一查询管线：基础集 → 关键词 → saved → 时间范围
     * 语义对齐离线浏览页 ui/local/features.js 的 applyFilterSortSearch；
     * 全空条件时 filteredData = null（表示无过滤）
     */
    _applyQuery() {
        const allData = this.type === 'following' ? this.allAuthors : this.allWorks;

        // 无任何筛选且无排序 → filteredData=null，走原始 allData 顺序
        if (!this.hasActiveQuery() && !this.hasActiveSort()) {
            this.filteredData = null;
            this.currentPage = 1;
            this.notifyStateChange();
            return;
        }

        let result = allData;
        const keyword = this.keyword.trim().toLowerCase();

        // 1. 关键词过滤（作品：描述/作者昵称；作者：昵称/抖音号）
        if (keyword) {
            if (this.type === 'following') {
                result = result.filter(author => {
                    const nickname = (author.nickname || '').toLowerCase();
                    const uniqueId = (author.uniqueId || '').toLowerCase();
                    return nickname.includes(keyword) || uniqueId.includes(keyword);
                });
            } else {
                result = result.filter(work => {
                    const desc = (work.desc || '').toLowerCase();
                    const author = (work.author?.nickname || '').toLowerCase();
                    return desc.includes(keyword) || author.includes(keyword);
                });
            }
        }

        // 2. 保存状态过滤（作品列表）
        const { saved, dateFrom, dateTo, type, authorIds } = this.filters;
        if (saved === 'downloaded') {
            result = result.filter(work => work.isDownloaded === true);
        } else if (saved === 'notDownloaded') {
            result = result.filter(work => !work.isDownloaded);
        }

        // ✅ 3. 作品类型过滤（仅作品列表：视频/图集，基于 isImagePost）
        if (this.type !== 'following' && type && type !== 'all') {
            result = result.filter(work => type === 'image' ? !!work.isImagePost : !work.isImagePost);
        }

        // ✅ 4. 作者多选过滤（仅作品列表，命中任一选中作者；id 两侧统一按 String 比较）
        if (this.type !== 'following' && Array.isArray(authorIds) && authorIds.length > 0) {
            const idSet = new Set(authorIds.map(String));
            result = result.filter(work => {
                const a = work.author || {};
                const id = a.uid || a.platformId || a.nickname;
                return id !== undefined && id !== null && idSet.has(String(id));
            });
        }

        // 5. 时间范围过滤（createTime 为毫秒；dateFrom/dateTo 为 yyyy-MM-dd）
        const fromMs = dateFrom ? new Date(`${dateFrom}T00:00:00`).getTime() : null;
        const toMs = dateTo ? new Date(`${dateTo}T23:59:59`).getTime() : null;
        if (fromMs !== null || toMs !== null) {
            result = result.filter(work => {
                const t = work.sortTime || work.createTime || 0;
                if (fromMs !== null && t < fromMs) return false;
                if (toMs !== null && t > toMs) return false;
                return true;
            });
        }

        // ✅ 6. 排序（无排序键时原样返回，保持上一步过滤后的顺序）
        result = this._applySort(result);

        this.filteredData = result;
        this.currentPage = 1;
        this.notifyStateChange();
    }

    /**
     * 获取搜索结果的占位符文本
     */
    getSearchPlaceholder() {
        const allData = this.type === 'following' ? this.allAuthors : this.allWorks;
        // ✅ 有筛选条件时计数基数用筛选后集合
        const count = this.filteredData ? this.filteredData.length : allData.length;
        const keyword = this.keyword || this.elements.searchInput?.value?.trim();

        if (keyword) {
            return `搜索结果: ${count} 个`;
        }

        if (this.type === 'following') {
            return `搜索 ${count} 个作者...`;
        }
        return `搜索 ${count} 个作品...`;
    }

    /**
     * 更新 UI 显示
     * @param {Set} selectedIds - 选中的ID集合（可选，用于分页时保持 checkbox 状态）
     */
    updateUI(selectedIds = null) {
        this.updateStatus();
        this.updateSearchInput();
        this.renderList(selectedIds);
        this.updatePaginationControls();
    }

    /**
     * 更新状态显示
     */
    updateStatus() {
        if (!this.elements.status) return;

        const allData = this.type === 'following' ? this.allAuthors : this.allWorks;
        const total = allData.length;
        const totalPages = this.getTotalPages();

        const typeName = this.getTypeName();

        // ✅ 空状态特殊处理
        if (total === 0) {
            this.elements.status.innerHTML = `
                <div style="color: #999;">
                    📭 暂无${typeName}数据
                </div>
            `;
        } else {
            this.elements.status.innerHTML = `
                <div style="color: #52c41a;">
                    ✅ 共 ${total} 个${typeName}，共 ${totalPages} 页
                </div>
            `;
        }
    }

    /**
     * 更新搜索框
     */
    updateSearchInput() {
        if (!this.elements.searchInput) return;

        this.elements.searchInput.disabled = false;
        this.elements.searchInput.placeholder = this.getSearchPlaceholder();

        // ✅ 高级筛选栏与搜索框同步启用（有数据才可用）
        this._updateFilterBarState();
    }

    /**
     * ✅ 同步高级筛选栏启用状态（控件按 {type}FilterXxx 命名，authorWorks 钻取视图同样适用）
     */
    _updateFilterBarState() {
        const controls = ['FilterSaved', 'FilterType', 'FilterFrom', 'FilterTo', 'FilterSort', 'FilterReset']
            .map(suffix => document.getElementById(`${this.type}${suffix}`));
        if (!controls[0]) return; // 该列表无筛选栏（如 following）

        const allData = this.type === 'following' ? this.allAuthors : this.allWorks;
        const enabled = allData.length > 0;
        controls.forEach(el => {
            if (!el) return;
            // ✅ 自定义排序下拉为 div（无原生 disabled），用 class 切换（配合 pointer-events 阻止交互）
            if (el.classList && el.classList.contains('sort-dropdown')) {
                el.classList.toggle('is-disabled', !enabled);
            } else {
                el.disabled = !enabled;
            }
        });
    }

    /**
     * 渲染列表
     * @param {Set} selectedIds - 选中的ID集合（可选，用于分页时保持 checkbox 状态）
     */
    renderList(selectedIds = null) {
        if (!this.elements.list) return;

        const data = this.getCurrentPageData();

        // ✅ 动态导入渲染函数（按需加载）
        if (this.type === 'following') {
            import('./author-card-renderer.js').then(({ renderAuthorList }) => {
                // ✅ 渲染作者列表，传递选中状态
                renderAuthorList(this.elements.list, data, selectedIds);
            });
        } else {
            // ✅ 作品列表（点赞/收藏/作者钻取）：统一全功能卡片（checkbox + 保存按钮）
            import('./work-card-renderer.js').then(({ renderWorkList }) => {
                // 渲染作品列表，传递选中状态
                renderWorkList(this.elements.list, data, selectedIds);
            });
        }
    }

    /**
     * 更新分页控件
     */
    updatePaginationControls() {
        const { pagination, pageInfo, prevBtn, nextBtn, firstBtn, lastBtn, jumpInput } = this.elements;
        if (!pagination || !pageInfo || !prevBtn || !nextBtn) return;

        const totalPages = this.getTotalPages();
        const allData = this.type === 'following' ? this.allAuthors : this.allWorks;
        const totalItems = this.filteredData ? this.filteredData.length : allData.length;

        // ✅ 使用 visibility 而不是 display，保持布局稳定
        if (totalItems > 0) {
            pagination.style.visibility = 'visible';
            pagination.style.height = 'auto';
            pagination.style.overflow = 'visible';
        } else {
            pagination.style.visibility = 'hidden';
            pagination.style.height = '0px';
            pagination.style.overflow = 'hidden';
        }

        // ✅ 窄侧边栏单行布局：只保留精简页码（“共 N 条”已由上方状态行展示，此处重复会撑爆一行导致换行）
        pageInfo.textContent = `第 ${this.currentPage}/${totalPages} 页`;

        // ✅ 首页/上一页/下一页/末页 禁用态统一同步（含内联 opacity/cursor，避免下载禁用后残留 not-allowed）
        const atFirst = this.currentPage <= 1;
        const atLast = this.currentPage >= totalPages;
        const sync = (btn, disabled) => {
            if (!btn) return;
            btn.disabled = disabled;
            btn.style.opacity = disabled ? '0.5' : '1';
            btn.style.cursor = disabled ? 'not-allowed' : 'pointer';
        };
        sync(firstBtn, atFirst);
        sync(prevBtn, atFirst);
        sync(nextBtn, atLast);
        sync(lastBtn, atLast);

        if (jumpInput) jumpInput.max = totalPages;
    }

    /**
     * 显示加载进度（仅显示已加载数量，不显示 xx/yy 格式）
     * @param {string} [label] - 可选文案覆盖（如带收藏夹名的「XX」收藏作品）
     */
    showProgress(currentCount, totalCount, label) {
        if (!this.elements.status) return;

        // ✅ 符合设计原则：只显示已加载数量，不显示 xx/yy 格式
        this.elements.status.innerHTML = `
            <div style="color: #1890ff;">
                ⏳ 正在加载${label || this.getTypeName()}... (已加载 ${currentCount} 个)
            </div>
        `;
    }

    /**
     * 显示错误
     */
    showError(error) {
        if (!this.elements.status) return;
        if (!this.elements.list) return;

        this.elements.status.innerHTML = `
            <div style="color: #ff4d4f;">
                ❌ 加载失败
            </div>
        `;

        this.elements.list.innerHTML = `
            <div class="error-message">
                ${this.escapeHtml(error || '未知错误')}
            </div>
        `;
    }

    /**
     * 获取类型名称
     */
    getTypeName() {
        const typeNames = {
            'liked': '点赞作品',
            'bookmarked': '收藏作品',
            'following': '关注作者',
            'authorWorks': 'TA的作品'
        };
        return typeNames[this.type] || '';
    }

    /**
     * HTML 转义
     */
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    /**
     * 通知状态变化
     */
    notifyStateChange() {
        if (this.onStateChange) {
            this.onStateChange({
                type: this.type,
                currentPage: this.currentPage,
                totalPages: this.getTotalPages(),
                totalCount: this.type === 'following' ? this.allAuthors.length : this.allWorks.length,
                filteredCount: this.filteredData ? this.filteredData.length : null
            });
        }
    }

    /**
     * 清空数据
     */
    clear() {
        this.allWorks = [];
        this.allAuthors = [];
        this.filteredData = null;
        this.keyword = '';
        this.filters = { saved: 'all', dateFrom: '', dateTo: '', type: 'all', authorIds: [] };
        this.sort = { key: '', dir: 'desc' };
        this.currentPage = 1;
        this.notifyStateChange();
    }
}
