// ==========================================
// 作品卡片辅助工具
// 功能：作品卡片渲染
// ==========================================

import { escapeHtml } from './ui-helpers.js';
import { createLogger } from './logger.js';

const logger = createLogger('WorkHelpers');

/**
 * 生成作品卡片 HTML
 * @param {Object} work - 作品数据对象
 * @param {Set} selectedWorkIds - 选中的作品ID集合（可选）
 */
function createWorkCardHTML(work, selectedWorkIds = null) {
    const authorName = work.author?.nickname || '未知作者';
    const desc = work.desc || '无描述';
    const coverUrl = work.video?.coverUrl || '';  // ✅ 改为 coverUrl
    const workId = work.workId || '';  // ✅ 改为 workId

    // ✅ 判断是视频还是图集
    const isImagePost = work.isImagePost || (work.images && work.images.length > 0);
    const imageCount = isImagePost ? work.images.length : 0;
    const duration = work.video?.duration || 0;

    // ✅ 统计数据
    const playCount = work.statistics?.playCount || 0;
    const likeCount = work.statistics?.likeCount || 0;  // ✅ 改为 likeCount

    // ✅ 跳转链接（优先使用缓存的 video.pageUrl，否则动态拼接）
    const workUrl = work.video?.pageUrl || `https://www.douyin.com/video/${workId}`;

    // ✅ 检查是否已下载
    const isDownloaded = work.isDownloaded === true;
    
    // ✅ 检查是否被选中（用于分页时保持 checkbox 状态）
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
                ${isDownloaded ? 'disabled' : ''}
                ${isChecked ? 'checked' : ''}
                style="margin-right: 0; cursor: ${isDownloaded ? 'not-allowed' : 'pointer'}; opacity: ${isDownloaded ? '0.5' : '1'};">
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
                    ▶️ ${playCount} | 
                    ❤️ ${likeCount}  <!-- ✅ 改为 likeCount -->
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
                    <button class="download-btn" data-work-id="${workId}" style="
                        padding: 4px 6px;
                        width: 80px;
                        background: ${isDownloaded ? '#52c41a' : '#1890ff'};
                        color: white;
                        border: none;
                        border-radius: 4px;
                        cursor: ${isDownloaded ? 'default' : 'pointer'};
                        font-size: 12px;
                        text-align: center;
                        display: inline-block;
                        white-space: nowrap;
                        box-sizing: border-box;
                    " ${isDownloaded ? 'disabled' : ''}>${isDownloaded ? '✅ 已保存' : '⬇️ 保存'}</button>
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
 */
export function renderWorkList(listEl, works, selectedWorkIds = null) {
    if (!listEl) {
        logger.warn('⚠️ 列表容器元素不存在');
        return;
    }

    if (!works || works.length === 0) {
        listEl.innerHTML = '<div style="text-align: center; color: #999; padding: 20px;">暂无数据</div>';
        return;
    }

    const html = works.map(work => createWorkCardHTML(work, selectedWorkIds)).join('');

    listEl.innerHTML = html;

    logger.info(`✅ 渲染作品列表: ${works.length} 个作品`);
}

/**
 * 生成作者卡片 HTML
 * @param {Object} author - 作者数据对象
 */
function createAuthorCardHTML(author) {
    const nickname = author.nickname || '未知作者';
    const uniqueId = author.uniqueId || author.shortId || '';
    const avatarUrl = author.avatarThumb?.urlList?.[0] || author.avatarMedium?.urlList?.[0] || '';
    const uid = author.uid || '';
    const signature = author.signature || '暂无简介';
    
    // ✅ 统计数据
    const followerCount = author.followerCount || 0;
    const followingCount = author.followingCount || 0;
    const awemeCount = author.awemeCount || 0;
    
    // ✅ 跳转链接
    const authorUrl = uid ? `https://www.douyin.com/user/${uid}` : '';

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
                style="margin-right: 0; cursor: pointer;">
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
                <div style="font-size: 12px; color: #999; margin-bottom: 4px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${escapeHtml(signature)}">
                    ${escapeHtml(signature)}
                </div>
                <div style="font-size: 11px; color: #999;">
                    👥 ${followerCount} 粉丝 | 
                    👤 ${followingCount} 关注 | 
                    🎬 ${awemeCount} 作品
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
                    <button class="download-btn" data-uid="${uid}" style="
                        padding: 4px 6px;
                        width: 80px;
                        background: #1890ff;
                        color: white;
                        border: none;
                        border-radius: 4px;
                        cursor: pointer;
                        font-size: 12px;
                        text-align: center;
                        display: inline-block;
                        white-space: nowrap;
                        box-sizing: border-box;
                    ">⬇️ 保存</button>
                </div>
            </div>
        </div>
    `;
}

/**
 * 渲染作者列表
 * @param {HTMLElement} listEl - 列表容器元素
 * @param {Array} authors - 作者数据数组
 */
export function renderAuthorList(listEl, authors) {
    if (!listEl) {
        logger.warn('⚠️ 列表容器元素不存在');
        return;
    }

    if (!authors || authors.length === 0) {
        listEl.innerHTML = '<div style="text-align: center; color: #999; padding: 20px;">暂无数据</div>';
        return;
    }

    const html = authors.map(author => createAuthorCardHTML(author)).join('');

    listEl.innerHTML = html;

    logger.info(`✅ 渲染作者列表: ${authors.length} 个作者`);
}
