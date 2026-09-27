// ==========================================
// 作者卡片渲染器
// 功能：作者卡片HTML生成和列表渲染
// ==========================================

import { escapeHtml } from './ui-helpers.js';
import { createLogger } from './logger.js';

const logger = createLogger('AuthorCardRenderer');

/**
 * 格式化数字（中文单位）
 * @param {number} num - 要格式化的数字
 * @returns {string} 格式化后的字符串
 */
function formatNumber(num) {
    if (num === 0 || !num) return '0';
    
    if (num >= 100000000) {
        // 大于等于1亿，显示为 X.X亿
        return (num / 100000000).toFixed(1) + '亿';
    } else if (num >= 10000) {
        // 大于等于1万，显示为 X.X万
        return (num / 10000).toFixed(1) + '万';
    } else {
        // 小于1万，直接显示
        return num.toString();
    }
}

/**
 * 生成作者卡片 HTML
 * @param {Object} author - 作者数据对象
 * @param {Set} selectedAuthorIds - 选中的作者UID集合（可选）
 */
function createAuthorCardHTML(author, selectedAuthorIds = null) {
    const nickname = author.nickname || '未知作者';
    const uniqueId = author.uniqueId || author.shortId || '';
    const avatarUrl = author.avatarUrl || '';
    const uid = author.uid || '';
    const signature = author.signature || '暂无简介';
    
    // 统计数据
    const followerCount = author.followerCount || 0;
    const followingCount = author.followingCount || 0;
    
    // 跳转链接（使用 platformId/sec_uid）
    const platformId = author.platformId || '';
    const authorUrl = platformId ? `https://www.douyin.com/user/${platformId}` : '';
    
    // 下载状态（动态计算，不存储 downloadStatus 字段）
    const downloadedCount = author.downloadedCount || 0;
    const workCount = author.workCount || 0;
    
    // 根据状态设置按钮样式和文本
    let buttonText = '⬇️ 保存';
    let buttonStyle = 'background: #1890ff; text-align: center;';
    let buttonDisabled = false;
    let buttonClass = 'download-btn';
    
    // 优先判断：如果无作品或全部已下载，显示已完成
    if (workCount === 0 || downloadedCount >= workCount) {
        buttonText = '✅ 已保存';
        buttonStyle = 'background: #52c41a; cursor: default; text-align: center;';
        buttonDisabled = true;
        buttonClass = 'download-btn completed';
    } else if (downloadedCount > 0) {
        // 部分下载完成
        buttonText = `⚠️ ${downloadedCount}/${workCount}`;
        buttonStyle = 'background: #faad14; text-align: center;';
        buttonClass = 'download-btn partial';
    }
    
    // 检查是否被选中
    const isChecked = selectedAuthorIds && selectedAuthorIds.has(uid);

    return `
        <div class="author-item" data-uid="${uid}" style="
            display: flex;
            align-items: center;
            gap: 6px;
            padding: 6px;
            background: #f5f5f5;
            border-radius: 6px;
            transition: background 0.2s;
            cursor: pointer;
        ">
            <input type="checkbox" class="author-checkbox" data-uid="${uid}" 
                style="margin-right: 0; cursor: pointer;"
                ${isChecked ? 'checked' : ''}
                ${buttonDisabled ? 'disabled' : ''}>
            ${avatarUrl ? `
                <img src="${avatarUrl}" style="width: 80px; height: 100px; object-fit: cover; border-radius: 4px;" />
            ` : `
                <div style="width: 80px; height: 100px; border-radius: 4px; background: #ddd; display: flex; align-items: center; justify-content: center; font-size: 32px;">👤</div>
            `}
            <div style="flex: 1; min-width: 0;">
                <div style="font-size: 13px; font-weight: bold; margin-bottom: 4px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${escapeHtml(nickname)}">
                    ${escapeHtml(nickname)}
                </div>
                ${uniqueId ? `
                    <div style="font-size: 12px; color: #666; margin-bottom: 4px;">
                        🆔 ${escapeHtml(uniqueId)}
                    </div>
                ` : ''}
                <div style="font-size: 12px; color: #999; margin-bottom: 4px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" data-tip="${escapeHtml(signature)}">
                    ${escapeHtml(signature)}
                </div>
                <div style="font-size: 11px; color: #999; display: flex; flex-wrap: wrap; align-items: center; column-gap: 5px;">
                    <span style="white-space: nowrap;">👥${formatNumber(followerCount)}粉丝</span>
                    <span style="color: #d9d9d9;">|</span>
                    <span style="white-space: nowrap;">👤${formatNumber(followingCount)}关注</span>
                    <span style="color: #d9d9d9;">|</span>
                    <span style="white-space: nowrap;">🎬已存<span class="author-saved-count">${author.downloadedCount || 0}/${formatNumber(workCount)}</span><span class="author-tip-icon" data-tip="已保存作品数 / 作品总数。总数取自抖音关注列表接口，可能略少于作者主页实际作品数；完成下载后会以实际下载数量校正。" style="display:inline-flex;align-items:center;justify-content:center;width:13px;height:13px;margin-left:3px;border-radius:50%;border:1px solid #bbb;color:#999;font-size:10px;line-height:1;vertical-align:middle;flex-shrink:0;">?</span></span>
                </div>
                <div style="margin-top: 8px; display: flex; gap: 4px; align-items: center;">
                    ${authorUrl ? `
                        <a href="${authorUrl}" target="_blank" class="jump-btn" data-uid="${uid}" style="
                            padding: 4px 6px;
                            width: 80px;
                            background: #722ed1;
                            color: white;
                            border: none;
                            border-radius: 4px;
                            cursor: pointer;
                            font-size: 12px;
                            text-align: center;
                            text-decoration: none;
                            display: inline-block;
                            white-space: nowrap;
                            box-sizing: border-box;
                        ">🔗 主页</a>
                    ` : ''}
                    <button class="${buttonClass}" data-uid="${uid}" 
                        ${buttonDisabled ? 'disabled' : ''}
                        style="
                            padding: 4px 6px;
                            width: 80px;
                            ${buttonStyle}
                            color: white;
                            border: none;
                            border-radius: 4px;
                            cursor: ${buttonDisabled ? 'default' : 'pointer'};
                            font-size: 12px;
                            text-align: center;
                            display: inline-block;
                            white-space: nowrap;
                            box-sizing: border-box;
                            position: relative;
                            overflow: hidden;
                        ">${buttonText}</button>
                    <button class="works-btn" data-uid="${uid}" title="查看 TA 的全部作品" style="
                        padding: 4px 6px;
                        width: 80px;
                        background: #13c2c2;
                        color: white;
                        border: none;
                        border-radius: 4px;
                        cursor: pointer;
                        font-size: 12px;
                        text-align: center;
                        display: inline-block;
                        white-space: nowrap;
                        box-sizing: border-box;
                    ">🎬 作品</button>
                </div>
            </div>
        </div>
    `;
}

// ==========================================
// 自定义悬浮提示（替代原生 title：即时显示、不改鼠标、不被列表容器裁剪）
// ==========================================

/**
 * 惰性初始化全局悬浮提示浮层。
 * - 用 position:fixed 浮层承载 [data-tip] 文本，规避 #followingList 的 overflow 裁剪；
 * - mouseover 即时显示（无原生 title 的秒级延迟），且不改变鼠标样式；
 * - 幂等：多次调用仅初始化一次。
 */
let _hoverTipEl = null;
function _ensureHoverTooltip() {
    if (_hoverTipEl || typeof document === 'undefined' || !document.body) return;

    const tip = document.createElement('div');
    tip.className = 'fg-hover-tip';
    tip.style.cssText = [
        'position:fixed', 'z-index:2147483647', 'max-width:240px',
        'padding:6px 10px', 'background:rgba(0,0,0,.85)', 'color:#fff',
        'font-size:12px', 'line-height:1.5', 'border-radius:6px',
        'box-shadow:0 2px 8px rgba(0,0,0,.25)', 'pointer-events:none',
        'white-space:normal', 'word-break:break-word',
        'left:0', 'top:0', 'opacity:0', 'visibility:hidden'
    ].join(';');
    document.body.appendChild(tip);
    _hoverTipEl = tip;

    function show(target) {
        const text = target.getAttribute('data-tip');
        if (!text) return;
        tip.textContent = text;
        tip.style.visibility = 'visible';
        tip.style.opacity = '1';
        const r = target.getBoundingClientRect();
        const tw = tip.offsetWidth;
        const th = tip.offsetHeight;
        const gap = 8;
        let left = r.left + r.width / 2 - tw / 2;
        left = Math.max(gap, Math.min(left, window.innerWidth - tw - gap));
        let top = r.bottom + 6;
        if (top + th > window.innerHeight - gap) {
            top = r.top - th - 6; // 下方空间不足则改显示在上方
        }
        tip.style.left = left + 'px';
        tip.style.top = Math.max(gap, top) + 'px';
    }

    function hide() {
        tip.style.opacity = '0';
        tip.style.visibility = 'hidden';
    }

    document.addEventListener('mouseover', function (e) {
        const el = e.target.closest && e.target.closest('[data-tip]');
        if (el) show(el);
    });
    document.addEventListener('mouseout', function (e) {
        const el = e.target.closest && e.target.closest('[data-tip]');
        if (el) hide();
    });
    // 列表滚动时浮层不跟随，直接隐藏避免错位
    document.addEventListener('scroll', hide, true);
}

/**
 * 渲染作者列表
 * @param {HTMLElement} listEl - 列表容器元素
 * @param {Array} authors - 作者数据数组
 * @param {Set} selectedAuthorIds - 选中的作者UID集合（可选）
 */
export function renderAuthorList(listEl, authors, selectedAuthorIds = null) {
    _ensureHoverTooltip(); // ✅ 惰性初始化自定义悬浮提示（即时显示，替代原生 title 延迟）
    if (!listEl) {
        logger.warn('⚠️ 列表容器元素不存在');
        return;
    }

    if (!authors || authors.length === 0) {
        listEl.innerHTML = '<div style="text-align: center; color: #999; padding: 20px;">暂无数据</div>';
        return;
    }

    const html = authors.map(author => createAuthorCardHTML(author, selectedAuthorIds)).join('');

    listEl.innerHTML = html;

    logger.info(`✅ 渲染作者列表: ${authors.length} 个作者`);
}
