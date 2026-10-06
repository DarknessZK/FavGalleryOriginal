// ==========================================
// 我的收藏页面 - 核心功能模块
// 负责：数据解析、HTML生成、渲染逻辑、本地媒体预览
// 说明：经典脚本（file:// 不支持 ES module），挂载到 window.LocalCore
// ==========================================

(function () {
    'use strict';

    // ---------- 诊断镜像：把 console.warn/error 同步写入离线页诊断缓冲 ----------
    // window.__favGalleryDiag 由 my-collection.html 内联脚本提供（先于本文件执行）；
    // 集中包装一次即可覆盖 core/features/index 全部 warn/error 调用点，无需逐处改。
    (function () {
        var diag = window.__favGalleryDiag;
        if (!diag) return;
        ['warn', 'error'].forEach(function (lvl) {
            var orig = console[lvl];
            console[lvl] = function () {
                try {
                    var parts = [];
                    for (var i = 0; i < arguments.length; i++) {
                        var a = arguments[i];
                        if (a instanceof Error) parts.push((a.message || '') + (a.stack ? ' | ' + String(a.stack).split('\n')[1].trim() : ''));
                        else if (a && typeof a === 'object') { try { parts.push(JSON.stringify(a)); } catch (e) { parts.push(String(a)); } }
                        else parts.push(String(a));
                    }
                    diag[lvl](parts.join(' '), 'console');
                } catch (e) { /* 诊断自身不得影响业务 */ }
                return orig.apply(console, arguments);
            };
        });
    })();

    // ---------- 工具 ----------

    /** HTML 转义，防止 desc/nickname 中的特殊字符破坏结构 */
    function escapeHtml(str) {
        if (str === null || str === undefined) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    /** 解析全局变量（serializeData 产物为 JSON 字符串），失败返回 null */
    function parseGlobal(varName) {
        try {
            const raw = window[varName];
            if (raw === undefined || raw === null) return null;
            return typeof raw === 'string' ? JSON.parse(raw) : raw;
        } catch (e) {
            console.warn('[core] 解析全局变量失败:', varName, e);
            return null;
        }
    }

    /**
     * 取走分片全局变量并清空。
     * 同类分片（如每月 liked_works）共用一个变量名，加载后须立即取走，
     * 否则下一片会覆盖上一片。
     */
    function takeGlobal(varName) {
        const data = parseGlobal(varName);
        try { delete window[varName]; } catch (e) { window[varName] = undefined; }
        return data;
    }

    /** 毫秒时间戳 → YYYY-MM-DD */
    function formatTime(ms) {
        if (!ms || typeof ms !== 'number') return '';
        const d = new Date(ms);
        if (isNaN(d.getTime())) return '';
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${y}-${m}-${day}`;
    }

    /** 大数字简写：1.2万 / 3.4亿 */
    function formatCount(n) {
        if (!n || typeof n !== 'number') return '0';
        if (n >= 1e8) return (n / 1e8).toFixed(1).replace(/\.0$/, '') + '亿';
        if (n >= 1e4) return (n / 1e4).toFixed(1).replace(/\.0$/, '') + '万';
        return String(n);
    }

    /** 图集序号两位补齐：1 → 01 */
    function padIndex(i) {
        return String(i).padStart(2, '0');
    }

    /** 依据 localImageDir + imageCount 枚举图集本地路径 */
    function buildImagePaths(work) {
        const paths = [];
        if (!work || !work.localImageDir || !work.imageCount) return paths;
        for (let i = 1; i <= work.imageCount; i++) {
            paths.push(`${work.localImageDir}/${work.workId}_${padIndex(i)}.jpg`);
        }
        return paths;
    }

    /**
     * ✅ 观察 D 修复：探测图集实际落盘张数
     * imageCount 来自平台 API 记录，可能大于实际下载成功的张数（部分失败/事后清理）。
     * 打开图集预览时并行预加载全部图，裂图从可切换列表中剔除，避免难看的破图。
     */
    function probeImages(paths, cb) {
        let settled = 0;
        const flags = new Array(paths.length);
        for (let i = 0; i < paths.length; i++) {
            (function (idx) {
                const im = new Image();
                const finish = function (ok) {
                    flags[idx] = !!ok;
                    if (++settled === paths.length) {
                        cb(paths.filter(function (p, j) { return flags[j]; }));
                    }
                };
                im.onload = function () { finish(true); };
                im.onerror = function () { finish(false); };
                im.src = paths[idx];
            })(i);
        }
    }

    // ---------- 卡片渲染 ----------

    /** 作者卡片 HTML（对齐 .author-card / .author-info 结构） */
    function renderAuthorCard(author) {
        const status = author.downloadStatus || 'pending';
        let badge = '';
        let cardExtra = '';
        // ✅ 已取关（软删除）角标优先：条目保留在列表，标注失效状态供后续清理功能使用
        if (author.isDeleted) {
            badge = '<span class="status-badge" style="background:#bfbfbf;" title="已取消关注（软删除）：作品保留在本地">🚫</span>';
        } else if (status === 'completed') {
            badge = '<span class="status-badge status-completed" title="已全部保存">✓</span>';
            cardExtra = ' status-completed-card';
        } else if (status === 'partial') {
            badge = '<span class="status-badge status-partial" title="部分已保存">◐</span>';
        }

        const avatar = author.avatarUrl
            ? `<img class="author-avatar" src="${escapeHtml(author.avatarUrl)}" loading="lazy" alt="" onerror="this.style.visibility='hidden'">`
            : '<div class="author-avatar" style="background:#e8e8e8;"></div>';

        const stats = `作品 ${author.workCount || 0} · 已存 ${author.downloadedCount || 0}` +
            (author.followerCount ? ` · 粉丝 ${formatCount(author.followerCount)}` : '');

        return `
            <div class="author-card${cardExtra}" data-uid="${escapeHtml(author.uid)}" data-action="open-author">
                ${badge}
                <div class="author-info">
                    ${avatar}
                    <div class="author-details">
                        <div class="author-name">${escapeHtml(author.nickname) || '未知作者'}</div>
                        <div class="author-stats">${stats}</div>
                    </div>
                </div>
            </div>`;
    }

    // 去掉描述中的话题 token（#xxx / ＃xxx）用于展示——话题已单独成 chips，不重复显示
    // （与 utils/topic.js extractTopics 同边界规则；离线页为经典脚本无法 import，此处内联等价实现）
    function stripTopicTokens(desc) {
        if (typeof desc !== 'string' || !desc) return '';
        return desc.replace(/[＃#][^\s＃#，。！？、；：,.!?;:]+/g, '')
                   .replace(/\s{2,}/g, ' ')
                   .trim();
    }

    /** 作品卡片 HTML（对齐 .video-card / .video-cover / .video-info 结构） */
    function renderWorkCard(work) {
        const isImagePost = !!work.isImagePost || work.mediaType === 'image_post';
        const downloaded = !!work.isDownloaded;

        // 封面：已下载用本地封面，本地文件缺失时回退远程封面（观察 C 修复）；未下载降级远程
        const remoteCover = work.coverUrl || '';
        const useLocalCover = downloaded && !!work.localCoverPath;
        const coverSrc = useLocalCover ? work.localCoverPath : remoteCover;
        const coverFallbackAttr = (useLocalCover && remoteCover)
            ? ` data-fb-fallback="${escapeHtml(remoteCover)}"` : '';
        const coverOnError = (useLocalCover && remoteCover)
            ? "if(!this.dataset.fbTried&&this.dataset.fbFallback){this.dataset.fbTried='1';this.src=this.dataset.fbFallback;}else{this.style.background='#e8e8e8';this.removeAttribute('src');}"
            : "this.style.background='#e8e8e8';this.removeAttribute('src')";
        const cover = coverSrc
            ? `<img class="video-cover" src="${escapeHtml(coverSrc)}" loading="lazy" alt="" data-action="preview"${coverFallbackAttr} onerror="${coverOnError}">`
            : '<div class="video-cover" data-action="preview" style="display:flex;align-items:center;justify-content:center;color:#bbb;">无封面</div>';

        // 类型角标
        let typeBadge = '';
        if (isImagePost) {
            typeBadge = `<span class="media-type-badge image-post">图集${work.imageCount ? ' ' + work.imageCount : ''}</span>`;
        } else if (work.music && work.music.audioUrl) {
            typeBadge = '<span class="media-type-badge has-music">♪ 视频</span>';
        } else {
            typeBadge = '<span class="media-type-badge">视频</span>';
        }

        // 已保存角标
        const savedBadge = downloaded
            ? '<span class="status-badge status-completed" title="已保存">✓</span>'
            : '';

        // 元信息
        const metaParts = [];
        if (work.authorNickname) metaParts.push(escapeHtml(work.authorNickname));
        // 全局搜索取回的记录：标注其所属分片来源，避免误认为属于当前列表
        if (work.sourceLabel) metaParts.push('📚 来自 ' + escapeHtml(work.sourceLabel));
        const t = formatTime(work.sortTime || work.createTime);
        if (t) metaParts.push(t);
        if (work.statistics) {
            const s = work.statistics;
            if (s.playCount) metaParts.push('▶' + formatCount(s.playCount));
            if (s.likeCount) metaParts.push('♥' + formatCount(s.likeCount));
        }

        // 音频（本地优先，回退远程）
        let audio = '';
        if (work.music && (work.localMusicPath || work.music.audioUrl)) {
            const audioSrc = work.localMusicPath || work.music.audioUrl;
            const title = work.music.title ? ` title="${escapeHtml(work.music.title)}"` : '';
            audio = `<audio class="card-audio" controls preload="none" src="${escapeHtml(audioSrc)}"${title}></audio>`;
        }

        // 操作链接
        const actions = [];
        if (!isImagePost && downloaded && work.localMediaPath) {
            actions.push('<a class="card-link" data-action="play">▶ 播放视频</a>');
        }
        if (isImagePost && downloaded && work.imageCount) {
            actions.push('<a class="card-link" data-action="gallery">🖼 查看图集</a>');
        }
        // 本地文件夹（file:// 目录列表，新标签打开）：图集取 localImageDir，视频取 localMediaPath 去文件名
        if (downloaded) {
            let folder = '';
            if (work.localImageDir) {
                folder = work.localImageDir;
            } else if (work.localMediaPath) {
                const slash = work.localMediaPath.lastIndexOf('/');
                folder = slash > 0 ? work.localMediaPath.slice(0, slash) : '';
            }
            if (folder) {
                const folderHref = escapeHtml(encodeURI(folder.replace(/\/+$/, '') + '/'));
                actions.push(`<a class="card-link" href="${folderHref}" target="_blank" rel="noopener">📂 本地文件</a>`);
            }
        }
        if (work.pageUrl) {
            actions.push(`<a class="card-link" href="${escapeHtml(work.pageUrl)}" target="_blank" rel="noopener">原页面</a>`);
        }
        const actionsHtml = actions.length
            ? `<div class="card-actions">${actions.join('')}</div>`
            : '';

        // 话题标签 chips（从 desc 派生、生成端已固化进 work.topics）
        // 单个固定两行高的只读“多标签选择框”（复现侧边栏选择收藏夹组件的右侧框）：折叠可滚动，
        // 点击框体本身切为绝对定位向下展开、覆盖下方组件显示全部（refitTopicBoxes 标记可滚动）
        const topicList = Array.isArray(work.topics) ? work.topics : [];
        let topicsHtml = '';
        if (topicList.length) {
            const chipHtml = function (t) {
                return `<span class="topic-chip" data-topic="${escapeHtml(t)}" title="按此话题筛选">#${escapeHtml(t)}</span>`;
            };
            const chips = topicList.map(chipHtml).join('');
            topicsHtml = `<div class="card-topics-wrap"><div class="card-topics">${chips}</div></div>`;
        }

        // 有话题时从描述展示中去掉话题 token（避免与 chips 重复）
        const displayDesc = topicList.length ? stripTopicTokens(work.desc) : (work.desc || '');

        return `
            <div class="video-card" data-workid="${escapeHtml(work.workId)}">
                ${typeBadge}
                ${savedBadge}
                ${cover}
                <div class="video-info">
                    <div class="video-title">${escapeHtml(displayDesc) || '（无描述）'}</div>
                    <div class="video-meta">${metaParts.join(' · ')}</div>
                    ${topicsHtml}
                    ${audio}
                    ${actionsHtml}
                </div>
            </div>`;
    }

    /** 标记话题超两行被裁剪的折叠框（.has-more）：用于显示底部渐隐提示，整框仍可点击展开（插入 DOM 后同步测量） */
    function refitTopicBoxes(container) {
        if (!container) return;
        const wraps = container.querySelectorAll('.card-topics-wrap');
        for (let i = 0; i < wraps.length; i++) {
            const box = wraps[i].querySelector('.card-topics');
            if (!box) continue;
            wraps[i].classList.toggle('has-more', box.scrollHeight - box.clientHeight > 2);
        }
    }

    /** 渲染作者列表（替换容器内容） */
    function renderAuthorList(container, authors) {
        if (!container) return;
        if (!authors || authors.length === 0) {
            container.innerHTML = '';
            return;
        }
        const frag = document.createDocumentFragment();
        const tmp = document.createElement('div');
        tmp.innerHTML = authors.map(renderAuthorCard).join('');
        while (tmp.firstChild) frag.appendChild(tmp.firstChild);
        container.innerHTML = '';
        container.appendChild(frag);
    }

    /** 渲染作品列表（替换容器内容） */
    function renderWorkList(container, works) {
        if (!container) return;
        container.innerHTML = '';
        appendWorkList(container, works);
    }

    /** 追加作品列表（用于分片续加载；DocumentFragment 批量插入） */
    function appendWorkList(container, works) {
        if (!container || !works || works.length === 0) return;
        const frag = document.createDocumentFragment();
        const tmp = document.createElement('div');
        tmp.innerHTML = works.map(renderWorkCard).join('');
        // 将 work 对象绑定到卡片 DOM 节点（供点击预览时取用；expando 随节点移动保留）
        const cards = tmp.querySelectorAll('.video-card');
        for (let i = 0; i < cards.length && i < works.length; i++) {
            cards[i].__work = works[i];
        }
        while (tmp.firstChild) frag.appendChild(tmp.firstChild);
        container.appendChild(frag);
        refitTopicBoxes(container);
    }

    // ---------- 放大预览（图片 / 视频 / 图集 / 音频） ----------

    let _galleryState = null; // { paths, index, imgEl, counterEl }

    function _overlay() { return document.getElementById('coverPreviewOverlay'); }
    function _previewBody() { return document.getElementById('coverPreviewBody'); }

    function closePreview() {
        const ov = _overlay();
        if (ov) ov.classList.remove('active');
        const body = _previewBody();
        if (body) body.innerHTML = '';
        // 停止可能正在播放的音视频
        _galleryState = null;
    }

    function openPreview(work) {
        const ov = _overlay();
        const body = _previewBody();
        if (!ov || !body || !work) return;
        body.innerHTML = '';
        _galleryState = null;

        const isImagePost = !!work.isImagePost || work.mediaType === 'image_post';

        if (isImagePost && work.isDownloaded && work.imageCount) {
            // 图集模式：可左右切换
            const paths = buildImagePaths(work);
            const img = document.createElement('img');
            img.className = 'cover-preview-image';
            img.src = paths[0] || '';
            const prev = document.createElement('button');
            prev.className = 'gallery-nav prev';
            prev.textContent = '‹';
            const next = document.createElement('button');
            next.className = 'gallery-nav next';
            next.textContent = '›';
            const counter = document.createElement('div');
            counter.className = 'gallery-counter';
            counter.textContent = paths.length > 1 ? `1 / ${paths.length}（校验中…）` : `1 / ${paths.length}`;
            body.appendChild(img);
            body.appendChild(prev);
            body.appendChild(next);
            body.appendChild(counter);

            _galleryState = { paths, index: 0, imgEl: img, counterEl: counter, missing: 0 };
            prev.addEventListener('click', function (e) { e.stopPropagation(); stepGallery(-1); });
            next.addEventListener('click', function (e) { e.stopPropagation(); stepGallery(1); });

            // 观察 D：校验实际落盘张数，裂图从切换列表剔除并提示
            if (paths.length > 1) {
                probeImages(paths, function (alive) {
                    if (!_galleryState || _galleryState.imgEl !== img) return; // 预览已关闭/重开
                    if (alive.length === 0) {
                        body.innerHTML = '';
                        const tip = document.createElement('div');
                        tip.style.color = '#fff';
                        tip.textContent = '该图集的本地文件均不存在';
                        body.appendChild(tip);
                        _galleryState = null;
                        return;
                    }
                    const miss = paths.length - alive.length;
                    _galleryState.paths = alive;
                    _galleryState.index = 0;
                    _galleryState.missing = miss;
                    img.src = alive[0];
                    counter.textContent = `1 / ${alive.length}` + (miss ? `（${miss} 张缺失）` : '');
                });
            }
        } else if (!isImagePost && work.isDownloaded && work.localMediaPath) {
            // 视频模式：本地播放
            const video = document.createElement('video');
            video.controls = true;
            video.autoplay = true;
            video.src = work.localMediaPath;
            body.appendChild(video);
        } else {
            // 图片模式：本地封面优先，缺失时回退远程（观察 C 修复）
            const localFirst = !!(work.isDownloaded && work.localCoverPath);
            const src = localFirst ? work.localCoverPath : work.coverUrl;
            if (src) {
                const img = document.createElement('img');
                img.className = 'cover-preview-image';
                img.src = src;
                if (localFirst && work.coverUrl) {
                    img.onerror = function () {
                        if (!this.dataset.fbTried) { this.dataset.fbTried = '1'; this.src = work.coverUrl; }
                    };
                }
                body.appendChild(img);
            } else {
                const tip = document.createElement('div');
                tip.style.color = '#fff';
                tip.textContent = '无可预览的媒体';
                body.appendChild(tip);
            }
        }

        ov.classList.add('active');
    }

    function stepGallery(delta) {
        if (!_galleryState) return;
        const st = _galleryState;
        const len = st.paths.length;
        if (len === 0) return;
        st.index = (st.index + delta + len) % len;
        st.imgEl.src = st.paths[st.index];
        st.counterEl.textContent = `${st.index + 1} / ${len}` + (st.missing ? `（${st.missing} 张缺失）` : '');
    }

    // ---------- 悬浮小预览 ----------

    function showHoverPreview(src, x, y) {
        const box = document.getElementById('coverHoverPreview');
        const img = document.getElementById('hoverPreviewImg');
        if (!box || !img || !src) return;
        img.src = src;
        box.classList.add('active');
        const pad = 16;
        let left = x + pad;
        let top = y + pad;
        // 防溢出右/下边界
        const bw = box.offsetWidth || 400;
        const bh = box.offsetHeight || 600;
        if (left + bw > window.innerWidth) left = x - bw - pad;
        if (top + bh > window.innerHeight) top = Math.max(8, y - bh - pad);
        box.style.left = left + 'px';
        box.style.top = top + 'px';
    }

    function hideHoverPreview() {
        const box = document.getElementById('coverHoverPreview');
        if (box) box.classList.remove('active');
    }

    // ---------- 全局交互委托（一次绑定，适用于所有列表） ----------

    function initInteractions() {
        // 放大预览：点击封面 / 播放 / 图集链接
        document.addEventListener('click', function (e) {
            const trigger = e.target.closest('[data-action="preview"],[data-action="play"],[data-action="gallery"]');
            if (trigger) {
                const card = trigger.closest('.video-card');
                if (card && card.__work) {
                    openPreview(card.__work);
                }
                return;
            }
            // 作者卡片：进入单作者视图（由 index.js 通过 __onOpenAuthor 处理）
            const authorCard = e.target.closest('[data-action="open-author"]');
            if (authorCard && typeof window.LocalCore.__onOpenAuthor === 'function') {
                window.LocalCore.__onOpenAuthor(authorCard.getAttribute('data-uid'));
            }
        });

        // 关闭放大预览
        const closeBtn = document.getElementById('coverPreviewClose');
        if (closeBtn) closeBtn.addEventListener('click', closePreview);
        const ov = _overlay();
        if (ov) ov.addEventListener('click', function (e) {
            if (e.target === ov) closePreview();
        });
        // ESC 关闭 / 图集切换
        document.addEventListener('keydown', function (e) {
            if (!_overlay() || !_overlay().classList.contains('active')) return;
            if (e.key === 'Escape') closePreview();
            else if (e.key === 'ArrowLeft') stepGallery(-1);
            else if (e.key === 'ArrowRight') stepGallery(1);
        });
    }

    // 导出
    window.LocalCore = {
        // 工具
        escapeHtml: escapeHtml,
        parseGlobal: parseGlobal,
        takeGlobal: takeGlobal,
        formatTime: formatTime,
        formatCount: formatCount,
        padIndex: padIndex,
        buildImagePaths: buildImagePaths,
        // 渲染
        renderAuthorCard: renderAuthorCard,
        renderWorkCard: renderWorkCard,
        renderAuthorList: renderAuthorList,
        renderWorkList: renderWorkList,
        appendWorkList: appendWorkList,
        // 预览
        openPreview: openPreview,
        closePreview: closePreview,
        showHoverPreview: showHoverPreview,
        hideHoverPreview: hideHoverPreview,
        // 交互
        initInteractions: initInteractions,
        // 由 index.js 注入的回调钩子
        __onOpenAuthor: null
    };
})();
