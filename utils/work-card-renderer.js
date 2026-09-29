// ==========================================
// 作品卡片渲染器
// 功能：作品卡片HTML生成和列表渲染
// ==========================================

import { escapeHtml } from './ui-helpers.js';
import { createLogger } from './logger.js';

const logger = createLogger('WorkCardRenderer');

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
 * 格式化时间戳（毫秒）为 YYYY-MM-DD HH:MM:SS
 * @param {number|string} ms
 * @returns {string} 无有效时间时返回空串
 */
function formatDate(ms) {
    if (!ms) return '';
    const d = new Date(Number(ms));
    if (isNaN(d.getTime())) return '';
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/**
 * 生成作品卡片 HTML
 * @param {Object} work - 作品数据对象
 * @param {Set} selectedWorkIds - 选中的作品ID集合（可选）
 * @param {'download'|'backfill'} [intent='download'] - 选择意图：backfill（校验补全）下已保存作品复选框解禁且可勾选
 */
function createWorkCardHTML(work, selectedWorkIds = null, intent = 'download') {
    const authorName = work.author?.nickname || '未知作者';
    const desc = work.desc || '无描述';
    const coverUrl = work.video?.coverUrl || '';
    const workId = work.workId || '';

    // 判断是视频还是图集
    const isImagePost = work.isImagePost || (work.images && work.images.length > 0);
    const imageCount = isImagePost ? work.images.length : 0;
    const duration = work.video?.duration || 0;

    // 统计数据
    const playCount = work.statistics?.playCount || 0;
    const likeCount = work.statistics?.likeCount || 0;

    // 跳转链接（优先使用缓存的 video.pageUrl，否则动态拼接）
    const workUrl = work.video?.pageUrl || `https://www.douyin.com/video/${workId}`;

    // ✅ 展示时间（与排序/筛选取值一致：sortTime || createTime）
    const workDate = formatDate(work.sortTime || work.createTime);

    // 检查是否已下载
    const isDownloaded = work.isDownloaded === true;
    // ✅ 复选框禁用口径：下载意图下已保存不可选（走单卡补全）；校验补全意图下已保存作品解禁、可逐卡勾选/取消
    const checkboxDisabled = intent === 'backfill' ? false : isDownloaded;

    // 检查是否被选中（用于分页时保持 checkbox 状态）
    const isChecked = selectedWorkIds && selectedWorkIds.has(workId);

    return `
        <div class="work-item" data-work-id="${workId}" style="
            display: flex;
            align-items: center;
            gap: 6px;
            padding: 6px;
            background: #f5f5f5;
            border-radius: 6px;
            transition: background 0.2s;
            cursor: pointer;
        ">
            <input type="checkbox" class="work-checkbox" data-work-id="${workId}" 
                ${checkboxDisabled ? 'disabled' : ''}
                ${isChecked ? 'checked' : ''}
                style="margin-right: 0; cursor: ${checkboxDisabled ? 'not-allowed' : 'pointer'}; opacity: ${checkboxDisabled ? '0.5' : '1'};">
            ${coverUrl ? `
                <img src="${coverUrl}" style="width: 80px; height: 100px; object-fit: cover; border-radius: 4px;" />
            ` : ''}
            <div style="flex: 1; min-width: 0;">
                <div style="font-size: 13px; font-weight: bold; margin-bottom: 4px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${escapeHtml(desc)}">
                    ${escapeHtml(desc)}
                </div>
                <div style="font-size: 12px; color: #666; margin-bottom: 4px;">
                    👤 ${escapeHtml(authorName)}
                </div>
                <div style="font-size: 12px; color: #999;">
                    ${isImagePost ? `🖼️ 图集 (${imageCount}张)` : `⏱️ ${Math.floor(duration / 1000)}秒`} | 
                    ${playCount > 0 ? `▶️ ${formatNumber(playCount)} | ` : ''}
                    ❤️ ${formatNumber(likeCount)}${workDate ? ` | 🕒 ${workDate}` : ''}
                </div>
                <div style="margin-top: 8px; display: flex; gap: 4px; align-items: center;">
                    <a href="${workUrl}" target="_blank" class="jump-btn" data-work-id="${workId}" style="
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
                    ">🔗 跳转</a>
                    <button class="download-btn" data-work-id="${workId}" title="${isDownloaded ? '已保存，点击检查并补全缺失的文件' : ''}" style="
                        padding: 4px 6px;
                        width: 80px;
                        background: ${isDownloaded ? '#52c41a' : '#1890ff'};
                        color: white;
                        border: none;
                        border-radius: 4px;
                        cursor: pointer;
                        font-size: 12px;
                        text-align: center;
                        display: inline-block;
                        white-space: nowrap;
                        box-sizing: border-box;
                    ">${isDownloaded ? '✅ 已保存' : '⬇️ 保存'}</button>
                </div>
            </div>
        </div>
    `;
}

/**
 * 渲染作品列表
 * @param {HTMLElement} listEl - 列表容器元素
 * @param {Array} works - 作品数据数组
 * @param {Set} selectedWorkIds - 选中的作品ID集合（可选，用于分页时保持 checkbox 状态）
 * @param {'download'|'backfill'} [intent='download'] - 选择意图（校验补全态下已保存作品复选框解禁）
 */
export function renderWorkList(listEl, works, selectedWorkIds = null, intent = 'download') {
    if (!listEl) {
        logger.warn('⚠️ 列表容器元素不存在');
        return;
    }

    if (!works || works.length === 0) {
        listEl.innerHTML = '<div style="text-align: center; color: #999; padding: 20px;">暂无数据</div>';
        return;
    }

    const html = works.map(work => createWorkCardHTML(work, selectedWorkIds, intent)).join('');

    listEl.innerHTML = html;

    logger.info(`✅ 渲染作品列表: ${works.length} 个作品`);
}
