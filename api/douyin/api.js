// ==========================================
// FavGallery - 抖音 API 实现
// 职责：实现抖音平台的所有 API 方法
// ==========================================

// ==========================================
// 目录导航
// ==========================================
// 1. 构造函数和清理 (L28-44)
// 2. 内部辅助方法 (L46-148)
//    - _ensureWebId()
//    - _buildRequestHeaders()
//    - _handleAPIResponse()
//    - _requestWithRetry()
// 3. 用户相关方法 (L150-236)
//    - getCurrentUser()
//    - _fetchUserInfoFromAPI()
// 4. 列表获取方法 (L238-480)
//    - getFollowingList()
//    - getLikedWorks()
//    - getBookmarkedWorks()
// 5. 作者作品方法 (L482-590)
//    - getAuthorWorksForList()
//    - getAuthorWorksForDownload()
// 6. 收藏夹方法 (L592-720)
//    - getCollects()
//    - getCollectWorksPage()
//    - getCollectWorksIncremental()
// 7. 作品详情方法 (L722-786)
//    - getWorkDetail()
// ==========================================

import { CONFIG } from '../../config/constants.js';
import { DOUYIN_CONFIG } from './config.js';
import {
    getDouyinDeviceParams,
    getAuthorWorkDeviceParams,
    getUserInfoFromPage,
    validateUserInfo,
    getDouyinMediaUrl,
    getDouyinWebId
} from './helpers.js';
import {
    normalizeVideoData,
    normalizeAuthorData,
    delay
} from '../../utils/platform-helpers.js';
import { smartIncrementalFetch } from '../../utils/helpers.js';
import { createLogger } from '../../utils/logger.js';

const logger = createLogger('DouyinAPI');

/**
 * 抖音 API 类
 * 实现抖音平台的所有 API 方法
 */
export class DouyinAPI {
    constructor() {
        /** 缓存的 WebID */
        this.webId = null;

        /** 缓存的用户信息 */
        this.userInfo = null;
    }

    /**
     * 清理平台状态（供 adapter 调用）
     * 切换平台或重新登录时调用
     */
    cleanup() {
        this.webId = null;
        this.userInfo = null;
        logger.info('状态已清理');
    }

    /**
     * 判断当前页面是否为主页
     *
     * @returns {boolean} 是否为主页
     */
    isHomePage() {
        const currentUrl = window.location.href;
        return DOUYIN_CONFIG.HOME_PAGE_PATTERNS.some(pattern => currentUrl.includes(pattern));
    }

    // ==========================================
    // 内部辅助方法
    // ==========================================

    /**
     * 确保 WebID 已获取
     * 如果未获取，则从 helpers 中获取并缓存
     *
     * @returns {string|null} WebID
     * @private
     */
    async _ensureWebId() {
        if (!this.webId) {
            this.webId = getDouyinWebId();
            if (this.webId) {
                logger.info('✅ WebID 已获取:', this.webId);
            } else {
                logger.warn('⚠️ 未能获取 WebID');
            }
        }
        return this.webId;
    }

    /**
     * 构建通用请求头
     *
     * @param {Object} customHeaders - 自定义请求头
     * @returns {Object} 完整的请求头对象
     * @private
     */
    _buildRequestHeaders(customHeaders = {}) {
        return {
            ...DOUYIN_CONFIG.DEFAULT_HEADERS,
            ...customHeaders
        };
    }

    /**
     * 处理 API 响应
     * 检查状态码并抛出有意义的错误
     *
     * @param {Response} response - fetch 响应对象
     * @returns {Promise<Object>} 解析后的 JSON 数据
     * @throws {Error} 如果 HTTP 请求失败或 API 返回错误
     * @private
     */
    async _handleAPIResponse(response) {
        // 检查 HTTP 状态
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        // 解析 JSON
        const data = await response.json();

        // 检查 API 状态码
        if (data.status_code !== 0) {
            const errorMsg = data.status_msg || `错误码: ${data.status_code}`;

            // 特殊处理常见错误
            if (data.status_msg === '用户未登录') {
                throw new Error('用户未登录，请先在抖音网页版登录');
            }

            throw new Error(`API 错误: ${errorMsg}`);
        }

        return data;
    }

    /**
     * 带重试的请求包装器
     * 自动处理网络错误和重试逻辑
     *
     * @param {Function} requestFn - 请求函数（返回 Promise）
     * @param {number} maxRetries - 最大重试次数
     * @returns {Promise<any>} 请求结果
     * @throws {Error} 如果达到最大重试次数仍然失败
     * @private
     */
    async _requestWithRetry(requestFn, maxRetries = 3) {
        let lastError = null;

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                return await requestFn();
            } catch (error) {
                lastError = error;
                logger.warn(`⚠️ 请求失败 (第${attempt}/${maxRetries}次):`, error.message);

                // 如果不是最后一次尝试，等待后重试
                if (attempt < maxRetries) {
                    const retryDelay = DOUYIN_CONFIG.RETRY_CONFIG.baseDelay *
                        Math.pow(DOUYIN_CONFIG.RETRY_CONFIG.backoffMultiplier, attempt - 1);
                    logger.info(`🔄 ${retryDelay}ms 后重试...`);
                    await delay(retryDelay);
                }
            }
        }

        // 所有重试都失败了
        throw new Error(`请求失败，已重试 ${maxRetries} 次: ${lastError.message}`);
    }

    // ==========================================
    // 用户相关方法
    // ==========================================

    /**
     * 获取当前用户信息
     * 优先从缓存获取，其次从页面获取，最后从 API 获取
     *
     * @returns {Promise<Object|null>} 用户信息对象，如果未登录则返回 null
     *
     * @example
     * const user = await douyinAPI.getCurrentUser();
     * console.log(user.nickname);
     */
    async getCurrentUser() {
        // 1. 检查缓存
        if (this.userInfo) {
            return this.userInfo;
        }

        // 2. 从页面获取（唯一方式）
        let userInfo = getUserInfoFromPage();

        // 3. 验证并缓存
        if (userInfo && validateUserInfo(userInfo)) {
            this.userInfo = userInfo;
            logger.info('✅ 用户信息获取成功:', userInfo.nickname);
            return userInfo;
        } else {
            logger.warn('❌ 未获取到有效的用户信息（可能未登录）');
            return null;
        }
    }

    /**
     * 从 API 获取用户信息
     * 当页面中没有用户信息时使用（备用方案）
     *
     * @returns {Promise<Object|null>} 用户信息对象
     * @private
     */
    async _fetchUserInfoFromAPI() {
        try {
            // 确保 WebID 已获取
            await this._ensureWebId();

            // 构建设备参数
            const deviceParams = getDouyinDeviceParams();

            // 构建请求参数
            const params = new URLSearchParams({
                ...deviceParams,
                publish_video_strategy_type: '2',
                source: 'channel_pc_web'
            });

            const url = `${DOUYIN_CONFIG.API_ENDPOINTS.USER_PROFILE}?${params}`;

            // 发送请求（带重试）
            const data = await this._requestWithRetry(async () => {
                const response = await fetch(url, {
                    credentials: 'include',
                    headers: this._buildRequestHeaders()
                });
                return this._handleAPIResponse(response);
            });

            // 提取用户信息
            if (!data.user || !data.user.uid) {
                logger.warn('API 返回的用户信息不完整');
                return null;
            }

            // 标准化用户信息
            return normalizeAuthorData(data.user);

        } catch (error) {
            logger.error('从 API 获取用户信息失败:', error);
            return null;
        }
    }

    // ==========================================
    // 列表获取方法
    // ==========================================

    /**
     * 获取关注列表
     * 使用智能增量获取，避免重复数据
     *
     * @param {number} maxCount - 最大获取数量
     * @param {Function} onProgress - 进度回调 (current, total) => void
     * @param {Array} cachedUids - 缓存的 UID 列表（用于去重）
     * @param {Object} metadata - 元数据（包含 isFullyLoaded 标记）
     * @returns {Promise<Array>} 关注列表（标准化后的作者数据）
     *
     * @example
     * const followingList = await douyinAPI.getFollowingList(
     *     100,
     *     (current, total) => console.log(`进度: ${current}/${total}`),
     *     existingUids,
     *     { isFullyLoaded: true }
     * );
     */
    async getFollowingList(maxCount = CONFIG.FETCH_CONFIG.LIST_DEFAULTS.FOLLOWING, onProgress = null, cachedUids = null, metadata = null) {  // ✅ 新增：metadata 参数
        logger.info(`👥 [关注列表] 开始获取，目标数量: ${maxCount}`);
        
        // 确保已获取用户信息
        await this.getCurrentUser();

        if (!this.userInfo || !this.userInfo.uid) {
            throw new Error('未获取到用户信息，无法获取关注列表');
        }

        const cachedIds = cachedUids ? new Set(cachedUids) : null;
        logger.debug(`📋 [关注列表] 缓存 ID 数量: ${cachedIds?.size || 0}`);

        // 定义批量获取函数
        let maxCursor = 0;
        
        const fetchBatch = async (cursor) => {
            maxCursor = cursor || 0;
            
            logger.debug(`🌐 [关注列表] 发起 API 请求，cursor: ${maxCursor}`);
            
            const params = new URLSearchParams({
                ...getDouyinDeviceParams(),
                user_id: this.userInfo.uid,
                sec_user_id: this.userInfo.platformId || '',
                offset: '0',
                count: '20',
                source_type: '1',
                gps_access: '0',
                address_book_access: '0',
                is_top: '1',
                max_time: maxCursor.toString()
            });

            const url = `${DOUYIN_CONFIG.API_ENDPOINTS.FOLLOWING_LIST}?${params}`;
            logger.debug(`📤 [关注列表] 请求 URL: ${url.substring(0, 150)}...`);

            // 发送请求（带重试）
            const data = await this._requestWithRetry(async () => {
                const response = await fetch(url, {
                    credentials: 'include',
                    headers: this._buildRequestHeaders()
                });
                return this._handleAPIResponse(response);
            });

            logger.debug(`📥 [关注列表] API 响应接收: ${(data.followings || []).length} 条数据`);

            // 更新游标（使用 min_time，参考旧项目实现）
            if (data.min_time !== undefined && data.min_time !== null) {
                maxCursor = data.min_time;
            }

            // 标准化用户数据
            const users = (data.followings || []).map(user => {
                return normalizeAuthorData(user);
            });

            // ✅ 返回符合 smartIncrementalFetch 期望的格式
            return {
                data: users,
                hasMore: data.has_more === 1 || data.has_more === true,
                cursor: maxCursor
            };
        };

        // 使用通用智能增量获取函数
        try {
            const users = await smartIncrementalFetch(
                fetchBatch,
                cachedIds,
                'uid',
                maxCount,
                onProgress,
                {
                    delayMs: DOUYIN_CONFIG.REQUEST_DELAY.normal,
                    isFullyLoaded: metadata?.isFullyLoaded || false  // ✅ 新增：传递完整加载标记
                }
            );

            logger.info(`[关注列表] 获取 ${users.length} 个作者`);

            // ✅ 统一返回格式：使用 authors 字段（跨平台通用）
            return { 
                authors: users,  // ✅ 统一使用 authors 字段
                hasMore: true, 
                cursor: maxCursor, 
                requestedCount: maxCount 
            };

        } catch (error) {
            logger.error('获取关注列表失败:', error);
            throw error;
        }
    }

    /**
     * 获取点赞作品列表
     * 使用智能增量获取，避免重复数据
     *
     * @param {number} maxCount - 最大获取数量
     * @param {Function} onProgress - 进度回调 (current, total) => void
     * @param {Array} cachedWorkIds - 缓存的作品 ID 列表（用于去重）
     * @param {Object} metadata - 元数据（包含 isFullyLoaded 标记）
     * @returns {Promise<Object>} 包含作品列表和状态的对象
     *
     * @example
     * const result = await douyinAPI.getLikedWorks(
     *     100,
     *     (current, total) => console.log(`进度: ${current}/${total}`),
     *     existingWorkIds,
     *     { isFullyLoaded: true }
     * );
     */
    async getLikedWorks(maxCount = CONFIG.FETCH_CONFIG.LIST_DEFAULTS.LIKED, onProgress = null, cachedWorkIds = null, metadata = null) {  // ✅ 新增：metadata 参数
        logger.info(`❤️ [点赞列表] 开始获取，目标数量: ${maxCount}`);
        
        // 确保已获取用户信息
        await this.getCurrentUser();

        if (!this.userInfo || !this.userInfo.uid) {
            throw new Error('未获取到用户信息，无法获取点赞列表');
        }

        const cachedIds = cachedWorkIds ? new Set(cachedWorkIds) : null;  // ✅ 改为 cachedWorkIds
        logger.debug(`📋 [点赞列表] 缓存 ID 数量: ${cachedIds?.size || 0}`);

        // 定义批量获取函数
        let maxCursor = 0;
        
        const fetchBatch = async (cursor) => {
            maxCursor = cursor || 0;
            
            logger.debug(`🌐 [点赞列表] 发起 API 请求，cursor: ${maxCursor}`);
            
            const params = new URLSearchParams({
                ...getDouyinDeviceParams(),
                user_id: this.userInfo.uid,
                sec_user_id: this.userInfo.platformId || '',
                count: '20',
                max_cursor: maxCursor.toString(),
                aid: '6383'
            });

            const url = `${DOUYIN_CONFIG.API_ENDPOINTS.LIKED_WORKS}?${params}`;
            logger.debug(`📤 [点赞列表] 请求 URL: ${url.substring(0, 150)}...`);

            // 发送请求（带重试）
            const data = await this._requestWithRetry(async () => {
                const response = await fetch(url, {
                    credentials: 'include',
                    headers: this._buildRequestHeaders()
                });
                return this._handleAPIResponse(response);
            });

            logger.debug(`📥 [点赞列表] API 响应接收: ${(data.aweme_list || []).length} 条数据`);

            // 更新游标（时间戳，用于获取更旧的作品）
            // max_cursor 是这批作品中最旧的时间戳
            // 下次请求传入此值，API 会返回比这个时间更早的作品
            if (data.max_cursor !== undefined && data.max_cursor !== null) {
                maxCursor = data.max_cursor;
            }

            // 标准化作品数据
            const works = (data.aweme_list || []).map(work => {  // ✅ 变量名改为 work
                return normalizeVideoData(work, {
                    getUrlQualitySelector: (urls) => getDouyinMediaUrl({ play_addr: { url_list: urls } })  // ✅ 改为 getDouyinMediaUrl
                });
            });

            // ✅ 返回符合 smartIncrementalFetch 期望的格式
            return {
                data: works,  // ✅ 改为 works
                hasMore: data.has_more === 1 || data.has_more === true,
                cursor: maxCursor
            };
        };

        // 使用通用智能增量获取函数
        try {
            const works = await smartIncrementalFetch(  // ✅ 改为 works
                fetchBatch,
                cachedIds,
                'workId',
                maxCount,
                onProgress,
                {
                    delayMs: DOUYIN_CONFIG.REQUEST_DELAY.normal,
                    isFullyLoaded: metadata?.isFullyLoaded || false  // ✅ 使用传入的 metadata
                }
            );

            logger.info(`[点赞列表] 获取 ${works.length} 个作品`);  // ✅ 改为 works

            return { works, hasMore: true, cursor: maxCursor, requestedCount: maxCount };  // ✅ 添加 requestedCount

        } catch (error) {
            logger.error('获取点赞列表失败:', error);
            throw error;
        }
    }

    /**
     * 获取收藏作品列表
     * 使用智能增量获取，避免重复数据
     *
     * @param {number} maxCount - 最大获取数量
     * @param {Function} onProgress - 进度回调 (current, total) => void
     * @param {Array} cachedWorkIds - 缓存的作品 ID 列表（用于去重）
     * @param {Object} metadata - 元数据（包含 isFullyLoaded 标记）
     * @returns {Promise<Object>} 包含作品列表和状态的对象
     *
     * @example
     * const result = await douyinAPI.getBookmarkedWorks(
     *     100,
     *     (current, total) => console.log(`进度: ${current}/${total}`),
     *     existingWorkIds,
     *     { isFullyLoaded: true }
     * );
     */
    async getBookmarkedWorks(maxCount = CONFIG.FETCH_CONFIG.LIST_DEFAULTS.BOOKMARKED, onProgress = null, cachedWorkIds = null, metadata = null) {  // ✅ 新增：metadata 参数
        logger.info(`⭐ [收藏列表] 开始获取，目标数量: ${maxCount}`);
        
        // 确保已获取用户信息
        await this.getCurrentUser();

        if (!this.userInfo || !this.userInfo.uid) {
            throw new Error('未获取到用户信息，无法获取收藏列表');
        }

        const cachedIds = cachedWorkIds ? new Set(cachedWorkIds) : null;  // ✅ 改为 cachedWorkIds
        logger.debug(`📋 [收藏列表] 缓存 ID 数量: ${cachedIds?.size || 0}`);

        // 定义批量获取函数
        let maxCursor = 0;
        
        const fetchBatch = async (cursor) => {
            maxCursor = cursor || 0;
            
            logger.debug(`🌐 [收藏列表] 发起 API 请求，cursor: ${maxCursor}`);
            
            const params = new URLSearchParams({
                ...getDouyinDeviceParams(),
                user_id: this.userInfo.uid,
                sec_user_id: this.userInfo.platformId || '',
                count: '20',
                max_cursor: maxCursor.toString()
            });

            const url = `${DOUYIN_CONFIG.API_ENDPOINTS.BOOKMARKED_WORKS}?${params}`;
            logger.debug(`📤 [收藏列表] 请求 URL: ${url.substring(0, 150)}...`);

            // 发送请求（带重试）
            const data = await this._requestWithRetry(async () => {
                const response = await fetch(url, {
                    credentials: 'include',
                    headers: this._buildRequestHeaders()
                });
                return this._handleAPIResponse(response);
            });

            logger.debug(`📥 [收藏列表] API 响应接收: ${(data.aweme_list || []).length} 条数据`);

            // 更新游标（时间戳，用于获取更旧的作品）
            // max_cursor 是这批作品中最旧的时间戳
            // 下次请求传入此值，API 会返回比这个时间更早的作品
            if (data.max_cursor !== undefined && data.max_cursor !== null) {
                maxCursor = data.max_cursor;
            }

            // 标准化作品数据
            const works = (data.aweme_list || []).map(work => {  // ✅ 变量名改为 work
                return normalizeVideoData(work, {
                    getUrlQualitySelector: (urls) => getDouyinMediaUrl({ play_addr: { url_list: urls } })  // ✅ 改为 getDouyinMediaUrl
                });
            });

            // ✅ 返回符合 smartIncrementalFetch 期望的格式
            return {
                data: works,  // ✅ 改为 works
                hasMore: data.has_more === 1 || data.has_more === true,
                cursor: maxCursor
            };
        };

        // 使用通用智能增量获取函数
        try {
            const works = await smartIncrementalFetch(  // ✅ 改为 works
                fetchBatch,
                cachedIds,
                'workId',
                maxCount,
                onProgress,
                {
                    delayMs: DOUYIN_CONFIG.REQUEST_DELAY.normal,
                    isFullyLoaded: metadata?.isFullyLoaded || false  // ✅ 新增：传递完整加载标记
                }
            );

            logger.info(`[收藏列表] 获取 ${works.length} 个作品`);

            return {
                works,  // ✅ 改为 works
                hasMore: true,
                cursor: maxCursor,
                requestedCount: maxCount  // ✅ 新增：添加 requestedCount
            };
        } catch (error) {
            logger.error('❌ [收藏列表] 获取失败:', error);
            throw error;
        }
    }

    // ==========================================
    // 作者作品方法
    // ==========================================

    /**
     * 获取指定作者的作品列表（用于 UI 列表显示）
     * 支持进度回调，适合前端展示
     *
     * @param {string} platformId - 作者的 platformId
     * @param {number} maxCount - 最大获取数量
     * @param {Function} onProgress - 进度回调 (current, total) => void
     * @returns {Promise<Array>} 作品列表（标准化后的视频数据）
     *
     * @example
     * const videos = await douyinAPI.getAuthorWorksForList(
     *     'MS4wLjABAAAA...',
     *     50,
     *     (current, total) => console.log(`进度: ${current}/${total}`)
     * );
     */
    async getAuthorWorksForList(platformId, maxCount = CONFIG.FETCH_CONFIG.LIST_DEFAULTS.AUTHOR_WORKS, onProgress = null) {
        // 参数验证
        if (!platformId) {
            throw new Error('缺少 platformId 参数');
        }

        let cursor = 0;
        let allVideos = [];
        let hasMore = true;
        let retryCount = 0;
        const maxRetries = DOUYIN_CONFIG.RETRY_CONFIG.maxRetries;

        while (hasMore && allVideos.length < maxCount) {
            // 检查是否已达到目标数量
            if (allVideos.length >= maxCount) {
                break;
            }

            try {
                // 构建请求参数（使用作者作品专用的设备参数）
                const params = new URLSearchParams({
                    sec_user_id: platformId,
                    count: '18',
                    max_cursor: cursor.toString(),
                    ...getAuthorWorkDeviceParams()  // ✅ 改为 getAuthorWorkDeviceParams
                });

                const url = `${DOUYIN_CONFIG.API_ENDPOINTS.AUTHOR_WORKS}?${params}`;

                // 发送请求
                const response = await fetch(url, {
                    method: 'GET',
                    credentials: 'include',
                    headers: this._buildRequestHeaders()
                });

                const data = await this._handleAPIResponse(response);

                // 判断是否有更多数据
                hasMore = data.has_more === 1 || data.has_more === true;
                cursor = data.max_cursor || 0;

                // 标准化视频数据
                const videos = (data.aweme_list || []).map(video => {
                    return normalizeVideoData(video, {
                        getUrlQualitySelector: (urls) => getDouyinMediaUrl({ play_addr: { url_list: urls } })  // ✅ 改为 getDouyinMediaUrl
                    });
                });

                allVideos.push(...videos);
                retryCount = 0;

                // 调用进度回调
                if (onProgress) {
                    onProgress(allVideos.length, maxCount);
                }

                logger.info(`📊 已获取 ${allVideos.length} 个作品...`);

                // 如果还有更多且未达到上限，继续获取
                if (!hasMore || allVideos.length >= maxCount) {
                    break;
                }

                // 添加延迟防封号
                await delay(DOUYIN_CONFIG.REQUEST_DELAY.normal);

            } catch (error) {
                retryCount++;
                logger.error(`❌ 获取作者作品失败 (第${retryCount}次):`, error.message);

                if (retryCount >= maxRetries) {
                    logger.warn('⚠️ 达到最大重试次数，停止获取');
                    break;
                }

                const retryDelay = DOUYIN_CONFIG.RETRY_CONFIG.baseDelay * 
                                 Math.pow(DOUYIN_CONFIG.RETRY_CONFIG.backoffMultiplier, retryCount);
                await delay(retryDelay);
            }
        }

        // 返回截断到 maxCount 的结果
        return allVideos.slice(0, maxCount);
    }

    /**
     * 获取指定作者的所有作品（用于批量下载）
     * 自动处理所有分页，返回完整作品列表
     *
     * @param {string} platformId - 作者的 platformId
     * @param {number} maxCount - 最大获取数量（默认从配置读取）
     * @returns {Promise<Array>} 完整的作品列表
     */
    async getAuthorWorksForDownload(platformId, maxCount = CONFIG.FETCH_CONFIG.BATCH_MAX_COUNT) {
        const allVideos = [];
        let cursor = 0;
        let hasMore = true;
        let retryCount = 0;
        const maxRetries = DOUYIN_CONFIG.RETRY_CONFIG.maxRetries;

        while (hasMore && allVideos.length < maxCount) {
            if (allVideos.length >= maxCount) break;

            try {
                const params = new URLSearchParams({
                    sec_user_id: platformId,
                    count: '18',
                    max_cursor: cursor.toString(),
                    ...getAuthorWorkDeviceParams()  // ✅ 改为 getAuthorWorkDeviceParams
                });

                const url = `${DOUYIN_CONFIG.API_ENDPOINTS.AUTHOR_WORKS}?${params}`;

                const response = await fetch(url, {
                    method: 'GET',
                    credentials: 'include',
                    headers: this._buildRequestHeaders()
                });

                const data = await this._handleAPIResponse(response);

                hasMore = data.has_more === 1 || data.has_more === true;
                cursor = data.max_cursor || 0;

                const videos = (data.aweme_list || []).map(video => {
                    return normalizeVideoData(video, {
                        getUrlQualitySelector: (urls) => getDouyinMediaUrl({ play_addr: { url_list: urls } })  // ✅ 改为 getDouyinMediaUrl
                    });
                });

                allVideos.push(...videos);
                retryCount = 0;

                logger.info(`📊 已获取 ${allVideos.length} 个作品...`);

                if (!hasMore || allVideos.length >= maxCount) break;

                await delay(DOUYIN_CONFIG.REQUEST_DELAY.normal);

            } catch (error) {
                retryCount++;
                logger.error(`❌ 获取作者作品失败 (第${retryCount}次):`, error.message);

                if (retryCount >= maxRetries) {
                    logger.warn('⚠️ 达到最大重试次数，停止获取');
                    break;
                }

                const retryDelay = DOUYIN_CONFIG.RETRY_CONFIG.baseDelay * 
                                 Math.pow(DOUYIN_CONFIG.RETRY_CONFIG.backoffMultiplier, retryCount);
                await delay(retryDelay);
            }
        }

        return allVideos.slice(0, maxCount);
    }

    // ==========================================
    // 收藏夹方法
    // ==========================================

    /**
     * 获取收藏夹列表
     * 获取当前用户的所有收藏夹
     *
     * @param {number} cursor - 分页游标（首次请求传 0）
     * @param {number} count - 每页数量
     * @returns {Promise<Object>} 包含收藏夹列表和分页信息的对象
     *
     * @example
     * const result = await douyinAPI.getCollects(0, 20);
     * console.log(result.collects); // 收藏夹数组
     * console.log(result.hasMore);  // 是否有更多
     */
    async getCollects(cursor = 0, count = 20) {
        logger.info(`📁 [收藏夹列表] 开始获取，cursor: ${cursor}, count: ${count}`);
        
        // 确保已获取用户信息
        await this.getCurrentUser();

        if (!this.userInfo || !this.userInfo.uid) {
            throw new Error('未获取到用户信息，无法获取收藏夹列表');
        }

        try {
            // 构建请求参数
            logger.debug(`🌐 [收藏夹列表] 发起 API 请求`);
            
            const params = new URLSearchParams({
                ...getDouyinDeviceParams(),
                user_id: this.userInfo.uid,
                sec_user_id: this.userInfo.platformId || '',
                cursor: cursor.toString(),
                count: count.toString()
            });

            const url = `${DOUYIN_CONFIG.API_ENDPOINTS.COLLECTS_LIST}?${params}`;
            logger.debug(`📤 [收藏夹列表] 请求 URL: ${url.substring(0, 150)}...`);

            // 发送请求（带重试）
            const data = await this._requestWithRetry(async () => {
                const response = await fetch(url, {
                    credentials: 'include',
                    headers: this._buildRequestHeaders()
                });
                return this._handleAPIResponse(response);
            });

            logger.debug(`📥 [收藏夹列表] API 响应接收: ${(data.collects_list || []).length} 条数据`);

            // 提取收藏夹列表（只保留文档定义的字段）
            const collects = (data.collects_list || []).map(collect => {
                return {
                    collectId: collect.collects_id_str || String(collect.collects_id) || '',
                    collectName: collect.collects_name || '未命名收藏夹',
                    workCount: collect.total_number || 0,
                    isDeleted: false,  // 默认未删除
                    sortOrder: 0       // 默认排序
                };
            });

            logger.info(`✅ [收藏夹列表] 获取 ${collects.length} 个收藏夹`);

            return {
                collects,
                hasMore: data.has_more === 1 || data.has_more === true,
                cursor: data.cursor || 0,
                total: data.total || collects.length
            };

        } catch (error) {
            logger.error('❌ [收藏夹列表] 获取失败:', error);
            throw error;
        }
    }

    /**
     * 获取指定收藏夹的作品列表（分页，用于 UI 显示）
     * 手动控制分页，适合懒加载场景
     *
     * @param {string} collectId - 收藏夹 ID
     * @param {number} cursor - 分页游标（首次请求传 0）
     * @param {number} count - 每页数量
     * @returns {Promise<Object>} 包含作品列表和分页信息的对象
     *
     * @example
     * const result = await douyinAPI.getCollectWorksPage('collectId_here', 0, 20);
     * console.log(result.works); // 作品数组
     * console.log(result.hasMore); // 是否有更多
     */
    async getCollectWorksPage(collectId, cursor = 0, count = 20) {
        // 参数验证
        if (!collectId) {
            throw new Error('缺少 collectId 参数');
        }

        try {
            // 构建请求参数
            const params = new URLSearchParams({
                ...getDouyinDeviceParams(),
                collects_id: collectId,
                cursor: cursor.toString(),
                count: count.toString()
            });

            const url = `${DOUYIN_CONFIG.API_ENDPOINTS.COLLECTS_WORKS}?${params}`;

            // 发送请求（带重试）
            const data = await this._requestWithRetry(async () => {
                const response = await fetch(url, {
                    credentials: 'include',
                    headers: this._buildRequestHeaders()
                });
                return this._handleAPIResponse(response);
            });

            // 标准化作品数据
            const works = (data.aweme_list || []).map(work => {
                return normalizeVideoData(work, {
                    getUrlQualitySelector: (urls) => getDouyinMediaUrl({ play_addr: { url_list: urls } })
                });
            });

            return {
                works,
                hasMore: data.has_more === 1 || data.has_more === true,
                cursor: data.cursor || 0,
                total: data.total || works.length
            };

        } catch (error) {
            console.error('[DouyinAPI] 获取收藏夹作品失败:', error);
            throw error;
        }
    }

    /**
     * ✅ 增量获取收藏夹作品（支持缓存合并）
     * @param {string} collectId - 收藏夹ID
     * @param {number} maxCount - 最大获取数量
     * @param {Function} onProgress - 进度回调
     * @param {Set} cachedWorkIds - 缓存的作品ID集合
     * @param {Object} metadata - 元数据
     * @returns {Promise<Object>} { works, hasMore, cursor }
     */
    async getCollectWorksIncremental(collectId, maxCount = CONFIG.FETCH_CONFIG.LIST_DEFAULTS.BOOKMARKED, onProgress = null, cachedWorkIds = null, metadata = null) {
        const cachedIds = cachedWorkIds ? new Set(cachedWorkIds) : null;
        
        // 定义批量获取函数
        let cursor = 0;
        
        const fetchBatch = async (currentCursor) => {
            cursor = currentCursor || 0;
            
            try {
                const params = new URLSearchParams({
                    ...getDouyinDeviceParams(),
                    collects_id: collectId,
                    cursor: cursor.toString(),
                    count: '20'
                });
                
                const url = `${DOUYIN_CONFIG.API_ENDPOINTS.COLLECTS_WORKS}?${params}`;
                
                const response = await fetch(url, {
                    credentials: 'include',
                    headers: this._buildRequestHeaders()
                });
                
                const data = await this._handleAPIResponse(response);
                
                const hasMore = data.has_more === 1 || data.has_more === true;
                cursor = data.cursor || 0;
                
                const works = (data.aweme_list || []).map(work => {
                    return normalizeVideoData(work, {
                        getUrlQualitySelector: (urls) => getDouyinMediaUrl({ play_addr: { url_list: urls } })
                    });
                });
                
                return {
                    data: works,
                    hasMore,
                    cursor
                };
                
            } catch (error) {
                logger.error(`❌ 获取收藏夹作品失败:`, error.message);
                return {
                    data: [],
                    hasMore: false,
                    cursor
                };
            }
        };
        
        // 使用通用智能增量获取函数
        try {
            const works = await smartIncrementalFetch(
                fetchBatch,
                cachedIds,
                'workId',
                maxCount,
                onProgress,
                {
                    delayMs: DOUYIN_CONFIG.REQUEST_DELAY.normal,
                    isFullyLoaded: metadata?.isFullyLoaded || false
                }
            );
            
            logger.info(`[收藏夹] 获取 ${works.length} 个作品`);
            
            return { works, hasMore: true, cursor };
            
        } catch (error) {
            logger.error('获取收藏夹作品失败:', error);
            throw error;
        }
    }

    // ==========================================
    // 作品详情方法
    // ==========================================

    /**
     * 获取单个作品详情
     *
     * @param {string} workId - 作品 ID
     * @returns {Promise<Object>} 作品详情
     */
    async getWorkDetail(workId) {
        // 参数验证
        if (!workId) {
            throw new Error('缺少 workId 参数');
        }

        try {
            const params = new URLSearchParams({
                ...getDouyinDeviceParams(),
                aweme_id: workId  // ✅ API 参数名保持不变（抖音 API 要求）
            });

            const url = `${DOUYIN_CONFIG.API_ENDPOINTS.VIDEO_DETAIL}?${params}`;

            // 发送请求（带重试）
            const data = await this._requestWithRetry(async () => {
                const response = await fetch(url, {
                    credentials: 'include',
                    headers: this._buildRequestHeaders()
                });
                return this._handleAPIResponse(response);
            });

            // 检查是否有作品数据
            if (!data.aweme_detail) {
                throw new Error('作品不存在或已被删除');
            }

            // 标准化作品数据
            const work = normalizeVideoData(data.aweme_detail, {
                getUrlQualitySelector: (urls) => getDouyinMediaUrl({ play_addr: { url_list: urls } })
            });

            // 添加额外的详情信息
            work.video.pageUrl = data.aweme_detail?.share_url || '';
            work.region = data.aweme_detail?.region || '';
            work.textExtra = data.aweme_detail?.text_extra || [];
            work.challengeList = data.aweme_detail?.cha_list || [];

            return work;

        } catch (error) {
            console.error('[DouyinAPI] 获取作品详情失败:', error);
            throw error;
        }
    }
}


