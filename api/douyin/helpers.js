// ==========================================
// FavGallery - 抖音平台辅助函数
// 职责：提供抖音平台特定的辅助函数
// ==========================================

import { DOUYIN_CONFIG } from './config.js';
import { selectHighestQualityUrl, safeGet } from '../../utils/platform-helpers.js';

// ===== 设备参数相关 =====

/**
 * 获取抖音设备参数
 * 合并固定模板和动态 webid
 *
 * @returns {Object} 设备参数对象
 */
export function getDouyinDeviceParams() {
    const params = { ...DOUYIN_CONFIG.DEVICE_PARAMS_TEMPLATE };

    const webid = getDouyinWebId();
    if (webid) {
        params.webid = webid;
    }

    return params;
}

/**
 * 获取作者作品 API 的设备参数
 * 包含更多浏览器环境信息
 *
 * @returns {Object} 设备参数对象
 */
export function getAuthorWorkDeviceParams() {
    return {
        ...getDouyinDeviceParams(),
        ...DOUYIN_CONFIG.AUTHOR_WORK_DEVICE_PARAMS  // ✅ 改为 AUTHOR_WORK_DEVICE_PARAMS
    };
}

// ===== WebID 获取 =====

/**
 * 获取抖音 WebID
 * 按照配置的优先级尝试多个数据源
 * WebID 是抖音 API 的关键鉴权参数（user_unique_id）
 *
 * @returns {string|null} WebID，如果未找到则返回 null
 */
export function getDouyinWebId() {
    for (const source of DOUYIN_CONFIG.WEBID_SOURCES) {
        const value = safeGet(window, source);
        if (value) {
            return value;
        }
    }
    return null;
}

// ===== 用户信息提取 =====

/**
 * 从页面获取用户信息
 * 按照配置的优先级尝试多个数据源
 *
 * @returns {Object|null} 标准化的用户信息，如果未找到则返回 null
 */
export function getUserInfoFromPage() {
    for (const source of DOUYIN_CONFIG.USER_INFO_SOURCES) {
        const userInfo = safeGet(window, source);
        if (userInfo && userInfo.uid) {
            return normalizeUserInfo(userInfo);
        }
    }
    return null;
}

/**
 * 标准化用户信息
 * 处理不同字段名的兼容性
 *
 * @param {Object} rawInfo - 原始用户信息
 * @returns {Object} 标准化的用户信息
 * @private
 */
function normalizeUserInfo(rawInfo) {
    // 提取收藏数
    let collectCount = 0;
    if (rawInfo.userCollectCount?.collectCountList?.length > 0) {
        const firstItem = rawInfo.userCollectCount.collectCountList[0];
        collectCount = firstItem.count || firstItem.collectCount || firstItem.num || 0;
    }

    return {
        uid: rawInfo.uid,
        platformId: rawInfo.sec_uid || '',  // ✅ 只保留 sec_uid（抖音 API 实际返回）
        uniqueId: rawInfo.unique_id || rawInfo.short_id || '',  // ✅ 只保留下划线命名
        nickname: rawInfo.nickname || '未知用户',
        favoritingCount: rawInfo.favoriting_count || 0,  // ✅ 只保留下划线命名
        followingCount: rawInfo.following_count || 0,  // ✅ 只保留下划线命名
        collectCount
    };
}

// ===== URL 质量选择 =====

/**
 * 获取抖音最高画质媒体 URL
 * 优先使用 v2 版本，否则使用通用方法
 *
 * @param {Object} mediaData - 媒体数据对象（视频或音频）
 * @returns {string} 媒体 URL，如果未找到则返回空字符串
 */
export function getDouyinMediaUrl(mediaData) {  // ✅ 改为 getDouyinMediaUrl
    const urlData = mediaData?.play_addr || mediaData?.url;
    if (!urlData) return '';

    // 优先使用 v2 版本（抖音特有，通常画质更高）
    if (urlData.v2) {
        return urlData.v2;
    }

    // 否则使用通用方法
    return selectHighestQualityUrl(urlData.url_list || [], ['v2', 'origin']);
}

// ===== 验证工具 =====

/**
 * 验证用户信息完整性
 *
 * @param {Object} userInfo - 用户信息对象
 * @returns {boolean} 是否有效
 */
export function validateUserInfo(userInfo) {
    if (!userInfo) return false;
    return !!(userInfo.uid && userInfo.nickname);
}
