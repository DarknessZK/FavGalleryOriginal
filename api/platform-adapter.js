// ==========================================
// FavGallery - 平台适配器
// 职责：提供统一的 API 接口，支持运行时平台切换
// ==========================================

import { CONFIG } from '../config/constants.js';
import { DouyinAPI } from './douyin/api.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('PlatformAdapter');

/**
 * 平台适配器类
 * 提供统一的 API 接口，屏蔽不同平台的差异
 */
class PlatformAdapter {
    constructor() {
        /** 当前激活的平台 */
        this.currentPlatform = CONFIG.ACTIVE_PLATFORM;

        /** 当前平台的 API 实例 */
        this.api = this.createAPI(this.currentPlatform);

        logger.info(`初始化完成，当前平台: ${this.currentPlatform}`);
    }

    /**
     * 创建指定平台的 API 实例
     *
     * @param {string} platform - 平台名称
     * @returns {Object} 平台 API 实例
     * @throws {Error} 如果平台不受支持
     * @private
     */
    createAPI(platform) {
        switch(platform) {
            case 'douyin':
                return new DouyinAPI();

            // 未来扩展示例：
            // case 'xiaohongshu':
            //     return new XiaohongshuAPI();

            default:
                throw new Error(
                    `不支持的平台: ${platform}。支持的平台: ${CONFIG.SUPPORTED_PLATFORMS.join(', ')}`
                );
        }
    }

    /**
     * 运行时切换平台
     *
     * @param {string} platform - 目标平台名称
     * @throws {Error} 如果平台不受支持
     *
     * @example
     * platformAPI.switchPlatform('xiaohongshu');
     */
    switchPlatform(platform) {
        // 验证平台是否支持
        if (!CONFIG.SUPPORTED_PLATFORMS.includes(platform)) {
            throw new Error(
                `不支持的平台: ${platform}。支持的平台: ${CONFIG.SUPPORTED_PLATFORMS.join(', ')}`
            );
        }

        // 如果已经是当前平台，无需切换
        if (this.currentPlatform === platform) {
            logger.info('已是当前平台，无需切换');
            return;
        }

        logger.info(`切换平台: ${this.currentPlatform} -> ${platform}`);

        // 保存旧平台
        const oldPlatform = this.currentPlatform;

        // 清理旧平台状态（如果 API 提供了 cleanup 方法）
        if (typeof this.api.cleanup === 'function') {
            this.api.cleanup();
        }

        // 创建新平台的 API 实例
        this.currentPlatform = platform;
        this.api = this.createAPI(platform);

        // 触发自定义事件，通知 UI 更新
        window.dispatchEvent(new CustomEvent('platformChanged', {
            detail: {
                oldPlatform,
                newPlatform: platform
            }
        }));

        logger.info(`平台切换成功: ${platform}`);
    }

    /**
     * 获取当前平台
     *
     * @returns {string} 当前平台名称
     */
    getCurrentPlatform() {
        return this.currentPlatform;
    }

    /**
     * 获取当前平台的 API 实例
     *
     * @returns {Object} 当前平台的 API 实例
     */
    getCurrentAPI() {
        return this.api;
    }

    /**
     * 判断当前页面是否为主页（平台特定）
     *
     * @returns {boolean} 是否为主页
     */
    isHomePage() {
        if (!this.api.isHomePage) {
            // 如果平台未实现此方法，默认返回 false
            return false;
        }
        return this.api.isHomePage();
    }

    /**
     * 获取所有支持的平台列表
     *
     * @returns {Array<string>} 支持的平台名称数组
     */
    getSupportedPlatforms() {
        return [...CONFIG.SUPPORTED_PLATFORMS];
    }

    // ==========================================
    // 用户相关方法
    // ==========================================

    /**
     * 获取当前用户信息
     *
     * @returns {Promise<Object>} 用户信息对象
     */
    async getCurrentUser() {
        if (!this.api.getCurrentUser) {
            throw new Error(`当前平台 (${this.currentPlatform}) 不支持获取用户信息`);
        }
        return this.api.getCurrentUser();
    }

    // ==========================================
    // 列表获取方法
    // ==========================================

    /**
     * 获取关注列表
     *
     * @param {number} maxCount - 最大获取数量
     * @param {Function} onProgress - 进度回调
     * @param {Array} cachedUids - 缓存的 UID 列表
     * @param {Object} metadata - 元数据（包含 isFullyLoaded 标记）
     * @returns {Promise<Array>} 关注列表
     */
    async getFollowingList(maxCount = CONFIG.FETCH_CONFIG.LIST_CONFIGS.following.maxCount, onProgress = null, cachedUids = null, metadata = null) {  // ✅ 新增：metadata 参数
        if (!this.api.getFollowingList) {
            throw new Error(`当前平台 (${this.currentPlatform}) 不支持获取关注列表`);
        }
        return this.api.getFollowingList(maxCount, onProgress, cachedUids, metadata);  // ✅ 新增：传递 metadata
    }

    /**
     * 获取点赞作品列表
     *
     * @param {number} maxCount - 最大获取数量
     * @param {Function} onProgress - 进度回调
     * @param {Array} cachedWorkIds - 缓存的作品 ID 列表
     * @param {Object} metadata - 元数据（包含 isFullyLoaded 标记）
     * @returns {Promise<Object>} 包含作品列表和状态的对象
     */
    async getLikedWorks(maxCount = CONFIG.FETCH_CONFIG.LIST_CONFIGS.liked.maxCount, onProgress = null, cachedWorkIds = null, metadata = null) {  // ✅ 新增：metadata 参数
        if (!this.api.getLikedWorks) {  // ✅ 改为 getLikedWorks
            throw new Error(`当前平台 (${this.currentPlatform}) 不支持获取点赞列表`);
        }
        return this.api.getLikedWorks(maxCount, onProgress, cachedWorkIds, metadata);  // ✅ 新增：传递 metadata
    }

    /**
     * 获取收藏作品列表
     *
     * @param {number} maxCount - 最大获取数量
     * @param {Function} onProgress - 进度回调
     * @param {Array} cachedWorkIds - 缓存的作品 ID 列表
     * @param {Object} metadata - 元数据（包含 isFullyLoaded 标记）
     * @returns {Promise<Object>} 包含作品列表和状态的对象
     */
    async getBookmarkedWorks(maxCount = CONFIG.FETCH_CONFIG.LIST_CONFIGS.bookmarked.maxCount, onProgress = null, cachedWorkIds = null, metadata = null) {  // ✅ 新增：metadata 参数
        if (!this.api.getBookmarkedWorks) {  // ✅ 改为 getBookmarkedWorks
            throw new Error(`当前平台 (${this.currentPlatform}) 不支持获取收藏列表`);
        }
        return this.api.getBookmarkedWorks(maxCount, onProgress, cachedWorkIds, metadata);  // ✅ 新增：传递 metadata
    }

    /**
     * 获取作者作品列表（用于 UI 显示）
     *
     * @param {string} platformId - 作者的 platformId
     * @param {number} maxCount - 最大获取数量
     * @param {Function} onProgress - 进度回调
     * @returns {Promise<Array>} 作品列表
     */
    async getAuthorWorksForList(platformId, maxCount = CONFIG.FETCH_CONFIG.LIST_CONFIGS.following.maxCount, onProgress = null) {
        if (!this.api.getAuthorWorksForList) {
            throw new Error(`当前平台 (${this.currentPlatform}) 不支持获取作者作品列表`);
        }
        return this.api.getAuthorWorksForList(platformId, maxCount, onProgress);
    }

    /**
     * 获取作者所有作品（用于批量下载）
     *
     * @param {string} platformId - 作者的 platformId
     * @param {number} maxCount - 最大获取数量
     * @returns {Promise<Array>} 完整的作品列表
     */
    async getAuthorWorksForDownload(platformId, maxCount = CONFIG.FETCH_CONFIG.BATCH_MAX_COUNT) {
        if (!this.api.getAuthorWorksForDownload) {
            throw new Error(`当前平台 (${this.currentPlatform}) 不支持获取作者所有作品`);
        }
        return this.api.getAuthorWorksForDownload(platformId, maxCount);
    }

    /**
     * 获取收藏夹列表
     *
     * @param {number} cursor - 分页游标
     * @param {number} count - 每页数量
     * @returns {Promise<Object>} 收藏夹列表数据
     */
    async getCollects(cursor = 0, count = 20) {
        if (!this.api.getCollects) {
            throw new Error(`当前平台 (${this.currentPlatform}) 不支持获取收藏夹列表`);
        }
        return this.api.getCollects(cursor, count);
    }

    /**
     * 获取指定收藏夹的作品（分页，用于 UI 显示）
     *
     * @param {string} collectId - 收藏夹 ID
     * @param {number} cursor - 分页游标
     * @param {number} count - 每页数量
     * @returns {Promise<Object>} 作品列表数据
     */
    async getCollectWorksPage(collectId, cursor = 0, count = 20) {
        if (!this.api.getCollectWorksPage) {
            throw new Error(`当前平台 (${this.currentPlatform}) 不支持获取收藏夹作品`);
        }
        return this.api.getCollectWorksPage(collectId, cursor, count);
    }

    /**
     * ✅ 增量获取收藏夹作品（支持缓存合并）
     *
     * @param {string} collectId - 收藏夹 ID
     * @param {number} maxCount - 最大获取数量
     * @param {Function} onProgress - 进度回调
     * @param {Array} cachedWorkIds - 缓存的作品ID列表
     * @param {Object} metadata - 元数据
     * @returns {Promise<Object>} { works, hasMore, cursor }
     */
    async getCollectWorksIncremental(collectId, maxCount, onProgress, cachedWorkIds, metadata) {
        if (!this.api.getCollectWorksIncremental) {
            throw new Error(`当前平台 (${this.currentPlatform}) 不支持增量获取收藏夹作品`);
        }
        return this.api.getCollectWorksIncremental(collectId, maxCount, onProgress, cachedWorkIds, metadata);
    }

    /**
     * 获取单个作品详情
     *
     * @param {string} workId - 作品 ID
     * @returns {Promise<Object>} 作品详情
     */
    async getWorkDetail(workId) {
        if (!this.api.getWorkDetail) {
            throw new Error(`当前平台 (${this.currentPlatform}) 不支持获取作品详情`);
        }
        return this.api.getWorkDetail(workId);
    }
}

// 导出单例
export const platformAPI = new PlatformAdapter();
