// ==========================================
// 我的收藏页面 - 增强功能模块
// 负责：搜索、筛选、排序、封面悬浮预览
// 说明：经典脚本（file:// 不支持 ES module），挂载到 window.LocalFeatures
// ==========================================

(function () {
    'use strict';

    const core = window.LocalCore;

    /** 防抖 */
    function debounce(fn, ms) {
        let timer = null;
        return function () {
            const args = arguments;
            const ctx = this;
            clearTimeout(timer);
            timer = setTimeout(function () { fn.apply(ctx, args); }, ms || 200);
        };
    }

    /** 作品排序比较（时间 / 保存状态） */
    function compareWorks(a, b, state) {
        if (state.sortKey === 'status') {
            const av = a.isDownloaded ? 1 : 0;
            const bv = b.isDownloaded ? 1 : 0;
            return state.sortDir === 'asc' ? av - bv : bv - av;
        }
        // 默认按时间：点赞/收藏时间优先，其次发布时间
        const at = a.sortTime || a.createTime || 0;
        const bt = b.sortTime || b.createTime || 0;
        return state.sortDir === 'asc' ? at - bt : bt - at;
    }

    /**
     * 对作品数组应用 筛选 + 搜索 + 排序（返回新数组，不修改原数组）
     * @param {Array} works
     * @param {Object} state - { filter, keyword, sortKey, sortDir }
     */
    function applyFilterSortSearch(works, state) {
        if (!Array.isArray(works)) return [];
        let arr = works.slice();

        // 筛选：保存状态
        if (state.filter === 'downloaded') {
            arr = arr.filter(function (w) { return !!w.isDownloaded; });
        } else if (state.filter === 'notDownloaded') {
            arr = arr.filter(function (w) { return !w.isDownloaded; });
        }

        // 筛选：日期范围（按排序时间 sortTime || createTime；仅作品列表调用本函数）
        if (state.dateFrom || state.dateTo) {
            const from = state.dateFrom ? new Date(state.dateFrom + 'T00:00:00').getTime() : null;
            const to = state.dateTo ? new Date(state.dateTo + 'T23:59:59').getTime() : null;
            arr = arr.filter(function (w) {
                const t = w.sortTime || w.createTime || 0;
                if (from !== null && t < from) return false;
                if (to !== null && t > to) return false;
                return true;
            });
        }

        // 搜索：多关键词小卡片（已固化 keywords + 正在输入 keyword），分片内固定 OR——命中任意词即显示
        // （全局搜索为跨分片精确检索，固定 AND，见 index.js runGlobalSearch）
        const kws = [].concat(state.keywords || [], state.keyword ? [state.keyword] : [])
            .map(function (k) { return String(k).toLowerCase(); })
            .filter(Boolean);
        if (kws.length) {
            arr = arr.filter(function (w) {
                const desc = (w.desc || '').toLowerCase();
                const nick = (w.authorNickname || '').toLowerCase();
                return kws.some(function (k) { return desc.indexOf(k) !== -1 || nick.indexOf(k) !== -1; });
            });
        }

        // 排序
        arr.sort(function (a, b) { return compareWorks(a, b, state); });
        return arr;
    }

    /**
     * 作者列表：搜索过滤（+ 保存状态排序时按下载状态聚合）
     * @param {Array} authors
     * @param {Object} state
     */
    function filterAuthors(authors, state) {
        if (!Array.isArray(authors)) return [];
        let arr = authors.slice();

        // 作者名多关键词过滤（分片内固定 OR，命中任意词）
        const kws = [].concat(state.keywords || [], state.keyword ? [state.keyword] : [])
            .map(function (k) { return String(k).toLowerCase(); })
            .filter(Boolean);
        if (kws.length) {
            arr = arr.filter(function (a) {
                const n = (a.nickname || '').toLowerCase();
                return kws.some(function (k) { return n.indexOf(k) !== -1; });
            });
        }

        if (state.sortKey === 'status') {
            const rank = { completed: 0, partial: 1, pending: 2 };
            arr.sort(function (a, b) {
                const ra = rank[a.downloadStatus] !== undefined ? rank[a.downloadStatus] : 3;
                const rb = rank[b.downloadStatus] !== undefined ? rank[b.downloadStatus] : 3;
                return state.sortDir === 'asc' ? rb - ra : ra - rb;
            });
        }
        // 时间排序对作者无意义，保持生成时的关注顺序
        return arr;
    }

    /**
     * 绑定封面悬浮预览：卡片封面为 160px 裁剪小图，悬浮显示完整大图
     * 事件委托，适用于所有懒加载出来的卡片
     */
    function bindHoverPreview() {
        if (!core) return;
        let activeSrc = '';

        document.addEventListener('mouseover', function (e) {
            // 放大预览打开时不触发悬浮
            const overlay = document.getElementById('coverPreviewOverlay');
            if (overlay && overlay.classList.contains('active')) return;

            const cover = e.target.closest && e.target.closest('.video-cover');
            if (cover && cover.tagName === 'IMG' && cover.src) {
                activeSrc = cover.src;
                core.showHoverPreview(activeSrc, e.clientX, e.clientY);
            }
        });

        document.addEventListener('mousemove', function (e) {
            if (!activeSrc) return;
            const overlay = document.getElementById('coverPreviewOverlay');
            if (overlay && overlay.classList.contains('active')) { core.hideHoverPreview(); return; }
            core.showHoverPreview(activeSrc, e.clientX, e.clientY);
        });

        document.addEventListener('mouseout', function (e) {
            const cover = e.target.closest && e.target.closest('.video-cover');
            if (cover) {
                activeSrc = '';
                core.hideHoverPreview();
            }
        });

        // 滚动时隐藏，避免残留（列表现于 .tab-content 内滚动；scroll 不冒泡，用捕获阶段监听任意滚动容器）
        document.addEventListener('scroll', function () {
            if (activeSrc) { activeSrc = ''; core.hideHoverPreview(); }
        }, { passive: true, capture: true });
    }

    window.LocalFeatures = {
        debounce: debounce,
        applyFilterSortSearch: applyFilterSortSearch,
        filterAuthors: filterAuthors,
        bindHoverPreview: bindHoverPreview,
        compareWorks: compareWorks
    };
})();
