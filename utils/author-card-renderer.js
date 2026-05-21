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
    
    // 下载状态
    const downloadStatus = author.downloadStatus || 'pending';
    const downloadedCount = author.downloadedCount || 0;
    const workCount = author.workCount || 0;
    
    // 根据状态设置按钮样式和文本
    let buttonText = '⬇️ 保存';
    let buttonStyle = 'background: #1890ff; text-align: center;';
    let buttonDisabled = false;
    let buttonClass = 'download-btn';
    
    // 优先判断：如果没有作品，直接显示已保存
    if (workCount === 0 ) {
        buttonText = '✅ 已保存';
        buttonStyle = 'background: #52c41a; cursor: default; text-align: center;';
        buttonDisabled = true;
        buttonClass = 'download-btn completed';
    } else if (downloadStatus === 'partial') {
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
                <div style="font-size: 12px; color: #999; margin-bottom: 4px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${escapeHtml(signature)}">
                    ${escapeHtml(signature)}
                </div>
                <div style="font-size: 11px; color: #999;">
                    👥 ${formatNumber(followerCount)} 粉丝 | 
                    👤 ${formatNumber(followingCount)} 关注 | 
                    🎬 已存${author.downloadedCount || 0}/${formatNumber(workCount)}作品
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
                </div>
            </div>
        </div>
    `;
}

/**
 * 渲染作者列表
 * @param {HTMLElement} listEl - 列表容器元素
 * @param {Array} authors - 作者数据数组
 * @param {Set} selectedAuthorIds - 选中的作者UID集合（可选）
 */
export function renderAuthorList(listEl, authors, selectedAuthorIds = null) {
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
