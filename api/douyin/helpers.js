// ==========================================
// FavGallery - 抖音平台辅助函数
// 职责：提供抖音平台特定的辅助函数
// ==========================================

import { DOUYIN_CONFIG } from './config.js';
import { selectHighestQualityUrl, safeGet } from '../../utils/platform-helpers.js';
import { createLogger } from '../../utils/logger.js';

const logger = createLogger('DouyinHelpers');

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
    try {
        logger.debug('=== 开始获取用户信息 ===');

        let userInfo = null;
        let successMethod = null;
        const errors = []; // 记录每个方法的错误

        // 方法 1：从 __INITIAL_STATE__ 获取
        if (window.__INITIAL_STATE__) {
            try {
                const state = window.__INITIAL_STATE__;

                if (state.user?.info) {
                    userInfo = state.user.info;
                    successMethod = '方法 1: __INITIAL_STATE__.user.info';
                } else if (state.user) {
                    userInfo = state.user;
                    successMethod = '方法 1: __INITIAL_STATE__.user';
                }
            } catch (e) {
                errors.push({ method: '方法 1', error: e.message });
            }
        }

        // 方法 2：从 RENDER_DATA script 标签获取
        if (!userInfo) {
            try {
                const el = document.getElementById('RENDER_DATA');
                if (el) {
                    const text = el.innerText || el.textContent || '';
                    if (text) {
                        const data = JSON.parse(decodeURIComponent(text));

                        if (data.app?.user?.info) {
                            userInfo = data.app.user.info;
                            successMethod = '方法 2: RENDER_DATA.app.user.info';
                        } else if (data[1]?.user?.info) {
                            userInfo = data[1].user.info;
                            successMethod = '方法 2: RENDER_DATA[1].user.info';
                        } else if (data.app?.user) {
                            userInfo = data.app.user;
                            successMethod = '方法 2: RENDER_DATA.app.user';
                        } else if (data[1]?.user) {
                            userInfo = data[1].user;
                            successMethod = '方法 2: RENDER_DATA[1].user';
                        }
                    }
                }
            } catch (e) {
                errors.push({ method: '方法 2', error: e.message });
            }
        }

        // 方法 3：从 SSR_RENDER_DATA_DOC 获取
        if (!userInfo && window.SSR_RENDER_DATA_DOC) {
            try {
                const data = window.SSR_RENDER_DATA_DOC;

                if (data.app?.user?.info) {
                    userInfo = data.app.user.info;
                    successMethod = '方法 3: SSR_RENDER_DATA_DOC.app.user.info';
                } else if (data[1]?.user?.info) {
                    userInfo = data[1].user.info;
                    successMethod = '方法 3: SSR_RENDER_DATA_DOC[1].user.info';
                } else if (data.app?.user) {
                    userInfo = data.app.user;
                    successMethod = '方法 3: SSR_RENDER_DATA_DOC.app.user';
                }
            } catch (e) {
                errors.push({ method: '方法 3', error: e.message });
            }
        }

        // 处理获取到的用户信息
        if (userInfo && userInfo.uid) {
            const result = normalizeUserInfo(userInfo);

            logger.info(`✅ 用户信息获取成功 (${successMethod}):`, result.nickname, {
                uid: result.uid,
                followingCount: result.followingCount,
                favoritingCount: result.favoritingCount,
                collectCount: result.collectCount
            });

            return result;
        } else {
            // ❌ 所有方法都失败了，输出详细错误信息
            logger.error('❌ 所有方法均未获取到用户信息');
            logger.error('=== 各方法失败原因 ===');
            errors.forEach((err, index) => {
                logger.error(`  ${index + 1}. ${err.method}: ${err.error}`);
            });
            logger.error('=====================');
            logger.error('💡 提示：请确保已登录抖音，并检查页面结构是否变化');
            return null;
        }
    } catch (error) {
        logger.error('获取用户信息时发生未预期的错误:', error);
        return null;
    }
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
