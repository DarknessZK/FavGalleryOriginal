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

    /**
     * 生效的排序层级：state.sortOrder（已启用维度，按勾选顺序）配 state.sortDirs（各维度升/降）
     * @returns {Array} 主键在前的层级数组；空数组 = 不排序
     */
    function sortLevels(state) {
        const order = Array.isArray(state.sortOrder) ? state.sortOrder : [];
        return order.map(function (k) {
            return { key: k, dir: state.sortDirs && state.sortDirs[k] === 'asc' ? 'asc' : 'desc' };
        });
    }

    /**
     * 作品排序比较：按已启用维度的顺序逐级比较（先选中的为主键，后选中的作次级键）
     * 时间：sortTime || createTime；保存状态：isDownloaded
     * 无启用维度 → 不排序（稳定 sort 保留生成顺序）
     * 末级为保存状态时补一个同向时间次级键：全为同一状态时升/降切换仍有可见且确定的顺序
     */
    function compareWorks(a, b, state) {
        const levels = sortLevels(state);
        const timeOf = function (w) { return w.sortTime || w.createTime || 0; };
        for (let i = 0; i < levels.length; i++) {
            const lv = levels[i];
            const sign = lv.dir === 'asc' ? 1 : -1;
            const d = lv.key === 'status'
                ? (a.isDownloaded ? 1 : 0) - (b.isDownloaded ? 1 : 0)
                : timeOf(a) - timeOf(b);
            if (d !== 0) return sign * d;
            // ✅ 保存状态为该维的最后一个层级（后面没有显式层级可继续区分）时才用时间兜底
            if (lv.key === 'status' && i === levels.length - 1) {
                const dt = timeOf(a) - timeOf(b);
                if (dt !== 0) return sign * dt;
            }
        }
        return 0;
    }

    /**
     * 视频时长档位（毫秒，与扩展侧 config/constants.js DURATION_BUCKETS 保持一致）
     * 经典脚本无 import，此处内联副本；max 为包含上界，升序首个 max>=d 即命中（左开右闭）
     */
    const DURATION_BUCKETS = [
        { key: 'le15', max: 15000 },
        { key: 's15to60', max: 60000 },
        { key: 'm1to3', max: 180000 },
        { key: 'm3to10', max: 600000 },
        { key: 'm10to30', max: 1800000 },
        { key: 'm30to60', max: 3600000 },
        { key: 'gt60', max: Infinity }
    ];
    /** 时长落档：ms 缺省/非法归 0 → ≤15秒档 */
    function durationBucket(ms) {
        const d = (ms && ms > 0) ? ms : 0;
        for (let i = 0; i < DURATION_BUCKETS.length; i++) {
            if (d <= DURATION_BUCKETS[i].max) return DURATION_BUCKETS[i].key;
        }
        return 'gt60';
    }

    /**
     * 对作品数组应用 筛选 + 搜索 + 排序（返回新数组，不修改原数组）
     * @param {Array} works
     * @param {Object} state - { filter, workType, durations, keyword, sortOrder, sortDirs, dateFrom, dateTo }
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

        // 筛选：作品类型（视频/图集，基于 isImagePost/mediaType，与卡片渲染口径一致）
        if (state.workType === 'image') {
            arr = arr.filter(function (w) { return !!w.isImagePost || w.mediaType === 'image_post'; });
        } else if (state.workType === 'video') {
            arr = arr.filter(function (w) { return !w.isImagePost && w.mediaType !== 'image_post'; });
        }

        // 筛选：时长（多选档位，OR—命中任一所选档即显示；UI 仅“视频”模式启用并会随类型清空）
        if (Array.isArray(state.durations) && state.durations.length) {
            arr = arr.filter(function (w) {
                return state.durations.indexOf(durationBucket(w.duration)) !== -1;
            });
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

        // 筛选：话题标签（点卡片 chip 选中的话题；OR 命中——作品含任一所选话题即显示）
        if (state.topics && state.topics.length) {
            arr = arr.filter(function (w) {
                const ts = Array.isArray(w.topics) ? w.topics : [];
                return state.topics.some(function (t) { return ts.indexOf(t) !== -1; });
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

        // 保存状态维度（排序栈中的首个 status 层级）：按下载完成度聚合
        let statusLv = null;
        sortLevels(state).forEach(function (lv) {
            if (lv.key === 'status' && !statusLv) statusLv = lv;
        });
        if (statusLv) {
            const rank = { completed: 0, partial: 1, pending: 2 };
            arr.sort(function (a, b) {
                const ra = rank[a.downloadStatus] !== undefined ? rank[a.downloadStatus] : 3;
                const rb = rank[b.downloadStatus] !== undefined ? rank[b.downloadStatus] : 3;
                return statusLv.dir === 'asc' ? rb - ra : ra - rb;
            });
        }
        // 时间层级对作者一级列表无意义，保持生成时的关注顺序
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
