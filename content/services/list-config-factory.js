// ==========================================
// FavGallery - 列表配置工厂
// 职责：根据平台动态组装列表配置（配置 + 方法）
// ==========================================

import { CONFIG } from '../../config/constants.js';
import { platformAPI } from '../../api/platform-adapter.js';
import * as worksManager from '../../data/storage/works-manager.js';
import * as authorsManager from '../../data/storage/authors-manager.js';
import * as collectsManager from '../../data/storage/collects-manager.js';

export class ListConfigFactory {
    /**
     * ✅ 创建列表配置（根据平台动态组装）
     * @param {string} listType - 列表类型（liked | bookmarked | following | collects）
     * @param {Object} dependencies - 依赖注入（可选，用于测试）
     * @returns {Object} 完整的列表配置
     */
    static createConfig(listType, dependencies = {}) {
        const baseConfig = CONFIG.FETCH_CONFIG.LIST_CONFIGS[listType];
        
        if (!baseConfig) {
            throw new Error(`未知的列表类型: ${listType}`);
        }

        // ✅ 根据列表类型注入对应的方法
        switch (listType) {
            case 'liked':
                return {
                    ...baseConfig,
                    apiFetch: (params) => platformAPI.getLikedWorks(
                        params.maxCount,
                        params.onProgress,
                        params.cachedIds,
                        params.metadata
                    ),
                    cacheLoad: (fs) => worksManager.loadLikedWorks(fs),
                    cacheSave: (fs, data) => worksManager.saveLikedWorks(fs, {
                        works: data.works,
                        metadata: data.metadata
                    })
                };

            case 'bookmarked':
                return {
                    ...baseConfig,
                    apiFetch: (params) => platformAPI.getCollectWorksIncremental(
                        params.collectId,
                        params.maxCount,
                        params.onProgress,
                        params.cachedIds,
                        params.metadata
                    ),
                    cacheLoad: (fs, extraParams) => worksManager.loadBookmarkedWorks(fs, extraParams.collectId),
                    cacheSave: (fs, data) => worksManager.saveBookmarkedWorks(fs, {
                        works: data.works,
                        collectId: data.collectId,
                        metadata: data.metadata
                    })
                };

            // ✅ 作者作品钻取：与 bookmarked 同构，collectId 维度换成 uid/platformId 维度
            case 'authorWorks':
                return {
                    ...baseConfig,
                    apiFetch: async (params) => {
                        // getAuthorWorksForList 返回数组，包装成 resultKey 结构供配置化管线消费
                        const works = await platformAPI.getAuthorWorksForList(
                            params.platformId,
                            params.maxCount,
                            params.onProgress
                        );
                        return { works };
                    },
                    cacheLoad: (fs, extraParams) => worksManager.loadAuthorWorks(fs, extraParams.uid),
                    cacheSave: (fs, data) => worksManager.saveAuthorWorks(fs, {
                        works: data.works,
                        uid: data.uid,
                        metadata: data.metadata
                    })
                };

            case 'following':
                return {
                    ...baseConfig,
                    apiFetch: (params) => platformAPI.getFollowingList(
                        params.maxCount,
                        params.onProgress,
                        params.cachedIds,
                        params.metadata
                    ),
                    cacheLoad: (fs) => authorsManager.loadAuthorsBase(fs),
                    cacheSave: (fs, data) => authorsManager.saveAuthorsBase(fs, dependencies.backupManager, {
                        authors: data.authors,
                        metadata: data.metadata
                    })
                };

            case 'collects':
                return {
                    ...baseConfig,
                    apiFetch: (params) => platformAPI.getCollects(
                        params.cursor || 0,
                        params.count || CONFIG.FETCH_CONFIG.LIST_CONFIGS.collects.maxCount
                    ),
                    cacheLoad: (fs) => collectsManager.loadAllCollects(fs),
                    cacheSave: (fs, data) => collectsManager.saveCollects(fs, dependencies.backupManager, data.collects)
                };

            default:
                throw new Error(`不支持的列表类型: ${listType}`);
        }
    }

    /**
     * ✅ 批量创建所有列表配置
     * @param {Object} dependencies - 依赖注入
     * @returns {Object} 所有列表配置的映射
     */
    static createAllConfigs(dependencies = {}) {
        const listTypes = Object.keys(CONFIG.FETCH_CONFIG.LIST_CONFIGS);
        const configs = {};

        listTypes.forEach(listType => {
            configs[listType] = this.createConfig(listType, dependencies);
        });

        return configs;
    }
}
