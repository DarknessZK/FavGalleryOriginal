// ==========================================
// FavGallery - 数据获取服务
// 职责：统一管理点赞/收藏/关注列表的数据获取逻辑（API 请求、缓存合并、持久化）
// ==========================================

import { CONFIG } from '../../config/constants.js';
import { platformAPI } from '../../api/platform-adapter.js';
import { createLogger } from '../../utils/logger.js';
import { fileSystem } from '../../data/storage/file-system.js';
import * as worksManager from '../../data/storage/works-manager.js';
import * as authorsManager from '../../data/storage/authors-manager.js';
import * as collectsManager from '../../data/storage/collects-manager.js';
import { backupManager } from '../../data/backup/backup-manager.js';
import * as relationManager from '../../data/database/relation-manager.js';

const logger = createLogger('DataFetcher');

export class DataFetcher {
    constructor() {
        this.folderSelected = false;
        this.fileSystem = fileSystem; // ✅ 初始化fileSystem
        
        // ✅ 列表配置映射（配置驱动）
        this.listConfigs = {
            liked: {
                // API层
                apiFetch: (params) => platformAPI.getLikedWorks(
                    params.maxCount,
                    params.onProgress,
                    params.cachedIds,
                    params.metadata
                ),
                
                // 缓存层
                cacheLoad: (fs) => worksManager.loadLikedWorks(fs),
                cacheSave: (fs, data) => worksManager.saveLikedWorks(fs, {
                    works: data.works,
                    metadata: data.metadata
                }),
                
                // 消息层
                messages: {
                    loaded: 'LIKED_WORKS_LOADED',
                    progress: 'LIKED_WORKS_PROGRESS',
                    error: 'LIKED_WORKS_ERROR',
                    clear: 'CLEAR_LIKED_LIST',
                    start: 'LOAD_DATA_START'
                },
                
                // 关系层
                relations: {
                    groupType: 'liked_group',
                    groupId: 'liked'
                },
                
                // 默认值
                defaults: {
                    maxCount: CONFIG.FETCH_CONFIG.LIST_DEFAULTS.LIKED,
                    folderRequired: true
                }
            },
            
            bookmarked: {
                // API层
                apiFetch: (params) => platformAPI.getCollectWorksIncremental(
                    params.collectId,
                    params.maxCount,
                    params.onProgress,
                    params.cachedIds,
                    params.metadata
                ),
                
                // 缓存层
                cacheLoad: (fs, extraParams) => worksManager.loadBookmarkedWorks(fs, extraParams.collectId),
                cacheSave: (fs, data) => worksManager.saveBookmarkedWorks(fs, {
                    works: data.works,
                    collectId: data.collectId,
                    metadata: data.metadata
                }),
                
                // 消息层
                messages: {
                    loaded: 'COLLECT_WORKS_LOADED',
                    progress: 'COLLECT_WORKS_PROGRESS',
                    error: 'COLLECT_WORKS_ERROR',
                    clear: 'CLEAR_BOOKMARKED_LIST',
                    start: 'LOAD_DATA_START'
                },
                
                // 关系层
                relations: {
                    groupType: 'collect',
                    groupId: null  // 动态设置
                },
                
                // 默认值
                defaults: {
                    maxCount: CONFIG.FETCH_CONFIG.LIST_DEFAULTS.BOOKMARKED,
                    folderRequired: true
                }
            },
            
            // ✅ 关注列表配置（作者列表）
            following: {
                // API层 - 获取关注作者列表
                apiFetch: (params) => platformAPI.getFollowingList(
                    params.maxCount,
                    params.onProgress,
                    params.cachedIds,  // cachedUids
                    params.metadata
                ),
                
                // 缓存层 - 加载/保存作者数据
                cacheLoad: (fs) => authorsManager.loadAuthorsBase(fs),
                cacheSave: (fs, data) => authorsManager.saveAuthorsBase(fs, backupManager, {
                    authors: data.authors,
                    metadata: data.metadata
                }),
                
                // 消息层
                messages: {
                    loaded: 'FOLLOWING_AUTHORS_LOADED',
                    progress: 'FOLLOWING_AUTHORS_PROGRESS',
                    error: 'FOLLOWING_AUTHORS_ERROR',
                    clear: 'CLEAR_FOLLOWING_LIST',
                    start: 'LOAD_DATA_START'
                },
                
                // 关系层 - 建立 author -> author_group 关系
                relations: {
                    groupType: 'author_group',
                    groupId: 'following'  // 默认分组ID
                },
                
                // 默认值
                defaults: {
                    maxCount: CONFIG.FETCH_CONFIG.LIST_DEFAULTS.FOLLOWING,
                    folderRequired: true
                }
            },
            
            // ✅ 收藏夹列表配置（元数据列表）
            collects: {
                // API层 - 获取收藏夹列表
                apiFetch: (params) => platformAPI.getCollects(
                    params.cursor || 0,
                    params.count || CONFIG.FETCH_CONFIG.COLLECTS_LIST_MAX_COUNT
                ),
                
                // 缓存层 - 加载/保存收藏夹数据
                cacheLoad: (fs) => collectsManager.loadAllCollects(fs),
                cacheSave: (fs, data) => collectsManager.saveCollects(fs, backupManager, data.collects),
                
                // 消息层
                messages: {
                    loaded: 'COLLECTS_LIST_LOADED',
                    progress: 'COLLECTS_LIST_PROGRESS',  // ✅ 保留机制（虽然不会触发）
                    error: 'COLLECTS_LIST_ERROR',
                    clear: null,
                    start: 'LOAD_DATA_START'
                },
                
                // 关系层（无）
                relations: null,
                
                // 默认值
                defaults: {
                    maxCount: CONFIG.FETCH_CONFIG.COLLECTS_LIST_MAX_COUNT,
                    folderRequired: true,  // ✅ 需要文件夹
                    skipIncrementalCheck: true  // ✅ 跳过增量检查，始终调用API以检测软删除
                }
            }
        };
    }

    /**
     * 设置文件夹选择状态
     */
    setFolderSelected(status) {
        this.folderSelected = status;
    }
    
    /**
     * ✅ 通用列表加载器（核心方法）- 支持作品列表、作者列表和收藏夹列表
     * @param {string} listType - 列表类型
     * @param {HTMLIFrameElement} iframe - 通信目标
     * @param {Object} extraParams - 额外参数
     */
    async _loadList(listType, iframe, extraParams = {}) {
        const mergedData = await this._loadListInternal(listType, iframe, extraParams);
        
        if (mergedData) {
            const config = this.listConfigs[listType];
            const isAuthorList = listType === 'following';
            const isCollectsList = listType === 'collects';
            
            // ✅ 区分不同类型的数据的消息格式
            const messageData = {};
            if (isCollectsList) {
                messageData.collects = mergedData;
            } else if (isAuthorList) {
                messageData.authors = mergedData;
            } else {
                messageData.works = mergedData;
            }
            
            this._sendMessage(iframe, config.messages.loaded, {
                ...messageData,
                total: mergedData.length
            });
        }
        
        return mergedData;
    }
    
    /**
     * ✅ 内部加载逻辑（通用）- 支持作品列表、作者列表和收藏夹列表
     */
    async _loadListInternal(listType, iframe, extraParams = {}) {
        const config = this.listConfigs[listType];
        if (!config) {
            throw new Error(`未知的列表类型: ${listType}`);
        }
        
        // 1. 前置检查
        if (config.defaults.folderRequired && !this.folderSelected) {
            logger.error('❌ 请先选择文件夹');
            return null;
        }
        
        // 2. 读取缓存
        const cacheResult = await config.cacheLoad(this.fileSystem, extraParams);
        
        // ✅ 区分不同类型的数据
        const isAuthorList = listType === 'following';
        const isCollectsList = listType === 'collects';
        const cachedItems = isAuthorList ? (cacheResult.authors || []) : 
                           isCollectsList ? (cacheResult.collects || []) :
                           (cacheResult.works || []);
        const metadata = cacheResult.metadata || {};
        
        logger.info(`📊 缓存中有 ${cachedItems.length} 个${isAuthorList ? '作者' : isCollectsList ? '收藏夹' : '作品'}`);
        
        // 3. 检查是否需要API请求
        // ✅ 如果 skipIncrementalCheck 为 true，则始终调用 API（用于检测软删除）
        const shouldSkipAPI = !config.defaults.skipIncrementalCheck && 
                              cachedItems.length >= config.defaults.maxCount;
        
        if (shouldSkipAPI) {
            const listTypeName = isAuthorList ? '作者' : isCollectsList ? '收藏夹' : '作品';
            logger.info(`⏭️ [${listTypeName}列表] 跳过 API 请求`);
            logger.info(`   📋 原因: 缓存已有 ${cachedItems.length} 个，达到目标数量 ${config.defaults.maxCount}`);
            logger.info(`   ⚙️ 配置: skipIncrementalCheck=${config.defaults.skipIncrementalCheck}, folderRequired=${config.defaults.folderRequired}`);
            logger.info(`   💡 提示: 如需强制刷新，请清除缓存或重新选择文件夹`);
            return cachedItems;
        }
        
        // 4. API增量获取
        // ✅ 根据类型使用不同的ID字段
        let cachedIds;
        if (isCollectsList) {
            // 收藏夹不需要传 cachedIds（API 不支持）
            cachedIds = null;
        } else {
            cachedIds = cachedItems.map(item => isAuthorList ? item.uid : item.workId);
        }
        
        const onProgress = (current, total) => {
            logger.info(`📈 进度: ${current}/${total}`);
            
            // ✅ 发送进度消息到Sidebar（仅在iframe存在且配置了progress时）
            if (iframe && config.messages.progress) {
                this._sendMessage(iframe, config.messages.progress, {
                    currentCount: current,
                    totalCount: total
                });
            }
        };
        
        const apiResult = await config.apiFetch({
            maxCount: config.defaults.maxCount,
            cachedIds,  // ✅ 收藏夹传 null
            onProgress,
            metadata,
            ...extraParams
        });
        
        // ✅ 区分不同类型的数据
        let apiItems;
        if (isCollectsList) {
            apiItems = apiResult.collects || [];
        } else {
            apiItems = isAuthorList ? (apiResult.authors || []) : (apiResult.works || []);
        }
        logger.info(`✅ API 返回 ${apiItems.length} 个${isAuthorList ? '作者' : isCollectsList ? '收藏夹' : '作品'}`);
        
        // 5. 合并数据（支持软删除）
        const mergedData = this._mergeItems(cachedItems, apiItems, isAuthorList, isCollectsList);
        logger.info(`✅ 合并后共 ${mergedData.length} 个${isAuthorList ? '作者' : isCollectsList ? '收藏夹' : '作品'}`);
        
        // 6. 保存数据
        await this._saveList(listType, {
            apiItems,
            mergedData,
            metadata,
            apiResult,
            isAuthorList,
            isCollectsList,
            ...extraParams
        });
        
        return mergedData;
    }

    /**
     * ✅ 通用列表保存器 - 支持作品列表、作者列表和收藏夹列表
     * @param {string} listType - 列表类型
     * @param {Object} data - 数据对象
     */
    async _saveList(listType, data) {
        const config = this.listConfigs[listType];
        
        // 没有新数据，不保存
        if (!data.apiItems || data.apiItems.length === 0) {
            logger.info('ℹ️ 没有新数据，跳过保存');
            return;
        }
        
        try {
            // 1. 保存到IndexedDB + 异步备份
            const isAuthorList = data.isAuthorList || listType === 'following';
            const isCollectsList = data.isCollectsList || listType === 'collects';
            
            if (isCollectsList) {
                // ✅ 收藏夹列表保存
                await config.cacheSave(this.fileSystem, {
                    collects: data.mergedData,
                    metadata: this._updateMetadata(data.metadata, data.apiResult)
                });
            } else if (isAuthorList) {
                // ✅ 作者列表保存
                await config.cacheSave(this.fileSystem, {
                    authors: data.mergedData,
                    metadata: this._updateMetadata(data.metadata, data.apiResult)
                });
            } else {
                // 作品列表保存
                await config.cacheSave(this.fileSystem, {
                    works: data.mergedData,
                    metadata: this._updateMetadata(data.metadata, data.apiResult),
                    ...data
                });
            }
            
            logger.info(`✅ 已保存最新列表: ${data.mergedData.length} 个${isCollectsList ? '收藏夹' : isAuthorList ? '作者' : '作品'}`);
            
            // 2. 建立关系（✅ 收藏夹跳过，因为 relations 为 null）
            if (config.relations) {
                if (isAuthorList) {
                    // ✅ 建立 author -> author_group 关系
                    await this.buildAuthorGroupRelations(
                        data.mergedData,
                        config.relations.groupId
                    );
                } else {
                    // 建立 work -> author 关系
                    await this.buildWorkAuthorRelations(
                        data.mergedData,
                        listType,
                        data.collectId
                    );
                }
            } else {
                logger.debug('ℹ️ 此列表类型不需要建立关系');
            }
            
            // 3. 触发备份（异步，不阻塞主流程）
            const batchCount = Math.ceil(data.apiItems.length / 20);
            const BACKUP_BATCH_INTERVAL = CONFIG.BACKUP_CONFIG.listBackup?.batchInterval || 5;
            
            if (batchCount >= BACKUP_BATCH_INTERVAL) {
                logger.info(`🔄 已加载 ${batchCount} 批，触发备份...`);
                // ✅ 异步触发备份，不等待完成
                this._triggerBackup(listType).catch(err => {
                    logger.warn('⚠️ 备份失败:', err.message);
                });
            }
            
        } catch (error) {
            logger.warn('⚠️ 保存列表失败', error);
            logger.warn('   错误类型:', typeof error);
            logger.warn('   错误消息:', error?.message || '无消息');
            logger.warn('   错误堆栈:', error?.stack || '无堆栈');
        }
    }
    
    /**
     * ✅ 发送消息
     */
    _sendMessage(iframe, type, data = {}) {
        iframe.contentWindow.postMessage({
            source: 'content',
            type,
            ...data
        }, '*');
    }
    
    /**
     * ✅ 发送错误消息
     */
    _sendError(iframe, errorType, message) {
        this._sendMessage(iframe, errorType, { error: message });
    }
    
    /**
     * ✅ 合并数据（支持作品、作者和收藏夹，支持软删除）
     * @param {Array} cached - 缓存数据
     * @param {Array} api - API数据
     * @param {boolean} isAuthorList - 是否为作者列表
     * @param {boolean} isCollectsList - 是否为收藏夹列表
     * @returns {Array} 合并后的数据
     */
    _mergeItems(cached, api, isAuthorList, isCollectsList) {
        const itemMap = new Map();
        
        // ✅ 根据类型确定ID字段
        const idField = isCollectsList ? 'collectId' : (isAuthorList ? 'uid' : 'workId');
        
        // 先加入缓存数据
        cached.forEach(item => {
            itemMap.set(item[idField], { ...item });
        });
        
        // API数据覆盖或新增（设置 isDeleted: false）
        api.forEach(item => {
            itemMap.set(item[idField], { ...item, isDeleted: false });
        });
        
        // ✅ 标记已删除的（软删除）
        // API 中没有但缓存中有的 → 标记 isDeleted: true
        const apiIds = new Set(api.map(item => item[idField]));
        cached.forEach(item => {
            if (!apiIds.has(item[idField]) && !item.isDeleted) {
                const existing = itemMap.get(item[idField]);
                if (existing) {
                    existing.isDeleted = true;
                    logger.debug(`🗑️ 标记为已删除: ${item[idField]}`);
                }
            }
        });
        
        return Array.from(itemMap.values());
    }
    
    /**
     * ✅ 更新元数据
     */
    _updateMetadata(metadata, apiResult) {
        return {
            ...metadata,
            lastMaxCursor: apiResult.cursor,
            isFullyLoaded: !apiResult.hasMore
        };
    }
    
    /**
     * ✅ 触发备份
     */
    async _triggerBackup(listType) {
        const backupTables = [
            'works',
            'authors',
            'collects',
            'author_groups',
            'relations'
        ];
        
        // 根据列表类型添加特定的表
        if (listType === 'liked') {
            backupTables.push('liked_group');
        }
        
        await backupManager.performSelectiveBackup(backupTables);
    }
    /**
     * ✅ 从缓存加载列表（通用）
     * @param {string} listType - 列表类型
     * @param {HTMLIFrameElement} iframe - 通信目标
     */
    async _loadFromStorage(listType, iframe) {
        const config = this.listConfigs[listType];
        
        try {
            logger.info(`开始从存储加载${listType}列表...`);
            
            const result = await config.cacheLoad(this.fileSystem);
            const works = result.works || [];
            
            if (works.length > 0) {
                logger.info(`✅ 从存储加载 ${works.length} 个作品`);
            } else {
                logger.info('📭 存储中没有数据');
            }
            
            this._sendMessage(iframe, config.messages.loaded, {
                works: works,
                total: works.length,
                fromCache: true
            });
            
        } catch (error) {
            logger.error('从存储加载列表失败', error);
            this._sendError(iframe, config.messages.error, error.message);
        }
    }
    
    /**
     * 从 IndexedDB 加载点赞作品列表（不触发网络请求）
     */
    async loadLikedWorksFromStorage(iframe) {
        await this._loadFromStorage('liked', iframe);
    }

    /**
     * 加载点赞作品列表（从 API 获取并合并缓存）
     */
    async loadLikedWorks(iframe, maxCount = CONFIG.FETCH_CONFIG.LIST_DEFAULTS.LIKED) {
        await this._loadList('liked', iframe, { maxCount });
    }

    /**
     * 建立作品与作者的关系
     * @param {Array} works - 作品列表（包括视频、图集等）
     * @param {string} listType - 列表类型（'liked' | 'bookmarked'）
     * @param {string} collectId - 收藏夹ID（仅当 listType 为 'bookmarked' 时需要）
     */
    async buildWorkAuthorRelations(works, listType = 'liked', collectId = null) {
        try {
            const relations = [];
            const baseTime = Date.now();

            for (let i = 0; i < works.length; i++) {
                const work = works[i];
                // ✅ 使用递减的时间戳模拟操作时间（列表中越靠前的作品，操作时间越新）
                const operationTime = baseTime - (i * 1); // 每个作品间隔1毫秒
                // 1. 建立 作品 → 作者 的关系（始终建立）
                if (work.author && work.author.uid) {
                    relations.push({
                        sourceType: 'work',
                        sourceId: work.workId,
                        targetType: 'author',
                        targetId: work.author.uid,
                        createdAt: operationTime
                    });
                }

                // 2. 根据列表类型建立 作品 → 分组 的关系
                if (listType === 'liked') {
                    // 点赞列表：建立 作品 → liked_group 的关系
                    relations.push({
                        sourceType: 'work',
                        sourceId: work.workId,
                        targetType: 'liked_group',
                        targetId: 'liked',
                        createdAt: operationTime
                    });
                } else if (listType === 'bookmarked' && collectId) {
                    // 收藏列表：建立 作品 → collect 的关系
                    relations.push({
                        sourceType: 'work',
                        sourceId: work.workId,
                        targetType: 'collect',
                        targetId: collectId,
                        createdAt: operationTime
                    });
                }
            }

            if (relations.length > 0) {
                await relationManager.batchAddRelations(relations);
                logger.debug(`✅ 建立了 ${relations.length} 个关系记录`);
            }
        } catch (error) {
            logger.warn('⚠️ 建立关系失败', error);
        }
    }
    
    /**
     * ✅ 建立作者与分组的关系（用于关注列表）
     * @param {Array} authors - 作者列表
     * @param {string} groupId - 分组ID（如 'following'）
     */
    async buildAuthorGroupRelations(authors, groupId = 'following') {
        try {
            const relations = [];
            const baseTime = Date.now();

            for (let i = 0; i < authors.length; i++) {
                const author = authors[i];
                // ✅ 使用递减的时间戳模拟操作时间
                const operationTime = baseTime - (i * 1);
                
                // 建立 author -> author_group 的关系
                if (author.uid) {
                    relations.push({
                        sourceType: 'author',
                        sourceId: author.uid,
                        targetType: 'author_group',
                        targetId: groupId,
                        createdAt: operationTime
                    });
                }
            }

            if (relations.length > 0) {
                await relationManager.batchAddRelations(relations);
                logger.debug(`✅ 建立了 ${relations.length} 个作者-分组关系记录`);
            }
        } catch (error) {
            logger.warn('⚠️ 建立作者-分组关系失败', error);
        }
    }
}

// 导出单例
export const dataFetcher = new DataFetcher();
export default dataFetcher;
