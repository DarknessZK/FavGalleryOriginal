// ==========================================
// 我的收藏页面 - 主入口
// 负责：初始化、平台/列表切换、分页渲染、协调 core/features
// 说明：经典脚本（file:// 不支持 ES module），挂载到 window.LocalIndex
// ==========================================

(function () {
    'use strict';

    const core = window.LocalCore;
    const features = window.LocalFeatures;

    // 跨平台清单入口（对应扩展侧 CONFIG.FILE_SYSTEM.OFFLINE_INDEX_FILE，相对根目录）
    const OFFLINE_INDEX_PATH = '.FavGallery/metadata/offline-index.js';
    const VAR_INDEX = 'offline_index';
    const VAR_MANIFEST = 'offline_manifest';
    const VAR_AUTHORS_INDEX = 'authors_index';
    const VAR_AUTHOR_WORKS = 'author_works';
    const VAR_LIKED = 'liked_works';
    const VAR_BOOKMARKED = 'bookmarked_works';
    const VAR_SEARCH_INDEX = 'search_index';

    // 每页默认条目数（可在工具栏自定义）
    const DEFAULT_PAGE_SIZE = 60;

    // 全局搜索单次命中上限（索引按 createTime 倒序，最新作品优先）
    const MAX_GLOBAL_HITS = 300;

    const state = {
        platforms: [],
        currentPlatform: null,   // { platform, name, dataPath, counts }
        manifest: null,
        currentTab: 'liked',
        liked: { works: [], loaded: false, loading: false },
        authors: { list: [], loaded: false, subUid: null, subWorks: [] },
        collects: { subId: null, subWorks: [] },
        global: { index: null, active: false, works: [] },  // 全局搜索：索引缓存 / 结果态
        filter: 'all',
        // ✅ 多维排序：sortOrder = 已启用维度（按勾选顺序定主次，先选为主键）；
        //    sortDirs = 各维度的升/降设定（未启用也保留，点选项文本可随时预览切换）
        //    空 sortOrder = 不排序（保留离线数据的生成顺序）
        sortOrder: ['time'],
        sortDirs: { time: 'desc', status: 'desc' },
        keyword: '',
        keywords: [],            // 已固化的多关键词小卡片（与正在输入的 keyword 叠加过滤；分片内 OR，全局搜索 AND）
        dateFrom: '',            // 时间筛选起始（YYYY-MM-DD，空=不限）
        dateTo: '',              // 时间筛选结束（YYYY-MM-DD，空=不限）
        pageSize: DEFAULT_PAGE_SIZE,
        currentPage: 1
    };

    // ---------- DOM 工具 ----------

    function $(id) { return document.getElementById(id); }

    function loadScript(src) {
        return new Promise(function (resolve, reject) {
            const s = document.createElement('script');
            s.src = src;
            s.charset = 'utf-8';
            s.onload = function () { resolve(); };
            s.onerror = function () { reject(new Error('脚本加载失败: ' + src)); };
            document.body.appendChild(s);
        });
    }

    function dataPath() {
        return state.currentPlatform ? state.currentPlatform.dataPath : '';
    }

    // ---------- 视图状态切换 ----------

    function hideLoading() { const el = $('loading'); if (el) el.style.display = 'none'; }
    function showContent() { const el = $('content'); if (el) el.style.display = 'flex'; }

    function showError(html) {
        hideLoading();
        const box = $('errorContainer');
        if (!box) return;
        box.style.display = 'block';
        box.innerHTML = `<div class="error-message">${html}</div>`;
    }

    /** 数据未生成引导（文档 8.5）：优先复用 HTML 内联的友好文案，保证与看门狗一致 */
    function showNoDataGuide() {
        hideLoading();
        const box = $('errorContainer');
        if (!box) return;
        box.style.display = 'block';
        box.innerHTML = (typeof window.__favGalleryGuideHtml === 'function')
            ? window.__favGalleryGuideHtml()
            : '<div class="error-message">未找到离线数据。请先在 FavGallery 扩展中<b>选择本地文件夹</b>，扩展会自动生成离线数据后，再刷新本页。</div>';
    }

    /** 索引行 src 定位器 → 分片文件路径 + 全局变量名 */
    function shardRef(src) {
        const i = src.indexOf(':');
        const kind = src.slice(0, i);
        const rest = src.slice(i + 1);
        if (kind === 'l') return { path: `${dataPath()}/liked/${rest}.js`, variable: VAR_LIKED };
        if (kind === 'b') return { path: `${dataPath()}/bookmarked/${rest}.js`, variable: VAR_BOOKMARKED };
        return { path: `${dataPath()}/authors/${rest}.js`, variable: VAR_AUTHOR_WORKS };
    }

    /** 加载单分片并取其作品数组（takeGlobal 即时取走，不污染视图缓存） */
    async function loadShardWorks(src) {
        const ref = shardRef(src);
        await loadScript(ref.path);
        const data = core.takeGlobal(ref.variable);
        return (data && Array.isArray(data.works)) ? data.works : [];
    }

    /** src 定位器 → 来源中文描述（全局搜索结果卡的「来自」标注） */
    function srcLabel(src, authorNickname) {
        const i = src.indexOf(':');
        const kind = src.slice(0, i);
        const rest = src.slice(i + 1);
        if (kind === 'l') return '点赞 · ' + rest.replace('_', '年') + '月';
        if (kind === 'b') {
            const c = ((state.manifest && state.manifest.collects) || [])
                .find(function (x) { return String(x.collectId) === rest; });
            return '收藏「' + ((c && c.collectName) || '未命名收藏夹') + '」';
        }
        return '作者 · ' + (authorNickname || '未知');
    }

    // ---------- 多关键词小卡片（chip） ----------

    /** 当前生效的搜索词列表（小卡片 + 正在输入，均小写） */
    function activeKeywords() {
        const arr = state.keywords.slice();
        if (state.keyword) arr.push(state.keyword);
        return arr.map(function (k) { return k.toLowerCase(); }).filter(Boolean);
    }

    /** 展示用文本：所有生效搜索词拼接 */
    function kwText() { return activeKeywords().join(' '); }

    /** 渲染关键词小卡片 */
    function renderSearchChips() {
        const box = $('searchChips');
        if (!box) return;
        box.innerHTML = state.keywords.map(function (k) {
            return '<span class="search-chip" data-kw="' + core.escapeHtml(k) + '">' +
                '<span class="chip-text">' + core.escapeHtml(k) + '</span>' +
                '<i class="chip-close" title="移除该关键词">×</i></span>';
        }).join('');
    }

    /** 把当前输入（按逗号切分、去重）固化为关键词小卡片 */
    function commitKeywords() {
        const s = $('searchInput');
        if (!s) return;
        const parts = s.value.split(/[,，]/).map(function (x) { return x.trim(); }).filter(Boolean);
        if (!parts.length) return;
        parts.forEach(function (p) {
            if (state.keywords.indexOf(p) === -1) state.keywords.push(p);
        });
        s.value = '';
        state.keyword = '';
        renderSearchChips();
        rerenderCurrent();
    }

    /** 退出全局搜索模式（clearKeyword=true 时同时清空搜索词与小卡片） */
    function exitGlobalSearch(clearKeyword) {
        state.global.active = false;
        state.global.works = [];
        hideSubView();
        if (clearKeyword) {
            state.keyword = '';
            state.keywords = [];
            renderSearchChips();
            const s = $('searchInput');
            if (s) s.value = '';
        }
    }

    /**
     * 执行全局搜索：懒加载索引 → 匹配 desc/昵称 → 按 src 分组加载命中分片 → 汇总完整记录
     */
    async function runGlobalSearch(btn) {
        const kws = activeKeywords();
        if (!kws.length) return;
        if (btn) { btn.disabled = true; btn.textContent = '正在加载搜索索引…'; }
        try {
            if (!state.global.index) {
                await loadScript(`${dataPath()}/search-index.js`);
                state.global.index = core.takeGlobal(VAR_SEARCH_INDEX) || { entries: [] };
            }
            const entries = state.global.index.entries || [];
            const matched = [];
            for (const e of entries) {
                const desc = (e.desc || '').toLowerCase();
                const nick = (e.authorNickname || '').toLowerCase();
                // 全局搜索固定 AND：需命中全部关键词（跨库精确检索，避免 OR 命中爆炸撞 300 上限）
                const testFn = function (k) { return desc.indexOf(k) !== -1 || nick.indexOf(k) !== -1; };
                if (kws.every(testFn)) {
                    matched.push(e);
                    if (matched.length >= MAX_GLOBAL_HITS) break;
                }
            }
            if (btn) btn.textContent = `命中 ${matched.length} 条，正在加载分片…`;
            const idsBySrc = new Map();
            matched.forEach(function (m) {
                if (!idsBySrc.has(m.src)) {
                    idsBySrc.set(m.src, { ids: [], label: srcLabel(m.src, m.authorNickname) });
                }
                idsBySrc.get(m.src).ids.push(m.workId);
            });
            const found = [];
            for (const pair of idsBySrc) {
                let recs = [];
                try { recs = await loadShardWorks(pair[0]); } catch (err) { /* 分片缺失：跳过 */ }
                const want = new Set(pair[1].ids);
                recs.forEach(function (r) {
                    if (want.has(r.workId)) found.push(Object.assign({ sourceLabel: pair[1].label }, r));
                });
            }
            found.sort(function (a, b) {
                return (b.sortTime || b.createTime || 0) - (a.sortTime || a.createTime || 0);
            });
            state.global.works = found;
            state.global.active = true;
            state.currentPage = 1;
            // 结果视图：复用二级视图栏明示“全局搜索”，避免误以为结果属于当前 Tab
            showSubView('🌐 全局搜索', `「${kwText().trim()}」 · ${found.length} 条结果（需命中全部关键词，跨点赞/收藏/作者）`);
            renderCurrentList();
        } catch (err) {
            console.warn('[index] 全局搜索失败:', err.message);
            if (btn) {
                btn.disabled = false;
                btn.textContent = '全局搜索失败（索引缺失？请在扩展中重新选择文件夹生成）';
            }
        }
    }

    /** 空态渲染：作品视图且范围内无命中时，提供全局搜索入口 */
    const _emptyOriginal = {};
    function updateEmptyState(tab, total) {
        const el = $('empty-' + tab);
        if (!el) return;
        if (_emptyOriginal[tab] === undefined) _emptyOriginal[tab] = el.innerHTML;
        if (total > 0) {
            el.innerHTML = _emptyOriginal[tab];
            el.style.display = 'none';
            return;
        }
        const kw = kwText();
        // 三个 Tab 均提供全局搜索入口（含作者/收藏夹一级列表 0 命中），避免误解为只搜点赞
        if (kw && !state.global.active) {
            el.innerHTML = _emptyOriginal[tab] +
                '<div style="margin-top:14px;">' +
                '<button class="pager-btn" id="globalSearchBtn" style="padding:8px 18px;font-size:14px;cursor:pointer;">🔍 全局搜索整个库</button>' +
                '<div style="margin-top:6px;font-size:12px;color:#999;">全局搜索需要所有关键词都匹配，首次需加载索引，稍慢</div>' +
                '</div>';
            el.style.display = 'block';
            const btn = $('globalSearchBtn');
            if (btn) btn.addEventListener('click', function () { runGlobalSearch(btn); });
        } else if (state.global.active && kw) {
            el.innerHTML = `🔍 整个库内未找到匹配「${core.escapeHtml(kw)}」的作品` +
                '<div style="margin-top:6px;font-size:12px;color:#999;">若数据刚更新，请在扩展中重新选择文件夹以重新生成索引</div>';
            el.style.display = 'block';
        } else {
            el.innerHTML = _emptyOriginal[tab];
            el.style.display = 'block';
        }
    }

    function isDefaultView() {
        // 默认：仅启用时间且为降序
        const onlyTimeDesc = state.sortOrder.length === 1 &&
            state.sortOrder[0] === 'time' && state.sortDirs.time === 'desc';
        return state.filter === 'all' && state.keyword === '' && state.keywords.length === 0 &&
            onlyTimeDesc &&
            !state.dateFrom && !state.dateTo;
    }

    // ---------- 平台栏 ----------

    function renderPlatformBar() {
        const bar = $('platformBar');
        if (!bar) return;
        // 单平台优雅降级：不渲染平台栏
        if (state.platforms.length < 2) { bar.style.display = 'none'; return; }
        bar.style.display = 'flex';
        bar.innerHTML = state.platforms.map(function (p) {
            const active = state.currentPlatform && p.platform === state.currentPlatform.platform ? ' active' : '';
            return `<button class="platform-btn${active}" data-platform="${core.escapeHtml(p.platform)}">${core.escapeHtml(p.name)}</button>`;
        }).join('');
        bar.querySelectorAll('.platform-btn').forEach(function (btn) {
            btn.addEventListener('click', function () {
                const pf = state.platforms.find(function (x) { return x.platform === btn.getAttribute('data-platform'); });
                if (pf) switchPlatform(pf);
            });
        });
    }

    async function switchPlatform(pf) {
        if (!pf || (state.currentPlatform && pf.platform === state.currentPlatform.platform)) return;
        state.currentPlatform = pf;
        // 重置各维度缓存
        state.manifest = null;
        state.liked = { works: [], loaded: false, loading: false };
        state.authors = { list: [], loaded: false, subUid: null, subWorks: [] };
        state.collects = { subId: null, subWorks: [] };
        state.global = { index: null, active: false, works: [] };  // 索引按平台生成，切平台必须丢弃
        state.currentPage = 1;
        renderPlatformBar();
        try {
            await loadManifestAndEnter();
        } catch (e) {
            showError('平台数据加载失败：' + core.escapeHtml(e.message));
        }
    }

    // ---------- manifest 与入口 ----------

    async function loadManifestAndEnter() {
        showLoading();
        await loadScript(`${dataPath()}/manifest.js`);
        const m = core.takeGlobal(VAR_MANIFEST);
        if (!m) { showError('清单解析失败（manifest.js）'); return; }
        state.manifest = m;

        setCount('countLiked', m.counts && m.counts.liked, function (d, t) { return `已下载点赞作品 ${d} / 点赞作品总数 ${t}`; });
        setCount('countAuthors', m.counts && m.counts.authors, function (d, t) { return `有已下载作品的作者 ${d} / 关注作者总数 ${t}`; });
        setCount('countBookmarked', m.counts && m.counts.bookmarked, function (d, t) { return `有已下载作品的收藏夹 ${d} / 收藏夹总数 ${t}`; });

        const sub = $('subtitle');
        if (sub) {
            const name = state.currentPlatform.name || state.currentPlatform.platform;
            const gen = m.generatedAt ? core.formatTime(m.generatedAt) : '';
            sub.textContent = `${name} · 数据快照 ${gen}`;
        }
        hideLoading();
        showContent();
        switchTab('liked');
    }

    function showLoading() {
        const el = $('loading');
        if (el) el.style.display = 'block';
        const c = $('content');
        if (c) c.style.display = 'none';
    }

    /**
     * 渲染 tab 计数徽标。
     * 新语义：c 为 { downloaded, total } → 显示 "(已下载/总数)" 并带维度悬浮说明；
     * 兼容旧数据（c 为单数字）→ 显示 "(n)"。
     */
    function setCount(id, c, tipFn) {
        const el = $(id);
        if (!el) return;
        if (c && typeof c === 'object') {
            const d = c.downloaded || 0;
            const t = c.total || 0;
            el.textContent = `(${core.formatCount(d)}/${core.formatCount(t)})`;
            el.title = (typeof tipFn === 'function') ? tipFn(d, t) : `已下载 ${d} / 共 ${t}`;
        } else if (c || c === 0) {
            el.textContent = `(${core.formatCount(c)})`;
            el.removeAttribute('title');
        } else {
            el.textContent = '';
            el.removeAttribute('title');
        }
    }

    // ---------- Tab 切换 ----------

    function switchTab(tab) {
        exitGlobalSearch(false);
        state.currentTab = tab;
        // 退出二级视图 + 重置分页
        state.authors.subUid = null;
        state.authors.subWorks = [];
        state.collects.subId = null;
        state.collects.subWorks = [];
        state.currentPage = 1;
        hideSubView();

        document.querySelectorAll('#tabNav .tab-btn').forEach(function (btn) {
            btn.classList.toggle('active', btn.getAttribute('data-tab') === tab);
        });
        ['liked', 'authors', 'bookmarked'].forEach(function (t) {
            const pane = $('pane-' + t);
            if (pane) pane.classList.toggle('active', t === tab);
        });
        updateToolbarForView();

        if (tab === 'liked') {
            if (!state.liked.loaded && !state.liked.loading) loadAllLiked();
            else renderCurrentList();
        } else if (tab === 'authors') {
            loadAuthorsIndex();
        } else if (tab === 'bookmarked') {
            renderCurrentList();
        }
    }

    // ---------- 点赞维度（一次性加载全部分片后分页） ----------

    async function loadAllLiked() {
        const L = state.liked;
        if (L.loading || L.loaded) return;
        L.loading = true;
        setMoreHint('正在加载全部点赞作品…');

        const months = (state.manifest && state.manifest.likedMonths) || [];
        for (let i = 0; i < months.length; i++) {
            try {
                await loadScript(`${dataPath()}/liked/${months[i]}.js`);
                const data = core.takeGlobal(VAR_LIKED);
                if (data && Array.isArray(data.works)) {
                    L.works = L.works.concat(data.works);
                }
            } catch (e) {
                // 分片缺失：跳过该月
                console.warn('[index] 点赞分片加载失败:', months[i], e.message);
            }
        }
        L.loaded = true;
        L.loading = false;
        setMoreHint('');
        renderCurrentList();
    }

    function setMoreHint(text) {
        const el = $('more-liked');
        if (!el) return;
        el.style.display = text ? 'block' : 'none';
        el.textContent = text || '';
    }

    // ---------- 作者维度（一级列表 / 二级单作者） ----------

    async function loadAuthorsIndex() {
        if (!state.authors.loaded) {
            try {
                await loadScript(`${dataPath()}/authors/index.js`);
                const data = core.takeGlobal(VAR_AUTHORS_INDEX);
                state.authors.list = (data && Array.isArray(data.authors)) ? data.authors : [];
            } catch (e) {
                state.authors.list = [];
            }
            state.authors.loaded = true;
        }
        renderCurrentList();
    }

    async function openAuthor(uid) {
        if (!uid) return;
        exitGlobalSearch(false);
        state.authors.subUid = uid;
        state.authors.subWorks = [];
        state.currentPage = 1;
        showSubView('加载中…', '');
        updateToolbarForView();
        try {
            await loadScript(`${dataPath()}/authors/${uid}.js`);
            const data = core.takeGlobal(VAR_AUTHOR_WORKS);
            state.authors.subWorks = (data && Array.isArray(data.works)) ? data.works : [];
            setSubViewTitle((data && data.nickname) || '作者', `${state.authors.subWorks.length} 个作品`);
        } catch (e) {
            state.authors.subWorks = [];
            setSubViewTitle('作者', '');
        }
        renderCurrentList();
    }

    // ---------- 收藏夹维度（一级清单 / 二级单收藏夹） ----------

    function renderCollectCard(c) {
        return `
            <div class="author-card" data-collectid="${core.escapeHtml(c.collectId)}" data-name="${core.escapeHtml(c.collectName)}" data-action="open-collect">
                <div class="author-info">
                    <div class="author-avatar" style="background:#e6f7ff;display:flex;align-items:center;justify-content:center;font-size:20px;">📁</div>
                    <div class="author-details">
                        <div class="author-name">${core.escapeHtml(c.collectName) || '未命名收藏夹'}</div>
                        <div class="author-stats">${c.workCount || 0} 个作品</div>
                    </div>
                </div>
            </div>`;
    }

    async function openCollect(collectId, name) {
        if (!collectId) return;
        exitGlobalSearch(false);
        state.collects.subId = collectId;
        state.collects.subWorks = [];
        state.currentPage = 1;
        // 空收藏夹无分片文件
        const meta = ((state.manifest && state.manifest.collects) || [])
            .find(function (c) { return String(c.collectId) === String(collectId); });
        if (meta && !meta.workCount) {
            showSubView(name || '收藏夹', '0 个作品');
            updateToolbarForView();
            renderCurrentList();
            return;
        }
        showSubView('加载中…', '');
        updateToolbarForView();
        try {
            await loadScript(`${dataPath()}/bookmarked/${collectId}.js`);
            const data = core.takeGlobal(VAR_BOOKMARKED);
            state.collects.subWorks = (data && Array.isArray(data.works)) ? data.works : [];
            setSubViewTitle((data && data.collectName) || name || '收藏夹', `${state.collects.subWorks.length} 个作品`);
        } catch (e) {
            state.collects.subWorks = [];
            setSubViewTitle(name || '收藏夹', '');
        }
        renderCurrentList();
    }

    // ---------- 统一列表渲染（筛选/排序/搜索/日期 → 分页） ----------

    /** 当前视图的完整数据（已筛选/排序/搜索，未分页） */
    function getCurrentItems() {
        if (state.global.active) {
            return features.applyFilterSortSearch(state.global.works, state);
        }
        if (state.currentTab === 'liked') {
            return features.applyFilterSortSearch(state.liked.works, state);
        }
        if (state.currentTab === 'authors') {
            if (state.authors.subUid) return features.applyFilterSortSearch(state.authors.subWorks || [], state);
            return features.filterAuthors(state.authors.list, state);
        }
        if (state.currentTab === 'bookmarked') {
            if (state.collects.subId) return features.applyFilterSortSearch(state.collects.subWorks || [], state);
            const collects = (state.manifest && state.manifest.collects) || [];
            const kws = activeKeywords();
            return kws.length
                ? collects.filter(function (c) {
                    const n = (c.collectName || '').toLowerCase();
                    return kws.some(function (k) { return n.indexOf(k) !== -1; });
                })
                : collects;
        }
        return [];
    }

    /** 渲染当前视图：作品视图分页，作者/收藏夹一级列表全量显示 */
    function renderCurrentList() {
        const items = getCurrentItems();
        const total = items.length;
        const tab = state.currentTab;
        const list = $('list-' + tab);
        const isAuthorCards = (tab === 'authors' && !state.authors.subUid && !state.global.active);
        const isCollectCards = (tab === 'bookmarked' && !state.collects.subId && !state.global.active);

        // 全局搜索模式去除 Tab 高亮（结果视图不属于“点赞”列表），退出后自动恢复
        document.querySelectorAll('#tabNav .tab-btn').forEach(function (btn) {
            btn.classList.toggle('active', !state.global.active && btn.getAttribute('data-tab') === tab);
        });

        let pageItems;
        if (isWorksView()) {
            // 作品视图（点赞 / 作者详情 / 收藏夹详情）：分页
            const size = state.pageSize > 0 ? state.pageSize : DEFAULT_PAGE_SIZE;
            const totalPages = Math.max(1, Math.ceil(total / size));
            if (state.currentPage > totalPages) state.currentPage = totalPages;
            if (state.currentPage < 1) state.currentPage = 1;
            const start = (state.currentPage - 1) * size;
            pageItems = items.slice(start, start + size);
            renderPager('pager', total, totalPages);
        } else {
            // 作者 / 收藏夹一级列表：不分页，全部显示，隐藏分页条
            pageItems = items;
            const pager = $('pager');
            if (pager) { pager.style.display = 'none'; pager.innerHTML = ''; }
        }

        if (isAuthorCards) {
            core.renderAuthorList(list, pageItems);
        } else if (isCollectCards) {
            if (list) list.innerHTML = pageItems.map(renderCollectCard).join('');
        } else {
            core.renderWorkList(list, pageItems);
        }

        updateEmptyState(tab, total);
        updateToolbarForView();
    }

    /** 渲染分页条（首页/上一页/下一页/末页 + 计数） */
    function renderPager(pagerId, total, totalPages) {
        const el = $(pagerId);
        if (!el) return;
        if (total === 0) { el.style.display = 'none'; el.innerHTML = ''; return; }
        const cur = state.currentPage;
        el.style.display = 'flex';
        el.innerHTML =
            `<span class="pager-info">共 ${total} 条 · 第 ${cur}/${totalPages} 页</span>` +
            '<div class="pager-btns">' +
            `<button class="pager-btn" data-page="1"${cur <= 1 ? ' disabled' : ''}>首页</button>` +
            `<button class="pager-btn" data-page="${cur - 1}"${cur <= 1 ? ' disabled' : ''}>上一页</button>` +
            `<button class="pager-btn" data-page="${cur + 1}"${cur >= totalPages ? ' disabled' : ''}>下一页</button>` +
            `<button class="pager-btn" data-page="${totalPages}"${cur >= totalPages ? ' disabled' : ''}>末页</button>` +
            '</div>' +
            '<span class="pager-jump">跳至' +
            `<input type="number" class="pager-jump-input" min="1" max="${totalPages}" title="输入页码，回车跳转">` +
            '页</span>';
        el.querySelectorAll('.pager-btn').forEach(function (btn) {
            btn.addEventListener('click', function () {
                if (btn.disabled) return;
                const p = parseInt(btn.getAttribute('data-page'), 10);
                if (p >= 1 && p <= totalPages) goToPage(p);
            });
        });
        // 跳页输入框：回车或失焦跳转，页码夹取到 [1, totalPages]
        const jumpInput = el.querySelector('.pager-jump-input');
        if (jumpInput) {
            const doJump = function () {
                const p = parseInt(jumpInput.value, 10);
                if (isNaN(p)) return;
                const target = Math.min(totalPages, Math.max(1, p));
                jumpInput.value = '';
                if (target !== state.currentPage) goToPage(target);
            };
            jumpInput.addEventListener('keydown', function (e) {
                if (e.key === 'Enter') { e.preventDefault(); doJump(); }
            });
            jumpInput.addEventListener('change', doJump);
        }
    }

    function goToPage(p) {
        state.currentPage = p;
        renderCurrentList();
        // 列表在 .tab-content 内独立滚动，翻页后回到该滚动容器顶部（而非 window）
        const tc = document.querySelector('.tab-content');
        if (tc) tc.scrollTo({ top: 0, behavior: 'smooth' });
    }

    // ---------- 时间筛选可见性（仅作品视图） ----------

    /** 当前是否为“作品卡片”视图：点赞 / 作者详情 / 收藏夹详情 */
    function isWorksView() {
        if (state.global.active) return true;  // 全局搜索结果同样是作品列表
        if (state.currentTab === 'liked') return true;
        if (state.currentTab === 'authors') return !!state.authors.subUid;
        if (state.currentTab === 'bookmarked') return !!state.collects.subId;
        return false;
    }

    function updateToolbarForView() {
        const works = isWorksView();
        const sec = $('dateFilterSection');
        if (sec) sec.style.display = works ? 'flex' : 'none';
        // 每页数量选择器与分页一致，仅作品视图显示
        const ps = $('pageSizeSection');
        if (ps) ps.style.display = works ? 'flex' : 'none';
        // 蓝色退出按钮（筛选「未保存」右侧）：仅全局搜索模式显示
        const gb = $('globalExitBtn');
        if (gb) gb.style.display = state.global.active ? 'inline-flex' : 'none';
    }

    // ---------- 二级视图返回栏 ----------

    function showSubView(title, meta) {
        const bar = $('subViewBar');
        if (bar) bar.style.display = 'flex';
        setSubViewTitle(title, meta);
    }
    function setSubViewTitle(title, meta) {
        const t = $('subViewTitle'); if (t) t.textContent = title || '';
        const m = $('subViewMeta'); if (m) m.textContent = meta || '';
    }
    function hideSubView() {
        const bar = $('subViewBar');
        if (bar) bar.style.display = 'none';
    }

    function onSubViewBack() {
        // 全局搜索结果视图：返回 = 退出全局搜索（并清空关键词）
        if (state.global.active) {
            exitGlobalSearch(true);
            state.currentPage = 1;
            renderCurrentList();
            return;
        }
        if (state.currentTab === 'authors') {
            state.authors.subUid = null;
            state.authors.subWorks = [];
        } else if (state.currentTab === 'bookmarked') {
            state.collects.subId = null;
            state.collects.subWorks = [];
        }
        state.currentPage = 1;
        hideSubView();
        renderCurrentList();
    }

    // ---------- 当前视图重渲染（筛选/排序/搜索/日期变化时回到第 1 页） ----------

    function rerenderCurrent() {
        state.currentPage = 1;
        renderCurrentList();
    }

    // ---------- UI 绑定 ----------

    /** 在筛选组「未保存」后动态插入蓝色「退出全局搜索」按钮（仅全局模式显示） */
    function ensureGlobalExitBtn() {
        if ($('globalExitBtn')) return;
        const radios = document.querySelectorAll('input[name="filter"]');
        const last = radios.length ? radios[radios.length - 1] : null;
        const label = last && last.closest ? last.closest('label') : null;
        if (!label || !label.parentNode) return;
        const btn = document.createElement('button');
        btn.id = 'globalExitBtn';
        btn.className = 'global-exit-btn';
        btn.textContent = '✕ 退出全局搜索';
        btn.title = '返回按当前 Tab 范围浏览';
        btn.style.display = 'none';
        btn.addEventListener('click', function () {
            exitGlobalSearch(true);
            state.currentPage = 1;
            renderCurrentList();
        });
        label.parentNode.insertBefore(btn, label.nextSibling);
    }

    function bindUI() {
        // Tab 切换
        const nav = $('tabNav');
        if (nav) nav.addEventListener('click', function (e) {
            const btn = e.target.closest('.tab-btn');
            if (btn) switchTab(btn.getAttribute('data-tab'));
        });

        // 收藏夹一级点击（容器级委托）
        const bmList = $('list-bookmarked');
        if (bmList) bmList.addEventListener('click', function (e) {
            const card = e.target.closest('[data-action="open-collect"]');
            if (card) openCollect(card.getAttribute('data-collectid'), card.getAttribute('data-name'));
        });

        // 返回
        const back = $('subViewBack');
        if (back) back.addEventListener('click', onSubViewBack);

        // 搜索（防抖）；输入值中出现中/英文逗号（输入法上字或粘贴）时自动切分固化为小卡片
        const search = $('searchInput');
        if (search) search.addEventListener('input', features.debounce(function () {
            if (/[,，]/.test(search.value)) { commitKeywords(); return; }
            state.keyword = search.value.trim();
            // 修改关键词回落到分片内搜索（索引缓存保留，再次全局搜索免重载）
            if (state.global.active) exitGlobalSearch(false);
            rerenderCurrent();
        }, 250));

        // 多关键词：回车固化（逗号由 input 通道处理，这里兜底直接键入时阻止逗号落入输入框）；空输入时退格删最后一个
        if (search) {
            search.addEventListener('keydown', function (e) {
                if (e.key === 'Enter' || e.key === ',' || e.key === '，') {
                    e.preventDefault();
                    commitKeywords();
                } else if (e.key === 'Backspace' && !search.value && state.keywords.length) {
                    state.keywords.pop();
                    renderSearchChips();
                    rerenderCurrent();
                }
            });
        }

        // 小卡片「×」点击移除该关键词；点击容器空白处聚焦输入框
        const sbox = $('searchBox');
        if (sbox) sbox.addEventListener('click', function (e) {
            const close = e.target.closest && e.target.closest('.chip-close');
            if (close) {
                const chip = close.closest('.search-chip');
                const kwv = chip.getAttribute('data-kw');
                const i = state.keywords.indexOf(kwv);
                if (i !== -1) state.keywords.splice(i, 1);
                renderSearchChips();
                rerenderCurrent();
                if (search) search.focus();
            } else if (e.target === sbox || e.target.id === 'searchChips') {
                if (search) search.focus();
            }
        });

        // 筛选
        document.querySelectorAll('input[name="filter"]').forEach(function (radio) {
            radio.addEventListener('change', function () {
                if (radio.checked) { state.filter = radio.value; rerenderCurrent(); }
            });
        });

        // 时间范围筛选（仅作品视图生效）
        const df = $('dateFrom');
        const dt = $('dateTo');
        if (df) df.addEventListener('change', function () { state.dateFrom = df.value || ''; rerenderCurrent(); });
        if (dt) dt.addEventListener('change', function () { state.dateTo = dt.value || ''; rerenderCurrent(); });
        const dclear = $('dateClear');
        if (dclear) dclear.addEventListener('click', function () {
            state.dateFrom = ''; state.dateTo = '';
            if (df) df.value = '';
            if (dt) dt.value = '';
            rerenderCurrent();
        });

        // 每页数量
        const ps = $('pageSizeSelect');
        if (ps) {
            ps.value = String(state.pageSize);
            ps.addEventListener('change', function () {
                const n = parseInt(ps.value, 10);
                state.pageSize = (n > 0) ? n : DEFAULT_PAGE_SIZE;
                rerenderCurrent();
            });
        }

        // 排序（多选叠加；方框=启用/停用，文本与箭头=升降）
        bindSort('sortByTime', 'dirTime', 'sortTextTime', 'time');
        bindSort('sortByStatus', 'dirStatus', 'sortTextStatus', 'status');
        syncSortUI();

        // 作者卡片点击（core 委托回调）
        core.__onOpenAuthor = openAuthor;
    }

    /** 该维度是否已启用（在排序栈中） */
    function sortEnabled(key) {
        return state.sortOrder.indexOf(key) !== -1;
    }

    /**
     * 由 state（sortOrder + sortDirs）反推控件状态（勾选 / 箭头字符 / 提示）
     * state 是唯一真源，UI 永远被它覆写，避免旧实现“互斥时置灰、回落时不恢复”导致的箭头永久置灰
     */
    function syncSortUI() {
        const dims = [['time', 'sortByTime', 'dirTime', 'sortTextTime'],
            ['status', 'sortByStatus', 'dirStatus', 'sortTextStatus']];
        dims.forEach(function (d) {
            const idx = state.sortOrder.indexOf(d[0]);
            const on = idx !== -1;
            const asc = state.sortDirs[d[0]] === 'asc';
            const chk = $(d[1]);
            const dir = $(d[2]);
            const txt = $(d[3]);
            if (chk) chk.checked = on;
            if (dir) dir.textContent = asc ? '↑' : '↓';
            // 提示里带上该维度的优先级，让“先勾选为主键”可被发现
            const rank = on ? (idx === 0 ? '主键' : '第 ' + (idx + 1) + ' 优先级') : '未启用';
            const tip = '点击切换' + (d[0] === 'time' ? '时间' : '保存状态') + '升/降序（当前'
                + (asc ? '升序' : '降序') + '・' + rank + '）';
            if (dir) dir.title = tip;
            if (txt) txt.title = tip + (on ? '' : '；点左侧方框可启用');
        });
    }

    /** 翻转某维度的升/降序；仅该维度已启用时才需重排列表 */
    function toggleSortDir(key) {
        state.sortDirs[key] = state.sortDirs[key] === 'asc' ? 'desc' : 'asc';
        syncSortUI();
        if (sortEnabled(key)) rerenderCurrent();
    }

    /**
     * 绑定单个排序维度
     * 交互约定（职责分离）：
     *  - 左侧方框：仅负责启用/停用；启用时追加到排序栈末尾（先选为主键，后选为次级键），停用则从栈中移除
     *  - 选项文本与右侧箭头：仅负责翻转该维度的升/降序，不改启用状态（未启用也可预先设定）
     */
    function bindSort(checkId, dirId, textId, key) {
        const chk = $(checkId);
        const dir = $(dirId);
        const txt = $(textId);

        if (chk) chk.addEventListener('change', function () {
            const i = state.sortOrder.indexOf(key);
            if (chk.checked) {
                if (i === -1) state.sortOrder.push(key);
            } else if (i !== -1) {
                state.sortOrder.splice(i, 1);
            }
            syncSortUI();
            rerenderCurrent();
        });

        if (txt) txt.addEventListener('click', function () {
            toggleSortDir(key);
        });

        if (dir) dir.addEventListener('click', function (e) {
            // 箭头已不在 label 内， preventDefault 仅防默认行为残留
            e.preventDefault();
            toggleSortDir(key);
        });
    }

    // ---------- 初始化 ----------

    async function init() {
        if (!core) { console.error('[index] LocalCore 未加载'); showNoDataGuide(); return; }
        core.initInteractions();
        if (features && features.bindHoverPreview) features.bindHoverPreview();
        ensureGlobalExitBtn();
        bindUI();

        try {
            await loadScript(OFFLINE_INDEX_PATH);
            const idx = core.takeGlobal(VAR_INDEX);
            if (!idx || !Array.isArray(idx.platforms) || idx.platforms.length === 0) {
                showNoDataGuide();
                return;
            }
            state.platforms = idx.platforms;
            state.currentPlatform = idx.platforms[0];
            renderPlatformBar();
            await loadManifestAndEnter();
        } catch (e) {
            showNoDataGuide();
        }
    }

    window.LocalIndex = {
        init: init,
        state: state,
        switchTab: switchTab,
        switchPlatform: switchPlatform
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
